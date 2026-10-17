import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../../../src/main/db/store";
import { ProviderDiagnosticsRepository } from "../../../src/main/db/provider-diagnostics";
import { JobService } from "../../../src/main/services/jobs/lib/job-service";
import { newCoveragePlan } from "../../../src/main/services/jobs/lib/chapters";
import type { MediaService } from "../../../src/main/services/media/lib/media-service";
import { AppError } from "../../../src/main/lib/errors";
import {
  DEFAULT_STYLE,
  optionsSchema,
  type Job,
} from "../../../src/shared/contracts";

const resources: { server: Server; root: string; store: Store }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { server, root, store } of resources.splice(0)) {
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture(
  answer: (prompt: string, call: number) => string | undefined,
): Promise<{
  store: Store;
  jobs: JobService;
  diagnostics: ProviderDiagnosticsRepository;
  job: Job;
  root: string;
}> {
  let calls = 0;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const payload = JSON.parse(body) as { messages: { content: string }[] };
    const text = answer(payload.messages[0]?.content ?? "", ++calls);
    if (text === undefined) {
      response.writeHead(401);
      response.end("{}");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
    );
    response.end(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture address");
  const root = await mkdtemp(join(tmpdir(), "slice-chapter-diagnostics-"));
  const store = new Store(join(root, "app.db"), {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error("unused");
    },
    decryptString: () => {
      throw new Error("unused");
    },
  });
  resources.push({ server, root, store });
  const profile = store.saveProfile({
    name: "fixture",
    protocol: "openai",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "fixture",
    sessionOnly: true,
    apiKey: "not-in-logs",
    timeoutMs: 1000,
    textConcurrency: 1,
  });
  const diagnostics = new ProviderDiagnosticsRepository(store.sqlite, root);
  const jobs = new JobService(
    store,
    {} as MediaService,
    { executable: () => ({ path: "", backend: "cpu" }), modelPath: () => "" },
    root,
    () => {},
    () => "",
    diagnostics,
  );
  const job: Job = {
    id: "job",
    name: "fixture",
    inputPath: join(root, "video.mp4"),
    media: {
      durationMs: 3_600_000,
      width: 100,
      height: 100,
      hasAudio: true,
      audioOffsetMs: 0,
      rotation: 0,
      sampleAspectRatio: "1:1",
    },
    options: optionsSchema.parse({
      reviewProfileId: profile.id,
      translationProfileId: profile.id,
    }),
    segments: Array.from({ length: 6 }, (_, index) => ({
      id: `cue-${index}`,
      startMs: index * 600_000,
      endMs: index * 600_000 + 5000,
      sourceText: `source ${index}`,
      translatedText: "",
      translationStale: true,
    })),
    style: structuredClone(DEFAULT_STYLE),
    revision: 0,
    createdAt: 0,
    updatedAt: 0,
    stages: Object.fromEntries(
      ["recognize", "translate", "style", "preview", "export"].map((name) => [
        name,
        {
          state: name === "recognize" ? "succeeded" : "idle",
          progress: 0,
          message: "",
        },
      ]),
    ) as Job["stages"],
    outputs: [],
  };
  job.chapterPlan = newCoveragePlan(job);
  store.saveJob(job);
  return { store, jobs, diagnostics, job, root };
}
function reviewed(prompt: string): string {
  const data = JSON.parse(prompt.split("\n").slice(1).join("\n")) as {
    groups: { targets: number[] }[];
  };
  return JSON.stringify({
    a: data.groups.flatMap((group) => group.targets.map((n) => [n, []])),
  });
}

describe("actual streamed chapter diagnostics and SQLite publication", () => {
  it("stores translation, global names and style output with published diagnostics", async () => {
    const f = await fixture((prompt) => {
      if (prompt.startsWith("Translate subtitle")) {
        const data = JSON.parse(prompt.split("\n").slice(1).join("\n")) as {
          selected: { id: string; text: string }[];
        };
        return JSON.stringify({
          translations: data.selected.map((cue) => ({
            id: cue.id,
            text: `译文 ${cue.text}`,
          })),
        });
      }
      if (prompt.startsWith("Design subtitle style"))
        return JSON.stringify(DEFAULT_STYLE);
      return '{"candidates":[]}';
    });
    await f.jobs.translate("job");
    let job = f.store.getJob("job");
    await f.jobs.analyzeNames({ jobId: job.id, revision: job.revision });
    job = f.store.getJob("job");
    job.options.styleProfileId = job.options.reviewProfileId;
    f.store.saveJob(job);
    await f.jobs.designStyle("job", "clean readable");
    const records = f.diagnostics.list({ jobId: "job" });
    expect(records).toHaveLength(7);
    expect(records.every((record) => record.state === "published")).toBe(true);
    expect(
      records.filter((record) => record.operation === "translate"),
    ).toHaveLength(3);
    expect(
      records.find((record) => record.operation === "names")?.targetCount,
    ).toBe(6);
    expect(records.some((record) => record.operation === "style")).toBe(true);
  });

  it("shares the export lease and rechecks external source identity before each publication", async () => {
    const f = await fixture((prompt) => reviewed(prompt));
    await writeFile(f.job.inputPath, "source");
    const workspace = join(f.root, "jobs", f.job.id);
    await mkdir(workspace, { recursive: true });
    const identity = await stat(f.job.inputPath);
    await writeFile(
      join(workspace, "input-identity.json"),
      JSON.stringify({ size: identity.size, mtimeMs: identity.mtimeMs }),
    );
    await expect(
      f.jobs.runChapterExport(
        "job",
        0,
        async (_snapshot, _signal, assertFresh) => {
          expect(() => f.jobs.assertIdle()).toThrow("已有任务");
          expect(() => f.jobs.updateOptions("job", f.job.options)).toThrow(
            "已有任务",
          );
          await writeFile(f.job.inputPath, "changed external source");
          await assertFresh();
          return "must not publish";
        },
      ),
    ).rejects.toMatchObject({ code: "INPUT_CHANGED" });
    await f.jobs.waitForIdle();
    expect(() => f.jobs.assertIdle()).not.toThrow();
  });

  it("publishes each complete chapter and its trace together; retains completed traces on later provider failure", async () => {
    const f = await fixture((prompt, call) =>
      call === 2 ? undefined : reviewed(prompt),
    );
    await expect(
      f.jobs.reviewSubtitles({ jobId: "job", revision: 0 }),
    ).rejects.toMatchObject({ code: "AUTH_ERROR" });
    const records = f.diagnostics.list({ jobId: "job" });
    expect(records).toHaveLength(2);
    expect(
      records.find((record) => record.state === "published"),
    ).toMatchObject({
      operation: "review",
      targetCount: 2,
      streamActual: true,
    });
    expect(
      records.find((record) => record.state === "failed")?.errorPhase,
    ).toBe("http");
    expect(
      f.store.getJob("job").reviewRun?.chapters.map((chapter) => chapter.state),
    ).toEqual(["completed", "failed", "pending"]);
    expect(f.store.getJob("job").reviewReport?.assessments).toHaveLength(2);
    expect(JSON.stringify(records)).not.toContain("not-in-logs");
  });
  it("records invalid complete JSON as validation failure rather than published success", async () => {
    const f = await fixture(() => '{"a":[]}');
    await expect(
      f.jobs.reviewSubtitles({ jobId: "job", revision: 0 }),
    ).rejects.toMatchObject({ code: "REVIEW_INCOMPLETE" });
    expect(f.store.getJob("job").reviewReport).toBeUndefined();
    const records = f.diagnostics.list({ jobId: "job" });
    expect(records).toHaveLength(2);
    expect(
      records.every(
        (record) =>
          record.state === "failed" && record.errorPhase === "validation",
      ),
    ).toBe(true);
  });
  it("rolls back chapter content when its publication diagnostic cannot be saved", async () => {
    const f = await fixture((prompt) => reviewed(prompt));
    vi.spyOn(f.diagnostics, "markPublished").mockImplementation(() => {
      throw new AppError("DIAGNOSTIC_STORAGE", "fixture storage failure");
    });
    await expect(
      f.jobs.reviewSubtitles({ jobId: "job", revision: 0 }),
    ).rejects.toMatchObject({ code: "DIAGNOSTIC_STORAGE" });
    expect(f.store.getJob("job").reviewReport).toBeUndefined();
    expect(f.diagnostics.list({ jobId: "job" })[0]?.state).toBe("validated");
  });
  it("restart preserves completed coverage and interrupts only the running chapter", async () => {
    const f = await fixture((prompt) => reviewed(prompt));
    const complete = await f.jobs.reviewSubtitles({
      jobId: "job",
      revision: 0,
    });
    if (!complete.reviewRun) throw new Error("run missing");
    complete.reviewRun.state = "running";
    const second = complete.reviewRun.chapters[1];
    if (second) second.state = "running";
    const third = complete.reviewRun.chapters[2];
    if (third) third.state = "pending";
    f.store.saveJob(complete);
    // Open the same real SQLite file as a new process would. No cloud work is resumed.
    const reopened = new Store(join(f.root, "app.db"), {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error("unused");
      },
      decryptString: () => {
        throw new Error("unused");
      },
    });
    try {
      const run = reopened.getJob("job").reviewRun;
      expect(run?.state).toBe("interrupted");
      expect(run?.chapters.map((chapter) => chapter.state)).toEqual([
        "completed",
        "pending",
        "pending",
      ]);
    } finally {
      reopened.close();
    }
  });
});
