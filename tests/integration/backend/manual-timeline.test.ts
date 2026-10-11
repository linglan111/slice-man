import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../../src/main/db/store";
import { JobService } from "../../../src/main/services/jobs/lib/job-service";
import type { MediaService } from "../../../src/main/services/media/lib/media-service";
import {
  DEFAULT_STYLE,
  optionsSchema,
  type Job,
  type Segment,
} from "../../../src/shared/contracts";

const fixtures: { root: string; store: Store }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { root, store } of fixtures.splice(0)) {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
function cue(id: string, startMs: number, endMs: number): Segment {
  return {
    id,
    startMs,
    endMs,
    sourceText: `source ${id}`,
    translatedText: `译文 ${id}`,
    translationStale: false,
  };
}
async function fixture(): Promise<{
  root: string;
  input: string;
  store: Store;
  jobs: JobService;
  job: Job;
  media: Record<
    "probe" | "extract" | "render" | "proxy",
    ReturnType<typeof vi.fn>
  >;
  runtime: Record<"executable" | "modelPath", ReturnType<typeof vi.fn>>;
  emit: ReturnType<typeof vi.fn>;
}> {
  const root = await mkdtemp(join(tmpdir(), "slice-manual-"));
  const input = join(root, "anonymous source.mp4");
  await writeFile(input, "anonymous source bytes");
  const store = new Store(join(root, "isolated.db"), {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error("No real credentials");
    },
    decryptString: () => {
      throw new Error("No real credentials");
    },
  });
  fixtures.push({ root, store });
  const media = {
    probe: vi.fn(async () => ({
      durationMs: 5000,
      width: 1280,
      height: 720,
      hasAudio: true,
      audioOffsetMs: 0,
      rotation: 0,
      sampleAspectRatio: "1:1",
    })),
    extract: vi.fn(),
    render: vi.fn(),
    proxy: vi.fn(),
  };
  const runtime = { executable: vi.fn(), modelPath: vi.fn() };
  const emit = vi.fn();
  const jobs = new JobService(
    store,
    media as unknown as MediaService,
    runtime,
    root,
    emit,
    (path) => path,
  );
  const job = await jobs.importVideo(input);
  return { root, input, store, jobs, job, media, runtime, emit };
}
function recognized(f: Awaited<ReturnType<typeof fixture>>): Job {
  const job = f.store.getJob(f.job.id);
  job.segments = [cue("first", 1000, 2000), cue("last", 3000, 4000)];
  job.stages.recognize = {
    state: "succeeded",
    progress: 1,
    message: "cached recognition",
  };
  job.stages.translate = {
    state: "succeeded",
    progress: 1,
    message: "translated",
  };
  job.stages.style = { state: "succeeded", progress: 1, message: "designed" };
  job.stages.preview = { state: "succeeded", progress: 1, message: "rendered" };
  job.stages.export = { state: "succeeded", progress: 1, message: "exported" };
  job.previewUrl = "app-media://local/test-reference";
  job.actualBackend = "cpu";
  job.outputs = [join(f.root, "historical.srt")];
  job.style = {
    ...structuredClone(DEFAULT_STYLE),
    templateId: "cinematic",
    emphasisBySegment: [
      { segmentId: "first", keywords: ["first"] },
      { segmentId: "last", keywords: ["last"] },
    ],
  };
  return f.store.saveJob(job);
}
function rows(store: Store): unknown {
  return ["jobs", "segments", "stages"].map((table) =>
    store.sqlite.prepare(`SELECT * FROM ${table}`).all(),
  );
}

describe("manual timeline persistence and export", () => {
  it("exports cached subtitle files when source media is missing, independently of video preferences", async () => {
    const f = await fixture();
    const job = recognized(f);
    await rm(f.input);
    for (const format of ["srt", "ass", "vtt"] as const) {
      const destination = join(f.root, `cached.${format}`);
      await f.jobs.export(job.id, format, "balanced", destination, {
        videoCodec: "original",
        resolution: "360p",
      });
      expect(await readFile(destination, "utf8")).toContain("first");
    }
    expect(f.media.render).not.toHaveBeenCalled();
    expect(f.media.probe).toHaveBeenCalledTimes(1);
    expect(f.media.extract).not.toHaveBeenCalled();
  });
  it("adds at beginning/middle/end and retains legitimate overlap, IDs, translations and successful cache", async () => {
    const f = await fixture();
    const before = recognized(f);
    let job = before;
    for (const [startMs, endMs, sourceText] of [
      [0, 500, "begin"],
      [2000, 2500, "middle"],
      [4500, 5000, "end"],
      [1500, 3500, "overlap"],
    ] as const) {
      const previousRevision = job.revision;
      job = f.jobs.addSegment(
        job.id,
        { startMs, endMs, sourceText },
        job.revision,
      );
      expect(job.revision).toBe(previousRevision + 1);
      const added = job.segments.find(
        (segment) => segment.sourceText === sourceText,
      );
      expect(added).toMatchObject({
        startMs,
        endMs,
        translatedText: "",
        translationStale: true,
      });
      expect(added?.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(job.segments.map((segment) => segment.sourceText)).toEqual([
      "begin",
      "source first",
      "overlap",
      "middle",
      "source last",
      "end",
    ]);
    expect(new Set(job.segments.map((segment) => segment.id)).size).toBe(6);
    expect(
      job.segments.filter((segment) => ["first", "last"].includes(segment.id)),
    ).toEqual(before.segments);
    expect(job.style).toEqual(before.style);
    expect(job.actualBackend).toBe("cpu");
    expect(job.stages.recognize).toEqual(before.stages.recognize);
    expect(job.stages.translate.state).toBe("idle");
    expect(job.previewUrl).toBeUndefined();
    expect(job.stages.preview.state).toBe("idle");
    expect(job.stages.export.state).toBe("idle");
    expect(job.outputs).toEqual(before.outputs);
    expect(f.store.getJob(job.id)).toEqual(job);
    expect(await f.jobs.recognize(job.id)).toEqual(job);
    expect(f.media.extract).not.toHaveBeenCalled();
    expect(f.runtime.executable).not.toHaveBeenCalled();
  });

  it.each(["idle", "failed", "cancelled", "interrupted"] as const)(
    "makes an empty %s job manually usable without claiming native inference",
    async (state) => {
      const f = await fixture();
      f.job.stages.recognize = { state, progress: 0, message: "prior status" };
      f.store.saveJob(f.job);
      const job = f.jobs.addSegment(
        f.job.id,
        { startMs: 0, endMs: 1, sourceText: "短字幕", translatedText: "Short" },
        f.job.revision,
      );
      expect(job.stages.recognize).toMatchObject({
        state: "succeeded",
        message: "手工字幕已保存，可直接翻译或导出",
      });
      expect(job.actualBackend).toBeUndefined();
      expect(job.segments[0]?.translationStale).toBe(false);
      expect(await f.jobs.recognize(job.id)).toEqual(job);
      expect(f.media.extract).not.toHaveBeenCalled();
      expect(f.runtime.executable).not.toHaveBeenCalled();
    },
  );

  it("retains invalidated recognition dependencies on a nonempty timeline", async () => {
    const f = await fixture();
    let job = recognized(f);
    job = f.jobs.updateOptions(job.id, {
      ...job.options,
      sourceLanguage: "ja",
    });
    const recognition = job.stages.recognize;
    job = f.jobs.addSegment(
      job.id,
      { startMs: 0, endMs: 1, sourceText: "手工追加" },
      job.revision,
    );
    expect(job.stages.recognize).toEqual(recognition);
    expect(
      job.segments.find((segment) => segment.id === "first")?.translationStale,
    ).toBe(true);
  });

  it.each(["first", "last"])(
    "deletes the %s cue and only its own emphasis, then supports deleting all and adding again",
    async (id) => {
      const f = await fixture();
      const before = recognized(f);
      await writeFile(before.outputs[0] ?? "", "historical export bytes");
      let job = f.jobs.removeSegment(before.id, id, before.revision);
      expect(job.revision).toBe(before.revision + 1);
      expect(job.segments).toEqual(
        before.segments.filter((segment) => segment.id !== id),
      );
      expect(job.style).toEqual({
        ...before.style,
        emphasisBySegment: before.style.emphasisBySegment.filter(
          (emphasis) => emphasis.segmentId !== id,
        ),
      });
      expect(job.stages.recognize).toEqual(before.stages.recognize);
      expect(job.stages.translate).toEqual(before.stages.translate);
      expect(job.previewUrl).toBeUndefined();
      expect(job.stages.export.state).toBe("idle");
      const remaining = job.segments[0];
      if (!remaining) throw new Error("Missing remaining cue");
      job = f.jobs.removeSegment(job.id, remaining.id, job.revision);
      expect(job.segments).toEqual([]);
      expect(job.style.emphasisBySegment).toEqual([]);
      expect(await f.jobs.recognize(job.id)).toEqual(job);
      job = f.jobs.addSegment(
        job.id,
        { startMs: 1, endMs: 2, sourceText: "again" },
        job.revision,
      );
      expect(job.segments).toHaveLength(1);
      expect(job.segments[0]?.id).not.toBe(remaining.id);
      expect(job.outputs).toEqual(before.outputs);
      expect(await readFile(before.outputs[0] ?? "", "utf8")).toBe(
        "historical export bytes",
      );
      expect(f.media.extract).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid timing/text, unknown IDs and stale revisions without changing any stored table or emitting a replacement", async () => {
    const f = await fixture();
    const job = recognized(f);
    const before = rows(f.store);
    f.emit.mockClear();
    const valid = { startMs: 0, endMs: 1, sourceText: "new" };
    for (const invalid of [
      { ...valid, startMs: -1 },
      { ...valid, startMs: 0.5 },
      { ...valid, endMs: 0 },
      { ...valid, endMs: -1 },
      { ...valid, endMs: NaN },
      { ...valid, endMs: Infinity },
      { ...valid, sourceText: " \n " },
      { ...valid, sourceText: "x".repeat(20001) },
      { ...valid, translatedText: "x".repeat(20001) },
      { ...valid, id: "client-owned" },
      { ...valid, translationStale: false },
    ])
      expect(() => f.jobs.addSegment(job.id, invalid, job.revision)).toThrow();
    expect(() =>
      f.jobs.addSegment(job.id, { ...valid, endMs: 5001 }, job.revision),
    ).toThrowError(expect.objectContaining({ code: "TIMING_INVALID" }));
    expect(() =>
      f.jobs.addSegment(job.id, valid, job.revision + 1),
    ).toThrowError(expect.objectContaining({ code: "STALE_REVISION" }));
    expect(() =>
      f.jobs.removeSegment(job.id, "first", job.revision + 1),
    ).toThrowError(expect.objectContaining({ code: "STALE_REVISION" }));
    expect(() =>
      f.jobs.removeSegment(job.id, "missing", job.revision),
    ).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(() => f.jobs.removeSegment(job.id, "", job.revision)).toThrow();
    expect(rows(f.store)).toEqual(before);
    expect(f.emit).not.toHaveBeenCalled();
  });

  it("allows exact text limits and rejects a 10001st cue without changing the existing timeline", async () => {
    const f = await fixture();
    const job = f.jobs.addSegment(
      f.job.id,
      {
        startMs: 0,
        endMs: 1,
        sourceText: "x".repeat(20000),
        translatedText: "译".repeat(20000),
      },
      f.job.revision,
    );
    expect(job.segments[0]?.sourceText).toHaveLength(20000);
    job.segments = Array.from({ length: 10000 }, (_, index) =>
      cue(`limit-${index}`, 0, 1),
    );
    f.store.saveJob(job);
    expect(() =>
      f.jobs.addSegment(
        job.id,
        { startMs: 0, endMs: 1, sourceText: "extra" },
        job.revision,
      ),
    ).toThrowError(expect.objectContaining({ code: "SEGMENT_LIMIT" }));
    expect(f.store.getJob(job.id).segments).toEqual(job.segments);
    expect(f.store.getJob(job.id).revision).toBe(job.revision);
  });

  it.each(["add", "remove"])(
    "rolls back all tables if %s persistence fails",
    async (operation) => {
      const f = await fixture();
      const job = recognized(f);
      const before = rows(f.store);
      f.emit.mockClear();
      f.store.sqlite.exec(
        `CREATE TRIGGER synthetic_failure BEFORE ${operation === "add" ? "INSERT" : "DELETE"} ON segments BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END;`,
      );
      expect(() =>
        operation === "add"
          ? f.jobs.addSegment(
              job.id,
              { startMs: 0, endMs: 1, sourceText: "new" },
              job.revision,
            )
          : f.jobs.removeSegment(job.id, "first", job.revision),
      ).toThrow("synthetic write failure");
      expect(rows(f.store)).toEqual(before);
      expect(f.emit).not.toHaveBeenCalled();
    },
  );

  it("rejects manual mutation while an export is running and preserves content on cancellation", async () => {
    const f = await fixture();
    const before = recognized(f);
    let entered: (() => void) | undefined;
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.media.render.mockImplementation(async () => {
      entered?.();
      await gate;
    });
    const pending = f.jobs.export(
      before.id,
      "mp4",
      "balanced",
      join(f.root, "cancelled.mp4"),
    );
    await started;
    const running = rows(f.store);
    expect(() =>
      f.jobs.addSegment(
        before.id,
        { startMs: 0, endMs: 1, sourceText: "new" },
        before.revision,
      ),
    ).toThrowError(expect.objectContaining({ code: "JOB_BUSY" }));
    expect(() =>
      f.jobs.removeSegment(before.id, "first", before.revision),
    ).toThrowError(expect.objectContaining({ code: "JOB_BUSY" }));
    const first = before.segments[0];
    if (!first) throw new Error("Missing fixture cue");
    expect(() =>
      f.jobs.editSegment(
        before.id,
        { ...first, sourceText: "busy edit" },
        before.revision,
      ),
    ).toThrowError(expect.objectContaining({ code: "JOB_BUSY" }));
    expect(rows(f.store)).toEqual(running);
    f.jobs.cancel(before.id);
    release?.();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(f.store.getJob(before.id).segments).toEqual(before.segments);
    expect(f.store.getJob(before.id).style).toEqual(before.style);
  });

  it("exports added, removed and corrected cues with current exact timing in SRT/ASS/VTT without calling AI or native recognition", async () => {
    const f = await fixture();
    const original = await readFile(f.input);
    let job = recognized(f);
    job = f.jobs.removeSegment(job.id, "first", job.revision);
    job = f.jobs.addSegment(
      job.id,
      {
        startMs: 1201,
        endMs: 1299,
        sourceText: "新增原文",
        translatedText: "新增译文",
      },
      job.revision,
    );
    const added = job.segments.find(
      (segment) => segment.sourceText === "新增原文",
    );
    if (!added) throw new Error("Missing added cue");
    job = f.jobs.editSegment(
      job.id,
      { ...added, startMs: 1203, endMs: 1307, translatedText: "修订译文" },
      job.revision,
    );
    job = f.jobs.updateOptions(job.id, {
      ...optionsSchema.parse(job.options),
      bilingual: true,
    });
    for (const format of ["srt", "ass", "vtt"] as const) {
      const destination = join(f.root, `current.${format}`);
      await f.jobs.export(job.id, format, "balanced", destination);
      const text = await readFile(destination, "utf8");
      expect(text).toContain("修订译文");
      expect(text).toContain("新增原文");
      expect(text).toContain("last");
      expect(text).not.toContain("first");
      expect(text).not.toContain("新增译文");
      expect(text).toContain(
        format === "ass"
          ? "0:00:01.20,0:00:01.31"
          : format === "srt"
            ? "00:00:01,203 --> 00:00:01,307"
            : "00:00:01.203 --> 00:00:01.307",
      );
    }
    expect(f.media.render).not.toHaveBeenCalled();
    expect(f.media.extract).not.toHaveBeenCalled();
    expect(f.runtime.executable).not.toHaveBeenCalled();
    expect(await readFile(f.input)).toEqual(original);
  });
});
