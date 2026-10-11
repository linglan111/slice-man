import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../../../src/main/db/store";
import { JobService } from "../../../src/main/services/jobs/lib/job-service";
import { MediaService } from "../../../src/main/services/media/lib/media-service";
import { runProcess } from "../../../src/main/lib/process";
import * as processTools from "../../../src/main/lib/process";
import * as fsTools from "node:fs/promises";
import type * as FsModule from "node:fs/promises";
import type { MockInstance } from "vitest";
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FsModule>()),
}));
import * as providers from "../../../src/main/services/providers/lib/text-provider";
import { compileSubtitles } from "../../../src/main/services/subtitles/lib/compiler";
import {
  optionsSchema,
  type Segment,
  type ReprocessInput,
  type Job,
  type Profile,
} from "../../../src/shared/contracts";
import {
  resolveReprocess,
  validateReview,
} from "../../../src/main/services/jobs/lib/reprocessing";

const fixtures: { root: string; store: Store }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
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
async function fixture(
  delay = 0,
  native = false,
): Promise<{
  root: string;
  input: string;
  media: MediaService;
  store: Store;
  jobs: JobService;
  job: Job;
  profile: Profile;
  runtime: Record<"modelPath" | "executable", ReturnType<typeof vi.fn>>;
  transcribe: MockInstance<typeof providers.transcribe>;
  translate: MockInstance<typeof providers.translateBatch>;
}> {
  const root = await mkdtemp(join(tmpdir(), "slice-partial-"));
  const input = join(root, "anonymous.mkv");
  const media = new MediaService({
    ffmpeg: resolve("resources/media/ffmpeg.exe"),
    ffprobe: resolve("resources/media/ffprobe.exe"),
    fonts: resolve("resources/fonts"),
  });
  await runProcess(media.paths.ffmpeg, [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=160x120:r=10:d=8",
    "-itsoffset",
    String(delay / 1000),
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=16000:duration=${8 - delay / 1000}`,
    "-c:v",
    "libx264",
    "-c:a",
    "pcm_s16le",
    input,
  ]);
  const store = new Store(join(root, "isolated.db"), {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error("unused");
    },
    decryptString: () => {
      throw new Error("unused");
    },
  });
  fixtures.push({ root, store });
  const profile = store.saveProfile({
    name: "fixture",
    protocol: "openai",
    baseUrl: "http://fixture.invalid/v1",
    model: "fixture",
    apiKey: "anonymous",
    sessionOnly: true,
  });
  const runtime = {
    modelPath: vi.fn(() => "fixture-model"),
    executable: vi.fn((gpu: boolean) => ({
      path: "fixture-whisper",
      backend: gpu ? ("gpu" as const) : ("cpu" as const),
    })),
  };
  const jobs = new JobService(
    store,
    media,
    runtime,
    root,
    vi.fn(),
    (path) => path,
  );
  const imported = await jobs.importVideo(input, undefined, {
    translationEnabled: true,
  });
  const job = jobs.updateOptions(
    imported.id,
    optionsSchema.parse({
      recognition: native ? "local" : "cloud",
      recognitionProfileId: profile.id,
      translationProfileId: profile.id,
      reviewProfileId: profile.id,
    }),
  );
  job.segments = [
    cue("a", 1100, 2000),
    cue("b", 2000, 3000),
    cue("c", 5000, 6000),
  ];
  job.style.emphasisBySegment = [
    { segmentId: "a", keywords: ["译文"] },
    { segmentId: "c", keywords: ["译文"] },
  ];
  job.stages.recognize = {
    state: "succeeded",
    progress: 1,
    message: "full fixture",
  };
  job.stages.translate = {
    state: "succeeded",
    progress: 1,
    message: "full fixture",
  };
  job.outputs = [join(root, "historical.srt")];
  await writeFile(job.outputs[0] ?? "", "historical");
  store.saveJob(job);
  const transcribe = vi.spyOn(providers, "transcribe").mockResolvedValue({
    segments: [{ start: 0.1, end: 0.6, text: "replacement" }],
  });
  const translate = vi
    .spyOn(providers, "translateBatch")
    .mockImplementation(async (_profile, _key, selected) =>
      selected.map((s) => ({ id: s.id, text: "replacement translated" })),
    );
  return {
    root,
    input,
    media,
    store,
    jobs,
    job,
    profile,
    runtime,
    transcribe,
    translate,
  };
}
function target(
  f: Awaited<ReturnType<typeof fixture>>,
  ids = ["a"],
): ReprocessInput {
  return {
    jobId: f.job.id,
    revision: f.store.getJob(f.job.id).revision,
    target: { mode: "selection", segmentIds: ids },
  };
}

describe("atomic partial processing and optional translation", () => {
  it("resolves nonadjacent selections, recursive overlaps, exact half-open edges and gaps", async () => {
    const f = await fixture();
    const job = f.store.getJob(f.job.id);
    job.segments.push(cue("overlap", 1500, 3500), cue("chain", 3400, 4000));
    const plan = resolveReprocess(job, {
      ...target(f, ["a", "c"]),
      operation: "recognize",
    });
    expect(plan.intervals).toEqual([
      { startMs: 1100, endMs: 4000 },
      { startMs: 5000, endMs: 6000 },
    ]);
    expect(plan.segmentIds).toEqual(["a", "b", "c", "overlap", "chain"]);
    expect(
      resolveReprocess(job, {
        ...target(f, ["a", "c"]),
        operation: "translate",
      }).segmentIds,
    ).toEqual(["a", "c"]);
    expect(
      f.jobs.planReprocess({
        ...target(f),
        target: { mode: "range", startMs: 4000, endMs: 5000 },
        operation: "recognize",
      }).affectedCount,
    ).toBe(0);
    expect(() =>
      f.jobs.planReprocess({
        ...target(f),
        target: { mode: "range", startMs: 4000, endMs: 5000 },
        operation: "translate",
      }),
    ).toThrowError(expect.objectContaining({ code: "NO_SEGMENTS" }));
    expect(() =>
      f.jobs.planReprocess({
        ...target(f, ["missing"]),
        operation: "recognize",
      }),
    ).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(() =>
      f.jobs.planReprocess({
        ...target(f, ["a", "a"]),
        operation: "recognize",
      }),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_ID" }));
    expect(() =>
      f.jobs.planReprocess({
        ...target(f),
        revision: 999,
        operation: "recognize",
      }),
    ).toThrowError(expect.objectContaining({ code: "STALE_REVISION" }));
  });
  it("crops actual delayed audio and adds later/disjoint video offsets once, retaining unrelated text/style/export", async () => {
    const f = await fixture(1000);
    const sizes: number[] = [];
    f.transcribe.mockImplementation(async (_profile, _key, audio) => {
      sizes.push(audio.length);
      return { segments: [{ start: 0.1, end: 0.6, text: "replacement" }] };
    });
    const updated = await f.jobs.recognizePartial({
      ...target(f, ["a", "c"]),
      translate: true,
    });
    expect(updated.segments.map((s) => [s.startMs, s.endMs])).toEqual([
      [1200, 1700],
      [2000, 3000],
      [5100, 5600],
    ]);
    expect(sizes).toHaveLength(2);
    expect(sizes.every((size) => size > 25000 && size < 33000)).toBe(true);
    expect(updated.segments[1]).toEqual(f.job.segments[1]);
    expect(updated.segments[0]?.id).not.toBe("a");
    expect(updated.style.emphasisBySegment).toEqual([]);
    expect(await readFile(updated.outputs[0] ?? "", "utf8")).toBe("historical");
    expect(updated.stages.recognize.message).toContain("2 个区间");
  });
  it("preserves all prior content on combined translation failure and cancel after recognition", async () => {
    const f = await fixture();
    f.translate.mockRejectedValue(new Error("fixture failure"));
    await expect(
      f.jobs.recognizePartial({ ...target(f), translate: true }),
    ).rejects.toThrow("fixture failure");
    expect(f.store.getJob(f.job.id).segments).toEqual(f.job.segments);
    expect(f.store.getJob(f.job.id).style).toEqual(f.job.style);
    expect(f.store.getJob(f.job.id).revision).toBe(f.job.revision);
    f.translate.mockImplementation(async () => {
      f.jobs.cancel(f.job.id);
      return [];
    });
    await expect(
      f.jobs.recognizePartial({ ...target(f), translate: true }),
    ).rejects.toThrowError(expect.objectContaining({ code: "CANCELLED" }));
    expect(f.store.getJob(f.job.id).segments).toEqual(f.job.segments);
  });
  it("cleans owned files before publication so cancellation or cleanup failure cannot replace old content", async () => {
    const f = await fixture();
    const original = fsTools.rm;
    let shouldCancel = true;
    const cleanup = vi
      .spyOn(fsTools, "rm")
      .mockImplementation(async (path, options) => {
        if (String(path).includes("partial-")) {
          if (shouldCancel) f.jobs.cancel(f.job.id);
          else throw new Error("fixture cleanup failure");
        }
        return original(path, options);
      });
    await expect(f.jobs.recognizePartial(target(f))).rejects.toThrowError(
      expect.objectContaining({ code: "CANCELLED" }),
    );
    expect(f.store.getJob(f.job.id).segments).toEqual(f.job.segments);
    shouldCancel = false;
    await expect(f.jobs.recognizePartial(target(f))).rejects.toThrow(
      "fixture cleanup failure",
    );
    expect(f.store.getJob(f.job.id).revision).toBe(f.job.revision);
    expect(f.store.getJob(f.job.id).segments).toEqual(f.job.segments);
    cleanup.mockRestore();
  });
  it("preserves unrelated emphasis on one range; silent recognition removes only target and does not promote invalid full recognition", async () => {
    const f = await fixture();
    f.transcribe.mockResolvedValue({ segments: [] });
    const prior = f.store.getJob(f.job.id);
    prior.stages.recognize.state = "idle";
    f.store.saveJob(prior);
    const updated = await f.jobs.recognizePartial(target(f));
    expect(updated.segments).toEqual(f.job.segments.slice(1));
    expect(updated.style.emphasisBySegment).toEqual([
      { segmentId: "c", keywords: ["译文"] },
    ]);
    expect(updated.stages.recognize.state).toBe("idle");
    expect(updated.stages.recognize.message).toContain("未识别到语音");
  });
  it("rejects cropped timestamps escaping the target and protects content when source identity changes", async () => {
    const f = await fixture();
    f.transcribe.mockResolvedValue({
      segments: [{ start: 0, end: 3, text: "out of crop" }],
    });
    await expect(f.jobs.recognizePartial(target(f))).rejects.toThrowError(
      expect.objectContaining({ code: "TIMING_INVALID" }),
    );
    f.transcribe.mockImplementation(async () => {
      await writeFile(f.input, "changed");
      return { segments: [] };
    });
    await expect(f.jobs.recognizePartial(target(f))).rejects.toThrowError(
      expect.objectContaining({ code: "INPUT_CHANGED" }),
    );
    expect(f.store.getJob(f.job.id).segments).toEqual(f.job.segments);
  });
  it("runs clip-local native normalization with no history and actual CPU fallback", async () => {
    const f = await fixture(0, true);
    const original = processTools.runProcess;
    const calls: string[][] = [];
    vi.spyOn(processTools, "runProcess").mockImplementation(
      async (path, args, options) => {
        if (path !== "fixture-whisper") return original(path, args, options);
        calls.push(args);
        const output = args[args.indexOf("-of") + 1];
        await writeFile(
          `${output}.json`,
          JSON.stringify({
            transcription: [
              { offsets: { from: 100, to: 600 }, text: "native replacement" },
            ],
          }),
        );
        return { stdout: "", stderr: "no actual GPU proof" };
      },
    );
    const updated = await f.jobs.recognizePartial(target(f, ["c"]));
    expect(updated.actualBackend).toBe("cpu");
    expect(updated.segments.at(-1)).toMatchObject({
      startMs: 5100,
      endMs: 5600,
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((args) => args[args.indexOf("-mc") + 1] === "0")).toBe(
      true,
    );
    expect(calls[1]).toContain("-ng");
  });
  it("original-only imports and all translation APIs guard zero calls; every subtitle format ignores stored translation", async () => {
    const f = await fixture();
    const imported = await f.jobs.importVideo(f.input, undefined, {
      translationEnabled: false,
    });
    expect(imported.options.translationEnabled).toBe(false);
    expect(optionsSchema.parse({}).translationEnabled).toBe(true);
    const job = f.jobs.updateOptions(f.job.id, {
      ...f.job.options,
      translationEnabled: false,
    });
    await expect(f.jobs.translate(job.id)).rejects.toThrowError(
      expect.objectContaining({ code: "TRANSLATION_DISABLED" }),
    );
    await expect(f.jobs.translatePartial(target(f))).rejects.toThrowError(
      expect.objectContaining({ code: "TRANSLATION_DISABLED" }),
    );
    await expect(
      f.jobs.recognizePartial({ ...target(f), translate: true }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "TRANSLATION_DISABLED" }),
    );
    expect(f.translate).not.toHaveBeenCalled();
    expect(f.transcribe).not.toHaveBeenCalled();
    for (const format of ["ass", "srt", "vtt"] as const) {
      const text = compileSubtitles(
        job.segments,
        job.style,
        job.media,
        true,
        format,
        false,
      );
      expect(text).toContain("source a");
      expect(text).not.toContain("译文");
    }
    const path = join(f.root, "source.srt");
    await f.jobs.export(job.id, "srt", "balanced", path);
    expect(await readFile(path, "utf8")).toContain("source a");
    expect(
      f.jobs.updateOptions(job.id, { ...job.options, translationEnabled: true })
        .segments,
    ).toEqual(job.segments);
  });
  it("partial translation keeps IDs, timing and unselected content with an atomic revision", async () => {
    const f = await fixture();
    const result = await f.jobs.translatePartial(target(f, ["a", "c"]));
    expect(result.revision).toBe(f.job.revision + 1);
    expect(result.segments[1]).toEqual(f.job.segments[1]);
    expect(result.segments[0]).toMatchObject({
      id: "a",
      startMs: 1100,
      endMs: 2000,
      translatedText: "replacement translated",
    });
    expect(f.transcribe).not.toHaveBeenCalled();
  });
  it("late translation-batch failure publishes none of the previous successful batches", async () => {
    const f = await fixture();
    const job = f.store.getJob(f.job.id);
    job.segments = Array.from({ length: 35 }, (_, index) =>
      cue(`batch-${index}`, index * 100, index * 100 + 80),
    );
    f.store.saveJob(job);
    f.translate
      .mockImplementationOnce(async (_profile, _key, selected) =>
        selected.map((s) => ({ id: s.id, text: "drafted" })),
      )
      .mockRejectedValueOnce(new Error("late batch failure"));
    await expect(
      f.jobs.translatePartial(
        target(
          f,
          job.segments.map((s) => s.id),
        ),
      ),
    ).rejects.toThrow("late batch failure");
    expect(f.store.getJob(job.id).segments).toEqual(job.segments);
    expect(f.store.getJob(job.id).revision).toBe(job.revision);
  });
  it("one committed partial publication remains a successful outcome if cancellation arrives at the commit boundary", async () => {
    const f = await fixture();
    const save = f.store.saveJob.bind(f.store);
    vi.spyOn(f.store, "saveJob").mockImplementation((job) => {
      const result = save(job);
      if (job.revision > f.job.revision) f.jobs.cancel(job.id);
      return result;
    });
    const result = await f.jobs.recognizePartial(target(f));
    expect(result.revision).toBe(f.job.revision + 1);
    expect(result.stages.recognize.state).toBe("succeeded");
    expect(result.stages.translate.state).toBe("idle");
  });
});

function reviewResponse(prompt: string, flagged = new Set<string>()): string {
  const data = JSON.parse(prompt.split("\n")[1] ?? "{}") as {
    selected: { id: string }[];
  };
  return JSON.stringify({
    assessments: data.selected.map((s) => ({
      segmentId: s.id,
      issues: flagged.has(s.id)
        ? [
            {
              ruleId: "source.meaning_problem",
              reason: "当前原文的词句存在具体含义问题，需试听",
              evidenceIds: [s.id],
            },
          ]
        : [],
    })),
  });
}
describe("text-only review metadata lifecycle", () => {
  it("uses exactly the same actual context and rubric in full and sparse selected scans, then merges every explicit grade", async () => {
    const f = await fixture();
    const job = f.store.getJob(f.job.id);
    job.segments = Array.from({ length: 65 }, (_, index) =>
      cue(`window-${index}`, index * 100, index * 100 + 80),
    );
    f.store.saveJob(job);
    const received: {
      selected: { id: string }[];
      context: Segment[];
      rubric: unknown;
    }[] = [];
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_profile, _key, prompt) => {
        received.push(JSON.parse(prompt.split("\n")[1] ?? "{}"));
        return reviewResponse(prompt);
      },
    );
    const full = await f.jobs.reviewSubtitles({
      jobId: job.id,
      revision: job.revision,
    });
    expect(full.reviewReport?.assessments).toHaveLength(65);
    expect(
      full.reviewReport?.assessments?.every(
        (a) => a.riskLevel === "none" && a.status === "current",
      ),
    ).toBe(true);
    const fullRequests = received.splice(0);
    const ids = ["window-0", "window-29", "window-30", "window-64"];
    const sparse = await f.jobs.reviewSubtitles({
      jobId: job.id,
      revision: job.revision,
      segmentIds: ids,
    });
    expect(
      received.flatMap((request) => request.selected.map((s) => s.id)),
    ).toEqual(ids);
    for (const request of received) {
      const prior = fullRequests.find((candidate) =>
        candidate.selected.some((s) => s.id === request.selected[0]?.id),
      );
      expect(request.context).toEqual(prior?.context);
      expect(request.rubric).toEqual(prior?.rubric);
    }
    expect(sparse.reviewReport?.assessments).toHaveLength(65);
    expect(sparse.reviewReport?.state).toBe("complete");
    expect(f.transcribe).not.toHaveBeenCalled();
    expect(f.translate).not.toHaveBeenCalled();
  });
  it("late-batch incomplete scan fails atomically rather than filling missing assessments with none", async () => {
    const f = await fixture();
    const job = f.store.getJob(f.job.id);
    job.segments = Array.from({ length: 35 }, (_, index) =>
      cue(`atomic-${index}`, index * 100, index * 100 + 80),
    );
    f.store.saveJob(job);
    const generated = vi
      .spyOn(providers, "generateText")
      .mockImplementation(async (_profile, _key, prompt) =>
        reviewResponse(prompt),
      );
    const previous = await f.jobs.reviewSubtitles({
      jobId: job.id,
      revision: job.revision,
    });
    generated
      .mockImplementationOnce(async (_profile, _key, prompt) =>
        reviewResponse(prompt),
      )
      .mockResolvedValueOnce('{"assessments":[]}');
    await expect(
      f.jobs.reviewSubtitles({ jobId: job.id, revision: job.revision }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "REVIEW_INCOMPLETE" }),
    );
    expect(f.store.getJob(job.id).reviewReport).toEqual(previous.reviewReport);
  });
  it("source-only review omits inactive translations and makes zero audio or translation calls", async () => {
    const f = await fixture();
    const job = f.jobs.updateOptions(f.job.id, {
      ...f.job.options,
      translationEnabled: false,
    });
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_profile, _key, prompt) => {
        const input = JSON.parse(prompt.split("\n")[1] ?? "{}") as {
          context: Segment[];
          translationEnabled: boolean;
        };
        expect(input.translationEnabled).toBe(false);
        expect(input.context.every((s) => s.translatedText === "")).toBe(true);
        expect(prompt).not.toContain("译文 a");
        return reviewResponse(prompt);
      },
    );
    const result = await f.jobs.reviewSubtitles({
      jobId: job.id,
      revision: job.revision,
    });
    expect(
      result.reviewReport?.assessments?.every((a) => a.riskLevel === "none"),
    ).toBe(true);
    expect(f.transcribe).not.toHaveBeenCalled();
    expect(f.translate).not.toHaveBeenCalled();
  });
  it("covers long timelines over bounded prompts, records honest per-batch progress and persists findings across reopening", async () => {
    const f = await fixture();
    const job = f.store.getJob(f.job.id);
    job.segments = Array.from({ length: 70 }, (_, index) => ({
      ...cue(`many-${index}`, index * 100, index * 100 + 80),
      sourceText: "text".repeat(300),
    }));
    f.store.saveJob(job);
    const batches: string[][] = [];
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_profile, _key, prompt) => {
        expect(prompt.length).toBeLessThan(42000);
        const data = JSON.parse(prompt.split("\n")[1] ?? "{}") as {
          selected: Segment[];
        };
        batches.push(data.selected.map((s) => s.id));
        return reviewResponse(prompt);
      },
    );
    const result = await f.jobs.reviewSubtitles({
      jobId: job.id,
      revision: job.revision,
    });
    expect(batches.length).toBeGreaterThan(2);
    expect(batches.flat()).toEqual(job.segments.map((s) => s.id));
    expect(result.reviewReport?.reviewedSegmentIds).toHaveLength(70);
    const reopened = new Store(join(f.root, "isolated.db"), {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error("unused");
      },
      decryptString: () => {
        throw new Error("unused");
      },
    });
    try {
      expect(reopened.getJob(job.id).reviewReport).toEqual(result.reviewReport);
    } finally {
      reopened.close();
    }
    job.segments[0] = {
      ...cue("huge", 0, 80),
      sourceText: "a".repeat(20000),
      translatedText: "b".repeat(20000),
    };
    f.store.saveJob(job);
    await expect(
      f.jobs.reviewSubtitles({ jobId: job.id, revision: job.revision }),
    ).rejects.toThrowError(expect.objectContaining({ code: "TEXT_LIMIT" }));
  });
  it("review-only provider invalidation changes metadata without invalidating subtitle revision or exports", async () => {
    const f = await fixture();
    const profile = f.store.saveProfile({
      name: "review only",
      protocol: "openai",
      baseUrl: "http://fixture.invalid/v1",
      model: "review",
      apiKey: "anonymous",
      sessionOnly: true,
    });
    const changed = f.jobs.updateOptions(f.job.id, {
      ...f.job.options,
      reviewProfileId: profile.id,
    });
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_profile, _key, prompt) => reviewResponse(prompt, new Set(["a"])),
    );
    const reviewed = await f.jobs.reviewSubtitles({
      jobId: changed.id,
      revision: changed.revision,
    });
    const { hasKey: _key, ...input } = profile;
    f.store.saveProfile({ ...input, model: "new-review" });
    const stale = f.store.getJob(changed.id);
    expect(stale.revision).toBe(reviewed.revision);
    expect(stale.stages.export).toEqual(reviewed.stages.export);
    expect(stale.reviewReport?.state).toBe("stale");
    expect(stale.reviewReport?.findings[0]?.status).toBe("recheck");
    expect(
      stale.reviewReport?.assessments?.every((a) => a.status === "recheck"),
    ).toBe(true);
  });
  it("remaps replacement findings to fresh cue IDs as recheck reminders", async () => {
    const f = await fixture();
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_profile, _key, prompt) => reviewResponse(prompt, new Set(["a"])),
    );
    await f.jobs.reviewSubtitles({ jobId: f.job.id, revision: f.job.revision });
    const result = await f.jobs.recognizePartial(target(f));
    const finding = result.reviewReport?.findings[0];
    expect(finding?.segmentId).toBe(result.segments[0]?.id);
    expect(finding?.status).toBe("recheck");
    expect(finding?.riskLevel).toBeUndefined();
    expect(
      result.reviewReport?.assessments?.some(
        (a) => a.segmentId === finding?.segmentId,
      ),
    ).toBe(false);
    expect(result.reviewReport?.state).toBe("stale");
    vi.mocked(providers.generateText).mockImplementation(
      async (_profile, _key, prompt) => reviewResponse(prompt),
    );
    const replacementId = result.segments[0]?.id;
    if (!replacementId) throw new Error("missing replacement");
    const refreshed = await f.jobs.reviewSubtitles({
      jobId: f.job.id,
      revision: result.revision,
      segmentIds: [replacementId],
    });
    expect(refreshed.reviewReport?.state).toBe("stale");
    expect(refreshed.reviewReport?.findings).toEqual([]);
    expect(refreshed.reviewReport?.reviewedSegmentIds).not.toContain("a");
  });
  it("checks bounded batches with context and persists ignore without invalidating media revision; edits require recheck", async () => {
    const f = await fixture();
    const generated = vi
      .spyOn(providers, "generateText")
      .mockImplementation(async (_profile, _key, prompt) => {
        const data = JSON.parse(prompt.split("\n")[1] ?? "{}") as {
          selected: Segment[];
          context: Segment[];
        };
        expect(data.context.every((s) => s.sourceText.length > 0)).toBe(true);
        return reviewResponse(prompt, new Set(data.selected.map((s) => s.id)));
      });
    const reviewed = await f.jobs.reviewSubtitles({
      jobId: f.job.id,
      revision: f.job.revision,
    });
    expect(generated).toHaveBeenCalledOnce();
    expect(f.transcribe).not.toHaveBeenCalled();
    expect(f.translate).not.toHaveBeenCalled();
    expect(reviewed.revision).toBe(f.job.revision);
    const report = reviewed.reviewReport;
    const finding = report?.findings[0];
    if (!report || !finding) throw new Error("missing report");
    const ignored = f.jobs.acknowledgeFinding({
      jobId: f.job.id,
      reportId: report.id,
      findingId: finding.id,
      status: "ignored",
    });
    expect(ignored.revision).toBe(f.job.revision);
    expect(ignored.reviewReport?.findings[0]?.status).toBe("ignored");
    const segment = ignored.segments[0];
    if (!segment) throw new Error("missing cue");
    const edited = f.jobs.editSegment(
      f.job.id,
      { ...segment, sourceText: "edited" },
      ignored.revision,
    );
    expect(edited.reviewReport?.state).toBe("stale");
    expect(edited.reviewReport?.findings[0]?.status).toBe("recheck");
    expect(edited.reviewReport?.findings[1]?.status).toBe("recheck");
    const refreshed = await f.jobs.reviewSubtitles({
      jobId: f.job.id,
      revision: edited.revision,
      segmentIds: [segment.id],
    });
    expect(refreshed.reviewReport?.state).toBe("stale");
    expect(refreshed.reviewReport?.findings).toHaveLength(3);
    const { hasKey: _hasKey, ...profileInput } = f.profile;
    f.store.saveProfile({ ...profileInput, model: "changed" });
    expect(f.store.getJob(f.job.id).reviewReport?.state).toBe("stale");
    expect(f.store.getJob(f.job.id).revision).toBe(refreshed.revision + 1);
  });
  it("failed/invalid/cancelled scan keeps prior report; strict output rejects unknown IDs and impossible translation findings", async () => {
    const f = await fixture();
    const generated = vi
      .spyOn(providers, "generateText")
      .mockImplementation(async (_profile, _key, prompt) =>
        reviewResponse(prompt),
      );
    const previous = await f.jobs.reviewSubtitles({
      jobId: f.job.id,
      revision: f.job.revision,
    });
    generated.mockResolvedValue(
      '{"assessments":[{"segmentId":"unknown","issues":[]}]}',
    );
    await expect(
      f.jobs.reviewSubtitles({ jobId: f.job.id, revision: f.job.revision }),
    ).rejects.toThrowError(expect.objectContaining({ code: "REVIEW_IDS" }));
    expect(f.store.getJob(f.job.id).reviewReport).toEqual(
      previous.reviewReport,
    );
    generated.mockImplementation(async () => {
      f.jobs.cancel(f.job.id);
      return '{"findings":[]}';
    });
    await expect(
      f.jobs.reviewSubtitles({ jobId: f.job.id, revision: f.job.revision }),
    ).rejects.toThrowError(expect.objectContaining({ code: "CANCELLED" }));
    expect(f.store.getJob(f.job.id).reviewReport).toEqual(
      previous.reviewReport,
    );
    expect(() =>
      validateReview(
        {
          findings: [
            { segmentId: "a", category: "translation", reason: "bad" },
          ],
        },
        f.job.segments,
        false,
      ),
    ).toThrowError(expect.objectContaining({ code: "REVIEW_IDS" }));
  });
});
