import { afterEach, describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { segments, stages } from "../../../src/main/db/schema";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../../src/main/db/store";
import {
  DEFAULT_STYLE,
  optionsSchema,
  type Job,
  type Profile,
  type ProfileInput,
} from "../../../src/shared/contracts";
const directories: string[] = [];
function profileInput(profile: Profile): ProfileInput {
  const { hasKey: _hasKey, ...input } = profile;
  return input;
}
const stores: Store[] = [];
const secret = {
  isEncryptionAvailable: () => true,
  encryptString: (v: string): Buffer => Buffer.from(`encrypted:${v}`),
  decryptString: (v: Buffer): string => v.toString().replace(/^encrypted:/, ""),
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of stores.splice(0)) s.close();
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function store(): Promise<Store> {
  const root = await mkdtemp(join(tmpdir(), "slice-store-"));
  directories.push(root);
  const s = new Store(join(root, "app.db"), secret);
  stores.push(s);
  return s;
}
function job(): Job {
  const stage = { state: "idle" as const, progress: 0, message: "" };
  return {
    id: "j",
    name: "video",
    inputPath: "video.mp4",
    media: {
      durationMs: 5000,
      width: 1280,
      height: 720,
      hasAudio: true,
      audioOffsetMs: 0,
      rotation: 0,
      sampleAspectRatio: "1:1",
    },
    options: optionsSchema.parse({}),
    segments: [
      {
        id: "s1",
        startMs: 0,
        endMs: 1000,
        sourceText: "hello",
        translatedText: "你好",
        translationStale: false,
      },
    ],
    style: DEFAULT_STYLE,
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stages: {
      recognize: { ...stage, state: "running" },
      translate: { ...stage },
      style: { ...stage },
      preview: { ...stage },
      export: { ...stage },
    },
    outputs: [],
  };
}
describe("SQLite migration/persistence and credentials", () => {
  it("marks persisted automatic repair interrupted on restart, retaining committed content without resuming", async () => {
    const s = await store();
    const value = job();
    value.repairRun = {
      id: "repair",
      scope: { mode: "range", startMs: 0, endMs: 1000 },
      threshold: "medium",
      maxRounds: 3,
      state: "running",
      phase: "reassessment",
      round: 1,
      committedRounds: 1,
      affectedCount: 1,
      remainingCount: 1,
      effectiveIntervals: [{ startMs: 0, endMs: 1000 }],
      startedAt: Date.now(),
    };
    s.saveJob(value);
    const path = s.sqlite.name;
    s.close();
    stores.splice(stores.indexOf(s), 1);
    const reopened = new Store(path, secret);
    stores.push(reopened);
    const result = reopened.getJob(value.id);
    expect(result.repairRun).toMatchObject({
      state: "interrupted",
      phase: "done",
      reason: "interrupted",
      committedRounds: 1,
    });
    expect(result.repairRun?.remainingCount).toBeUndefined();
    expect(result.segments).toEqual(value.segments);
    expect(result.revision).toBe(value.revision);
  });
  it("declares the same composite keys in ORM metadata and real migrations", async () => {
    const s = await store();
    for (const [table, expected] of [
      [segments, ["job_id", "id"]],
      [stages, ["job_id", "name"]],
    ] as const) {
      const config = getTableConfig(table);
      expect(
        config.primaryKeys[0]?.columns.map((column) => column.name),
      ).toEqual(expected);
      const actual = s.sqlite
        .prepare(`PRAGMA table_info('${config.name}')`)
        .all() as { name: string; pk: number }[];
      expect(
        actual
          .filter((column) => column.pk > 0)
          .sort((a, b) => a.pk - b.pk)
          .map((column) => column.name),
      ).toEqual(expected);
    }
  });
  it("keeps completed cloud recognition and translation on credentials-only profile edits", async () => {
    const s = await store();
    const p = s.saveProfile({
      name: "p",
      protocol: "openai",
      baseUrl: "https://example.com",
      model: "m",
      apiKey: "test-only",
    });
    const saved = job();
    saved.options.recognition = "cloud";
    saved.options.recognitionProfileId = p.id;
    saved.options.translationProfileId = p.id;
    saved.stages.recognize.state = "succeeded";
    saved.stages.translate.state = "succeeded";
    s.saveJob(saved);
    s.saveProfile({
      ...profileInput(p),
      name: "renamed",
      apiKey: "new-test-only",
      timeoutMs: 3000,
    });
    const next = s.getJob(saved.id);
    expect(next.revision).toBe(saved.revision);
    expect(next.stages.recognize.state).toBe("succeeded");
    expect(next.stages.translate.state).toBe("succeeded");
    expect(next.segments[0]?.translationStale).toBe(false);
  });
  it("rolls profile and dependent jobs back together and retains the old session key on failure", async () => {
    const s = await store();
    const p = s.saveProfile({
      name: "p",
      protocol: "openai",
      baseUrl: "https://example.com",
      model: "m",
      apiKey: "old-test-only",
      sessionOnly: true,
    });
    const saved = job();
    saved.options.recognition = "cloud";
    saved.options.recognitionProfileId = p.id;
    s.saveJob(saved);
    vi.spyOn(s, "saveJob").mockImplementationOnce(() => {
      throw new Error("injected write failure");
    });
    expect(() =>
      s.saveProfile({
        ...profileInput(p),
        model: "changed",
        apiKey: "new-test-only",
      }),
    ).toThrow("injected write failure");
    expect(s.getProfile(p.id).model).toBe("m");
    expect(s.getJob(saved.id).revision).toBe(saved.revision);
    expect(s.key(p.id)).toBe("old-test-only");
  });
  it.each(["protocol", "mode", "baseUrl", "model"] as const)(
    "invalidates cloud recognition dependencies when profile %s changes",
    async (field) => {
      const s = await store();
      const p = s.saveProfile({
        name: "p",
        protocol: "openai",
        baseUrl: "https://example.com",
        model: "m",
        apiKey: "test-only",
      });
      const saved = job();
      saved.options.recognition = "cloud";
      saved.options.recognitionProfileId = p.id;
      saved.stages.recognize.state = "succeeded";
      saved.stages.translate.state = "succeeded";
      saved.previewUrl = "app-media://local/old";
      s.saveJob(saved);
      const values = {
        protocol: "anthropic" as const,
        mode: "responses" as const,
        baseUrl: "https://other.example",
        model: "changed",
      };
      s.saveProfile({ ...profileInput(p), [field]: values[field] });
      const next = s.getJob(saved.id);
      expect(next.revision).toBe(saved.revision + 1);
      expect(next.stages.recognize.state).toBe("idle");
      expect(next.stages.translate.state).toBe("idle");
      expect(next.segments[0]?.translationStale).toBe(true);
      expect(next.previewUrl).toBeUndefined();
    },
  );
  it("does not invalidate unchanged, key/name/timeout-only or unrelated/local recognition jobs", async () => {
    const s = await store();
    const p = s.saveProfile({
      name: "p",
      protocol: "openai",
      baseUrl: "https://example.com",
      model: "m",
      apiKey: "test-only",
    });
    const saved = job();
    saved.options.recognitionProfileId = p.id;
    saved.stages.recognize.state = "succeeded";
    s.saveJob(saved);
    s.saveProfile(profileInput(p));
    s.saveProfile({
      ...profileInput(p),
      name: "renamed",
      timeoutMs: 2000,
      apiKey: "changed-test-key",
    });
    s.saveProfile({ ...profileInput(p), model: "different" });
    expect(s.getJob(saved.id).revision).toBe(saved.revision);
    expect(s.getJob(saved.id).stages.recognize.state).toBe("succeeded");
    expect(s.getJob(saved.id).segments[0]?.translationStale).toBe(false);
    const unrelated = s.saveProfile({
      name: "unrelated",
      protocol: "openai",
      baseUrl: "https://example.com",
      model: "m",
    });
    s.saveProfile({ ...profileInput(unrelated), model: "other" });
    expect(s.getJob(saved.id).revision).toBe(saved.revision);
  });
  it("invalidates translation without local recognition and preserves the last valid style", async () => {
    const s = await store();
    const p = s.saveProfile({
      name: "p",
      protocol: "openai",
      baseUrl: "https://example.com",
      model: "m",
    });
    const saved = job();
    saved.options.translationProfileId = p.id;
    saved.options.styleProfileId = p.id;
    saved.stages.recognize.state = "succeeded";
    saved.stages.translate.state = "running";
    saved.stages.style.state = "succeeded";
    const style = structuredClone(saved.style);
    s.saveJob(saved);
    s.saveProfile({ ...profileInput(p), model: "other" });
    const next = s.getJob(saved.id);
    expect(next.stages.recognize.state).toBe("succeeded");
    expect(next.stages.translate.state).toBe("idle");
    expect(next.stages.style.state).toBe("idle");
    expect(next.style).toEqual(style);
    expect(next.segments[0]?.translatedText).toBe("你好");
    expect(next.segments[0]?.translationStale).toBe(true);
  });
  it("moves an existing key between protected persistence and session-only without reentry", async () => {
    const s = await store();
    const p = s.saveProfile({
      name: "p",
      protocol: "openai",
      baseUrl: "https://example.com",
      model: "m",
      apiKey: "secret",
    });
    expect(s.key(p.id)).toBe("secret");
    s.saveProfile({ ...profileInput(p), sessionOnly: true });
    expect(
      s.sqlite.prepare("SELECT encrypted_key FROM profiles").get(),
    ).toEqual({ encrypted_key: null });
    expect(s.key(p.id)).toBe("secret");
    s.saveProfile({ ...profileInput(p), sessionOnly: false });
    const saved = s.sqlite
      .prepare("SELECT encrypted_key FROM profiles")
      .get() as { encrypted_key: string };
    expect(saved.encrypted_key).toBeTruthy();
    expect(s.key(p.id)).toBe("secret");
    s.saveProfile({ ...profileInput(p), sessionOnly: true });
    const path = join(directories[0] ?? "", "app.db");
    s.close();
    stores.pop();
    const reopened = new Store(path, secret);
    stores.push(reopened);
    expect(reopened.listProfiles()[0]?.hasKey).toBe(false);
    expect(() => reopened.key(p.id)).toThrow("API Key");
  });
  it("failed session-to-persistent migration preserves usable session key and storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "slice-migrate-key-"));
    directories.push(root);
    const s = new Store(join(root, "app.db"), {
      ...secret,
      isEncryptionAvailable: () => false,
    });
    stores.push(s);
    const p = s.saveProfile({
      name: "p",
      protocol: "openai",
      baseUrl: "https://example.com",
      model: "m",
      apiKey: "secret",
      sessionOnly: true,
    });
    expect(() =>
      s.saveProfile({ ...profileInput(p), sessionOnly: false }),
    ).toThrow("仅本次会话");
    expect(s.getProfile(p.id).sessionOnly).toBe(true);
    expect(s.key(p.id)).toBe("secret");
    expect(
      s.sqlite.prepare("SELECT encrypted_key FROM profiles").get(),
    ).toEqual({ encrypted_key: null });
  });
  it("saves normalized data transactionally with millisecond timestamps and restart interruption", async () => {
    const s = await store();
    s.saveJob(job());
    expect(s.sqlite.prepare("SELECT start_ms FROM segments").get()).toEqual({
      start_ms: 0,
    });
    const raw = s.sqlite.prepare("SELECT created_at FROM jobs").get() as {
      created_at: number;
    };
    expect(raw.created_at).toBeGreaterThan(1000000000000);
    const path = (directories[0] ?? "") + "/app.db";
    s.close();
    stores.pop();
    const reopen = new Store(path, secret);
    stores.push(reopen);
    expect(reopen.getJob("j").segments[0]?.translatedText).toBe("你好");
    expect(reopen.getJob("j").stages.recognize.state).toBe("interrupted");
    expect(reopen.sqlite.pragma("user_version", { simple: true })).toBe(1);
  });
  it("ordinary reads do not expose keys and session-only keys are not persisted", async () => {
    const s = await store();
    const p = s.saveProfile({
      name: "p",
      protocol: "openai",
      baseUrl: "https://example.com/v1",
      model: "test",
      apiKey: "secret",
      sessionOnly: true,
    });
    expect(p).not.toHaveProperty("apiKey");
    expect(s.listProfiles()[0]).not.toHaveProperty("apiKey");
    expect(s.key(p.id)).toBe("secret");
    const rows = s.sqlite.prepare("SELECT * FROM profiles").all();
    expect(JSON.stringify(rows)).not.toContain("secret");
    s.removeProfile(p.id);
    expect(() => s.key(p.id)).toThrow();
  });
  it("refuses plaintext persistence when system encryption is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "slice-key-"));
    directories.push(root);
    const s = new Store(join(root, "app.db"), {
      ...secret,
      isEncryptionAvailable: () => false,
    });
    stores.push(s);
    expect(() =>
      s.saveProfile({
        name: "p",
        protocol: "openai",
        baseUrl: "https://example.com",
        model: "m",
        apiKey: "secret",
      }),
    ).toThrow("仅本次会话");
    expect(s.listProfiles()).toEqual([]);
  });
});
