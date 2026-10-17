import { createRepairAudit, mergeRepairAudits, validateRepairAudit } from "../../../src/main/services/jobs/lib/repair-adjudication";
import { newCoveragePlan } from "../../../src/main/services/jobs/lib/chapters";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { AppError } from "../../../src/main/lib/errors";
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
  type RepairLoopInput,
  type ReviewRuleId,
  repairLoopInputSchema,
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
    // A selected operation spans two explicit canonical chapters; a failed
    // second chapter must not publish the successful first chapter.
    job.segments = Array.from({ length: 151 }, (_, index) =>
      cue(`batch-${index}`, index * 40, index * 40 + 30),
    );
    job.chapterPlan = newCoveragePlan(job);
    const first = job.chapterPlan.chapters[0];
    if (!first) throw new Error("missing coverage");
    job.chapterPlan.chapters = [{ ...first, endMs: 3000 }, { ...first, id: "second", startMs: 3000 }];
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

type ReviewFixturePrompt = {
  selected: (Segment & { n: number })[];
  context: (Segment & { n: number })[];
  rubric: unknown;
  translationEnabled: boolean;
  groups: { targets: number[]; context: number[] }[];
};
function parseReviewPrompt(prompt: string): ReviewFixturePrompt {
  const data = JSON.parse(prompt.split("\n")[1] ?? "{}") as {
    cues: (Omit<Segment, "id" | "translationStale"> & { n: number })[];
    groups: { targets: number[]; context: number[] }[];
    rubric: unknown;
    translationEnabled: boolean;
  };
  const all =
    fixtures.flatMap((f) => f.store.listJobs()).at(-1)?.segments ?? [];
  const sorted = [...all].sort(
    (a, b) =>
      a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id),
  );
  const context = data.cues.map((c) => ({
    ...c,
    id: sorted[c.n]?.id ?? `alias-${c.n}`,
    translationStale: false,
  }));
  const targets = new Set(data.groups.flatMap((g) => g.targets));
  return {
    ...data,
    context,
    selected: context.filter((c) => targets.has(c.n)),
  };
}
function auditResponse(prompt: string): string | undefined {
  if (!prompt.startsWith("Audit subtitle repairs")) return undefined;
  const data = JSON.parse(prompt.split("\n").at(-1) ?? "{}") as {
    targets: { id: string; freshIds: string[] }[]; fresh: Segment[];
  };
  return JSON.stringify({ targets: data.targets.map((target) => ({ id: target.id, replacementIds: target.freshIds })), segments: data.fresh });
}
function reviewResponse(prompt: string, flagged = new Set<string>()): string {
  const audit = auditResponse(prompt); if (audit) return audit;
  const data = parseReviewPrompt(prompt);
  return JSON.stringify({
    a: data.selected.map((s) => [
      s.n,
      flagged.has(s.id)
        ? [
            [
              "source.meaning_problem",
              "当前原文的词句存在具体含义问题，需试听",
              [s.n],
            ],
          ]
        : [],
    ]),
  });
}
function repairResponse(
  prompt: string,
  rule: (cue: Segment) => ReviewRuleId[],
): string {
  const audit = auditResponse(prompt); if (audit) return audit;
  const data = parseReviewPrompt(prompt);
  return JSON.stringify({
    a: data.selected.map((s) => [
      s.n,
      rule(s).map((ruleId) => [ruleId, "fixture concrete issue", [s.n]]),
    ]),
  });
}
function loopInput(
  job: Job,
  extra: Partial<RepairLoopInput> = {},
): RepairLoopInput {
  return {
    jobId: job.id,
    revision: job.revision,
    threshold: "medium",
    maxRounds: 3,
    scope: { mode: "all" },
    ...extra,
  };
}
describe("main-owned bounded automatic repair", () => {
  it("analysis cancellation retains old valid report and never requests repair", async () => {
    const f = await fixture();
    const generated = vi
      .spyOn(providers, "generateText")
      .mockImplementation(async (_p, _k, prompt) => reviewResponse(prompt));
    const previous = await f.jobs.reviewSubtitles({
      jobId: f.job.id,
      revision: f.job.revision,
    });
    const edited = f.jobs.editSegment(
      previous.id,
      { ...(previous.segments[0] as Segment), sourceText: "changed" },
      previous.revision,
    );
    const before = f.store.getJob(edited.id);
    generated.mockImplementationOnce(async (_p, _k, prompt) => {
      f.jobs.cancel(f.job.id);
      return reviewResponse(prompt);
    });
    await expect(f.jobs.repairLoop(loopInput(edited))).rejects.toMatchObject({
      code: "CANCELLED",
    });
    const result = f.store.getJob(edited.id);
    expect(result.reviewReport).toEqual(before.reviewReport);
    expect(result.repairRun).toMatchObject({
      state: "cancelled",
      committedRounds: 0,
    });
    expect(result.repairRun?.remainingCount).toBeUndefined();
    expect(f.transcribe).not.toHaveBeenCalled();
  });
  it("cancellation within ASR retains target and previous successful round survives later failure", async () => {
    const f = await fixture();
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) =>
        repairResponse(prompt, () => ["source.meaning_problem"]),
    );
    f.transcribe.mockImplementationOnce(async () => {
      f.jobs.cancel(f.job.id);
      return { segments: [] };
    });
    await expect(
      f.jobs.repairLoop(
        loopInput(f.job, {
          scope: { mode: "range", startMs: 1300, endMs: 1600 },
        }),
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(f.store.getJob(f.job.id).segments).toEqual(f.job.segments);
    f.transcribe
      .mockResolvedValueOnce({
        segments: [{ start: 0, end: 0.5, text: "first completed round" }],
      })
      .mockRejectedValueOnce(new Error("second round fixture failed"));
    const current = f.store.getJob(f.job.id);
    await expect(
      f.jobs.repairLoop(
        loopInput(current, {
          scope: { mode: "range", startMs: 1300, endMs: 1600 },
        }),
      ),
    ).rejects.toThrow();
    const result = f.store.getJob(f.job.id);
    expect(result.repairRun).toMatchObject({
      state: "failed",
      committedRounds: 1,
      remainingCount: 1,
    });
    expect(
      result.segments.some((s) => s.sourceText === "first completed round"),
    ).toBe(true);
    expect(result.revision).toBe(f.job.revision + 1);
  });
  it("direct persisted style conflict rejects the draft without overwriting concurrent content", async () => {
    const f = await fixture();
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => reviewResponse(prompt, new Set(["a"])),
    );
    f.translate.mockImplementationOnce(async (_p, _k, selected) => {
      const changed = f.store.getJob(f.job.id);
      changed.style.textColor = "#FF0000";
      changed.revision++;
      f.store.saveJob(changed);
      return selected.map((s) => ({ id: s.id, text: "new" }));
    });
    await expect(f.jobs.repairLoop(loopInput(f.job))).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    const result = f.store.getJob(f.job.id);
    expect(result.style.textColor).toBe("#FF0000");
    expect(result.segments).toEqual(f.job.segments);
    expect(result.repairRun).toMatchObject({
      committedRounds: 0,
      state: "failed",
    });
    expect(result.repairRun?.remainingCount).toBeUndefined();
  });
  it("merges overlapping ASR coverage and translates the mixed draft in one content save", async () => {
    const f = await fixture();
    const job = f.store.getJob(f.job.id);
    job.segments = [
      cue("a", 1100, 2100),
      cue("b", 2000, 3000),
      cue("c", 5000, 6000),
    ];
    f.store.saveJob(job);
    // The merged acoustic cue covers both overlapping originals; unrelated
    // evidence near only A must never stand in for B's repair coverage.
    f.transcribe.mockResolvedValueOnce({ segments: [{ start: 0, end: 1.9, text: "replacement" }] });
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) =>
        repairResponse(prompt, (s) =>
          s.id === "a"
            ? ["source.meaning_problem"]
            : ["b", "c"].includes(s.id) && s.translatedText.startsWith("译文")
              ? ["translation.meaning_problem"]
              : [],
        ),
    );
    const save = vi.spyOn(f.store, "saveJob");
    const result = await f.jobs.repairLoop(loopInput(job));
    expect(result.repairRun).toMatchObject({
      committedRounds: 1,
      affectedCount: 3,
      reason: "no_eligible",
      effectiveIntervals: [
        { startMs: 1100, endMs: 3000 },
        { startMs: 5000, endMs: 6000 },
      ],
    });
    expect(f.transcribe).toHaveBeenCalledTimes(2);
    expect(f.translate).toHaveBeenCalledTimes(1);
    expect(f.translate.mock.calls[0]?.[2].map((s) => s.id)).toEqual(result.segments.map((s) => s.id));
    expect(result.segments.some((s) => s.id === "b")).toBe(false);
    expect(result.segments.find((s) => s.startMs >= 5000)?.translatedText).toBe(
      "replacement translated",
    );
    expect(new Set(save.mock.calls.map(([j]) => j.revision))).toEqual(
      new Set([job.revision, job.revision + 1]),
    );
  });
  it("retains completed round when cancellation lands immediately after its transaction", async () => {
    const f = await fixture();
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => reviewResponse(prompt, new Set(["a"])),
    );
    const save = f.store.saveJob.bind(f.store);
    vi.spyOn(f.store, "saveJob").mockImplementation((job) => {
      const result = save(job);
      if (job.revision > f.job.revision && job.repairRun?.phase === "commit")
        f.jobs.cancel(job.id);
      return result;
    });
    await expect(f.jobs.repairLoop(loopInput(f.job))).rejects.toMatchObject({
      code: "CANCELLED",
    });
    const result = f.store.getJob(f.job.id);
    expect(result.repairRun).toMatchObject({
      state: "cancelled",
      committedRounds: 1,
    });
    expect(result.repairRun?.remainingCount).toBeUndefined();
    expect(result.segments.some((s) => s.sourceText === "replacement")).toBe(
      true,
    );
  });
  it("cancel at pre-commit phase publishes no draft; cancellation during analysis preserves report", async () => {
    const f = await fixture();
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => reviewResponse(prompt, new Set(["a"])),
    );
    const save = f.store.saveJob.bind(f.store);
    vi.spyOn(f.store, "saveJob").mockImplementation((job) => {
      if (job.repairRun?.phase === "commit" && job.revision === f.job.revision)
        f.jobs.cancel(job.id);
      return save(job);
    });
    await expect(f.jobs.repairLoop(loopInput(f.job))).rejects.toMatchObject({
      code: "CANCELLED",
    });
    expect(f.store.getJob(f.job.id).segments).toEqual(f.job.segments);
    expect(f.store.getJob(f.job.id).repairRun?.committedRounds).toBe(0);
  });
  it("successful silent ASR removes target and reports no eligible without requesting empty review", async () => {
    const f = await fixture();
    f.transcribe.mockResolvedValueOnce({ segments: [] });
    const review = vi
      .spyOn(providers, "generateText")
      .mockImplementation(async (_p, _k, prompt) =>
        reviewResponse(prompt, new Set(["a"])),
      );
    const result = await f.jobs.repairLoop(
      loopInput(f.job, {
        scope: { mode: "range", startMs: 1500, endMs: 1700 },
      }),
    );
    expect(result.segments).toEqual(f.job.segments.slice(1));
    expect(result.repairRun).toMatchObject({
      reason: "no_eligible",
      committedRounds: 1,
      remainingCount: 0,
    });
    expect(review).toHaveBeenCalledTimes(2);
    expect(f.translate).not.toHaveBeenCalled();
  });
  it("validates caps and range before any provider call, including empty exact-touching scope", async () => {
    const f = await fixture();
    const review = vi.spyOn(providers, "generateText");
    for (const maxRounds of [0, -1, 1.2, 21, NaN, Infinity])
      expect(
        repairLoopInputSchema.safeParse(loopInput(f.job, { maxRounds }))
          .success,
      ).toBe(false);
    for (const scope of [
      { mode: "range" as const, startMs: 2000, endMs: 1000 },
      { mode: "range" as const, startMs: 0, endMs: 9000 },
    ])
      await expect(
        f.jobs.repairLoop(loopInput(f.job, { scope })),
      ).rejects.toMatchObject({ code: "TIMING_INVALID" });
    const result = await f.jobs.repairLoop(
      loopInput(f.job, {
        scope: { mode: "range", startMs: 3000, endMs: 5000 },
      }),
    );
    expect(result.repairRun).toMatchObject({
      reason: "no_eligible",
      remainingCount: 0,
      committedRounds: 0,
    });
    expect(review).not.toHaveBeenCalled();
    expect(f.transcribe).not.toHaveBeenCalled();
  });
  it("repairs only pending scoped medium issues, generates fresh IDs, reevaluates and permits rerun", async () => {
    const f = await fixture();
    const review = vi
      .spyOn(providers, "generateText")
      .mockImplementation(async (_p, _k, prompt) =>
        repairResponse(prompt, (s) =>
          s.sourceText.startsWith("source") ? ["source.meaning_problem"] : [],
        ),
      );
    const originalC = f.job.segments.find((s) => s.id === "c");
    const result = await f.jobs.repairLoop(
      loopInput(f.job, {
        scope: { mode: "range", startMs: 1500, endMs: 1700 },
      }),
    );
    expect(result.repairRun).toMatchObject({
      reason: "no_eligible",
      committedRounds: 1,
      remainingCount: 0,
      effectiveIntervals: [{ startMs: 1100, endMs: 2000 }],
    });
    expect(result.segments.find((s) => s.id === "a")).toBeUndefined();
    expect(result.segments.find((s) => s.id === "c")).toEqual(originalC);
    expect(result.style.emphasisBySegment).toEqual([
      { segmentId: "c", keywords: ["译文"] },
    ]);
    expect(result.outputs).toEqual(f.job.outputs);
    expect(f.transcribe).toHaveBeenCalledTimes(1);
    // First replacement is 1200..1700; same absolute interval now targets its new ID.
    const repeated = await f.jobs.repairLoop(
      loopInput(result, {
        scope: { mode: "range", startMs: 1500, endMs: 1700 },
      }),
    );
    expect(repeated.repairRun).toMatchObject({
      committedRounds: 0,
      reason: "no_eligible",
    });
    expect(review).toHaveBeenCalledTimes(3);
  });
  it("reassesses fresh cues throughout expanded coverage without promoting outside issues into scope", async () => {
    const f = await fixture();
    f.transcribe.mockResolvedValueOnce({
      segments: [
        { start: 0, end: 0.2, text: "outside before" },
        { start: 0.4, end: 0.6, text: "inside clear" },
        { start: 0.7, end: 0.9, text: "outside after" },
      ],
    });
    const selectedIds: string[][] = [];
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => {
        const audit = auditResponse(prompt); if (audit) return audit;
        const data = parseReviewPrompt(prompt) as {
          selected: { id: string }[];
        };
        selectedIds.push(data.selected.map((cue) => cue.id));
        return repairResponse(prompt, (s) =>
          s.id === "a" || s.sourceText.startsWith("outside")
            ? ["source.meaning_problem"]
            : [],
        );
      },
    );
    const result = await f.jobs.repairLoop(
      loopInput(f.job, {
        scope: { mode: "range", startMs: 1500, endMs: 1700 },
      }),
    );
    const replacements = result.segments.filter(
      (s) => !f.job.segments.some((old) => old.id === s.id),
    );
    expect(replacements).toHaveLength(3);
    expect(selectedIds).toEqual([["a"], replacements.map((cue) => cue.id)]);
    expect(result.reviewReport?.assessments).toHaveLength(3);
    expect(
      result.reviewReport?.assessments?.every((a) => a.status === "current"),
    ).toBe(true);
    expect(result.reviewReport?.findings).toHaveLength(2);
    expect(result.repairRun).toMatchObject({
      reason: "no_eligible",
      committedRounds: 1,
      remainingCount: 0,
      effectiveIntervals: [{ startMs: 1100, endMs: 2000 }],
    });
    expect(f.transcribe).toHaveBeenCalledTimes(1);
    expect(result.segments.filter((s) => ["b", "c"].includes(s.id))).toEqual(
      f.job.segments.slice(1),
    );
  });
  it("keeps fixed range and new IDs across two capped rounds, with fresh final assessments", async () => {
    const f = await fixture();
    f.transcribe.mockResolvedValue({
      segments: [{ start: 0, end: 0.5, text: "replacement" }],
    });
    const seen: string[][] = [];
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => {
        const audit = auditResponse(prompt); if (audit) return audit;
        const data = parseReviewPrompt(prompt) as {
          selected: { id: string }[];
        };
        seen.push(data.selected.map((s) => s.id));
        return repairResponse(prompt, () => ["source.meaning_problem"]);
      },
    );
    const result = await f.jobs.repairLoop(
      loopInput(f.job, {
        maxRounds: 2,
        scope: { mode: "range", startMs: 1300, endMs: 1600 },
      }),
    );
    expect(result.repairRun).toMatchObject({
      reason: "max_rounds",
      committedRounds: 2,
      remainingCount: 1,
      scope: { mode: "range", startMs: 1300, endMs: 1600 },
    });
    expect(f.transcribe).toHaveBeenCalledTimes(2);
    expect(seen).toHaveLength(3);
    expect(new Set(seen.flat()).size).toBe(3);
    expect(
      result.reviewReport?.assessments?.filter((a) => a.status === "current"),
    ).toHaveLength(1);
    expect(result.segments.filter((s) => ["b", "c"].includes(s.id))).toEqual(
      f.job.segments.slice(1),
    );
  });
  it("source-only ASR never resolves missing translation configuration or calls translation", async () => {
    const f = await fixture();
    const source = f.jobs.updateOptions(f.job.id, {
      ...f.job.options,
      translationEnabled: false,
      translationProfileId: "missing",
    });
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) =>
        repairResponse(prompt, (s) =>
          s.id === "a" ? ["source.meaning_problem"] : [],
        ),
    );
    const result = await f.jobs.repairLoop(loopInput(source));
    expect(result.repairRun).toMatchObject({
      committedRounds: 1,
      reason: "no_eligible",
    });
    expect(f.transcribe).toHaveBeenCalledTimes(1);
    expect(f.translate).not.toHaveBeenCalled();
  });
  it("translation issues also require fresh recognition and translation", async () => {
    const f = await fixture();
    vi.spyOn(providers, "generateText").mockImplementation(async (_p, _k, prompt) =>
      repairResponse(prompt, (s) => s.id === "a" ? ["translation.meaning_problem"] : []));
    const result = await f.jobs.repairLoop(loopInput(f.job));
    expect(result.repairRun).toMatchObject({ committedRounds: 1, reason: "no_eligible" });
    expect(f.transcribe).toHaveBeenCalledTimes(1);
    expect(f.translate).toHaveBeenCalledTimes(1);
    expect(result.segments[0]?.sourceText).toBe("replacement");
    expect(result.segments[0]?.translatedText).toBe("replacement translated");
  });
  it("mixed recognition and translation failure never publishes half a round", async () => {
    const f = await fixture();
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) =>
        repairResponse(prompt, (s) =>
          s.id === "a"
            ? ["source.meaning_problem"]
            : s.id === "c"
              ? ["translation.meaning_problem"]
              : [],
        ),
    );
    f.translate.mockRejectedValueOnce(new Error("provider fixture failed"));
    await expect(f.jobs.repairLoop(loopInput(f.job))).rejects.toThrow(
      "provider fixture failed",
    );
    const result = f.store.getJob(f.job.id);
    expect(result.segments).toEqual(f.job.segments);
    expect(result.style).toEqual(f.job.style);
    expect(result.revision).toBe(f.job.revision);
    expect(result.repairRun).toMatchObject({
      state: "failed",
      committedRounds: 0,
      remainingCount: 2,
    });
    expect(f.transcribe).toHaveBeenCalledTimes(2);
  });
  it("preflights combined translation before costly ASR", async () => {
    const f = await fixture();
    const job = f.jobs.updateOptions(f.job.id, {
      ...f.job.options,
      translationProfileId: undefined,
    });
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => reviewResponse(prompt, new Set(["a"])),
    );
    await expect(f.jobs.repairLoop(loopInput(job))).rejects.toMatchObject({
      code: "PROFILE_MISSING",
    });
    expect(f.transcribe).not.toHaveBeenCalled();
    expect(f.store.getJob(job.id).segments).toEqual(job.segments);
  });
  it("keeps lease through both analysis and reassessment, rejects CRUD/style/provider writes", async () => {
    const f = await fixture();
    let analyses = 0;
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => {
        const audit = auditResponse(prompt); if (audit) return audit;
        analyses++;
        const current = f.store.getJob(f.job.id);
        expect(() => f.jobs.setStyle(current.id, current.style)).toThrowError(
          expect.objectContaining({ code: "JOB_BUSY" }),
        );
        expect(() =>
          f.jobs.editSegment(
            current.id,
            current.segments[0] ?? cue("x", 0, 1),
            current.revision,
          ),
        ).toThrowError(expect.objectContaining({ code: "JOB_BUSY" }));
        expect(() => f.jobs.assertProfileWritable(f.profile.id)).toThrowError(
          expect.objectContaining({ code: "JOB_BUSY" }),
        );
        return reviewResponse(
          prompt,
          analyses === 1 ? new Set(["a"]) : new Set(),
        );
      },
    );
    const result = await f.jobs.repairLoop(loopInput(f.job));
    expect(analyses).toBe(2);
    expect(() => f.jobs.assertProfileWritable(f.profile.id)).not.toThrow();
    expect(() => f.jobs.setStyle(result.id, result.style)).not.toThrow();
  });
  it("cancellation during translation keeps complete previous content; ignores raw provider secrets", async () => {
    const f = await fixture();
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => reviewResponse(prompt, new Set(["a"])),
    );
    f.translate.mockImplementationOnce(async () => {
      f.jobs.cancel(f.job.id);
      throw new Error("private provider token");
    });
    await expect(f.jobs.repairLoop(loopInput(f.job))).rejects.toThrow();
    const result = f.store.getJob(f.job.id);
    expect(result.segments).toEqual(f.job.segments);
    expect(result.repairRun).toMatchObject({
      state: "cancelled",
      reason: "user_cancelled",
      committedRounds: 0,
    });
    expect(JSON.stringify(result.repairRun)).not.toContain("private");
  });
  it("post-commit reassessment failure preserves completed content with unknown remaining count", async () => {
    const f = await fixture();
    const review = vi
      .spyOn(providers, "generateText")
      .mockImplementationOnce(async (_p, _k, prompt) =>
        reviewResponse(prompt, new Set(["a"])),
      );
    review.mockImplementationOnce(async (_p, _k, prompt) => auditResponse(prompt) ?? "{}");
    review.mockRejectedValueOnce(new Error("reassessment fixture failed"));
    await expect(f.jobs.repairLoop(loopInput(f.job))).rejects.toThrow();
    const result = f.store.getJob(f.job.id);
    expect(result.repairRun).toMatchObject({
      state: "failed",
      committedRounds: 1,
    });
    expect(result.repairRun?.remainingCount).toBeUndefined();
    expect(result.reviewReport?.state).toBe("stale");
    expect(result.segments.some((s) => s.sourceText === "replacement")).toBe(
      true,
    );
    expect(result.revision).toBe(f.job.revision + 1);
  });
  it("preserves current ignored findings across manual recheck and excludes ignored-high/pending-low", async () => {
    const f = await fixture();
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) =>
        repairResponse(prompt, (s) =>
          s.id === "a"
            ? ["translation.negation_contradiction", "source.minor_wording"]
            : [],
        ),
    );
    let job = await f.jobs.reviewSubtitles({
      jobId: f.job.id,
      revision: f.job.revision,
    });
    const report = job.reviewReport;
    const finding = report?.findings.find((f) => f.riskLevel === "high");
    if (!report || !finding) throw new Error("fixture missing high finding");
    job = f.jobs.acknowledgeFinding({
      jobId: job.id,
      reportId: report.id,
      findingId: finding.id,
      status: "ignored",
    });
    job = await f.jobs.reviewSubtitles({
      jobId: job.id,
      revision: job.revision,
    });
    expect(
      job.reviewReport?.findings.find((f) => f.riskLevel === "high")?.status,
    ).toBe("ignored");
    const result = await f.jobs.repairLoop(loopInput(job));
    expect(result.repairRun).toMatchObject({
      committedRounds: 0,
      reason: "no_eligible",
    });
    expect(f.transcribe).not.toHaveBeenCalled();
    expect(f.translate).not.toHaveBeenCalled();
  });
});
describe("chapter repair adjudication and final consistency", () => {
  it("continues within the repair budget when final consistency discovers a newly eligible scoped cue", async () => {
    const f = await fixture(); const phases: string[] = [];
    const generated = vi.spyOn(providers, "generateText").mockImplementation(async (_p, _k, prompt) => reviewResponse(prompt));
    const initial = await f.jobs.reviewSubtitles({ jobId: f.job.id, revision: f.job.revision });
    let injected = false;
    const save = f.store.saveJob.bind(f.store);
    vi.spyOn(f.store, "saveJob").mockImplementation((value) => {
      if (value.repairRun?.phase === "final_consistency" && !injected) {
        const assessment = value.reviewReport?.assessments?.find((a) => a.segmentId === "b");
        if (!assessment) throw new Error("Scoped assessment missing");
        assessment.status = "recheck"; injected = true;
      }
      return save(value);
    });
    generated.mockImplementation(async (_p, _k, prompt) => {
      const audit = auditResponse(prompt); if (audit) return audit;
      const current = f.store.getJob(initial.id); phases.push(current.repairRun?.phase ?? "");
      return repairResponse(prompt, (s) => current.repairRun?.phase === "final_consistency" && s.id === "b" ? ["source.meaning_problem"] : []);
    });
    const result = await f.jobs.repairLoop(loopInput(initial, { maxRounds: 2 }));
    expect(phases).toEqual(["final_consistency", "reassessment"]);
    expect(result.repairRun).toMatchObject({ state: "succeeded", reason: "no_eligible", committedRounds: 1, round: 1, maxRounds: 2, remainingCount: 0 });
    expect(result.revision).toBe(initial.revision + 1);
    expect(result.segments.filter((s) => ["a", "c"].includes(s.id))).toEqual([initial.segments[0], initial.segments[2]]);
    expect(result.segments.some((s) => s.sourceText === "replacement")).toBe(true);
    expect(f.transcribe).toHaveBeenCalledTimes(1); expect(f.translate).toHaveBeenCalledTimes(1);
  });

  it("does not widen paid checks to an unrelated pre-existing outside-scope pending cue", async () => {
    const f = await fixture(); const selected: string[][] = [];
    const generated = vi.spyOn(providers, "generateText").mockImplementation(async (_p, _k, prompt) => repairResponse(prompt, (s) => s.id === "a" ? ["source.meaning_problem"] : []));
    const initial = await f.jobs.reviewSubtitles({ jobId: f.job.id, revision: f.job.revision });
    const staleOutside = initial.reviewReport?.assessments?.find((a) => a.segmentId === "c");
    if (!staleOutside) throw new Error("Outside assessment missing");
    staleOutside.status = "recheck";
    f.store.saveJob(initial);
    generated.mockImplementation(async (_p, _k, prompt) => {
      if (!prompt.startsWith("Audit subtitle repairs")) selected.push(parseReviewPrompt(prompt).selected.map((s) => s.id));
      return repairResponse(prompt, (s) => s.id === "a" ? ["source.meaning_problem"] : []);
    });
    const result = await f.jobs.repairLoop(loopInput(initial, { scope: { mode: "range", startMs: 1300, endMs: 1600 } }));
    expect(result.repairRun?.state).toBe("succeeded");
    expect(selected.flat()).not.toContain("c");
    expect(result.reviewReport?.assessments?.find((a) => a.segmentId === "c")?.status).toBe("recheck");
    expect(result.segments.find((s) => s.id === "c")).toEqual(initial.segments[2]);
    expect(f.transcribe).toHaveBeenCalledTimes(1);
  });

  it("explicitly audits a silent target beside speech in the same merged ASR interval", async () => {
    const f = await fixture();
    const payloads: { targets: { id: string; silenceAllowed: boolean; freshIds: string[] }[] }[] = [];
    vi.spyOn(providers, "generateText").mockImplementation(async (_p, _k, prompt) => {
      if (prompt.startsWith("Audit subtitle repairs")) payloads.push(JSON.parse(prompt.split("\n").at(-1) ?? "{}") as typeof payloads[number]);
      return repairResponse(prompt, (s) => ["a", "b"].includes(s.id) ? ["source.meaning_problem"] : []);
    });
    const result = await f.jobs.repairLoop(loopInput(f.job));
    expect(result.repairRun).toMatchObject({ committedRounds: 1, reason: "no_eligible", effectiveIntervals: [{ startMs: 1100, endMs: 3000 }] });
    expect(payloads[0]?.targets).toEqual([
      expect.objectContaining({ id: "a", silenceAllowed: false, freshIds: [expect.any(String)] }),
      expect.objectContaining({ id: "b", silenceAllowed: true, freshIds: [] }),
    ]);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.sourceText).toBe("replacement");
    expect(result.segments[1]).toEqual(f.job.segments[2]);
    expect(f.transcribe).toHaveBeenCalledTimes(1);
    expect(result.reviewReport?.assessments?.every((a) => a.status === "current")).toBe(true);
  });

  for (const outcome of ["merged", "conflict", "duplicate"] as const) it(`cross-chapter merged acoustic evidence ${outcome}`, async () => {
    const f = await fixture();
    const job = f.store.getJob(f.job.id);
    job.segments = [cue("a", 1000, 2000), cue("b", 2000, 3000), cue("c", 5000, 6000)];
    job.chapterPlan = newCoveragePlan(job);
    job.chapterPlan.chapters = [
      { id: "one", title: "One", summary: "", startMs: 0, endMs: 2000 },
      { id: "two", title: "Two", summary: "", startMs: 2000, endMs: job.media.durationMs },
    ];
    f.store.saveJob(job);
    f.transcribe.mockResolvedValueOnce({ segments: [{ start: 0, end: 2, text: "merged acoustic phrase" }] });
    const payloads: { targets: { id: string; freshIds: string[] }[]; fresh: Segment[]; chapter: { id: string } }[] = [];
    vi.spyOn(providers, "generateText").mockImplementation(async (_p, _k, prompt) => {
      if (!prompt.startsWith("Audit subtitle repairs"))
        return repairResponse(prompt, (s) => ["a", "b"].includes(s.id) ? ["source.meaning_problem"] : []);
      const data = JSON.parse(prompt.split("\n").at(-1) ?? "{}") as typeof payloads[number];
      payloads.push(data);
      const fresh = data.fresh[0]; if (!fresh) throw new Error("Missing cross-boundary evidence");
      if (outcome === "duplicate" && data.chapter.id === "two") {
        const retained = job.segments[1]; if (!retained) throw new Error("Missing retained cue");
        return JSON.stringify({ targets: [{ id: retained.id, replacementIds: [retained.id] }], segments: [retained] });
      }
      return JSON.stringify({ targets: data.targets.map((target) => ({ id: target.id, replacementIds: [fresh.id] })),
        segments: [{ ...fresh, sourceText: outcome === "conflict" && data.chapter.id === "two" ? "conflicting acoustic phrase" : fresh.sourceText }] });
    });
    const task = f.jobs.repairLoop(loopInput(job));
    if (outcome !== "merged") await expect(task).rejects.toMatchObject({ code: "REPAIR_AUDIT_CONFLICT" });
    else await task;
    const result = f.store.getJob(job.id);
    expect(payloads).toHaveLength(2);
    expect(payloads.every((payload) => payload.targets.every((target) => target.freshIds.length === 1))).toBe(true);
    expect(new Set(payloads.flatMap((payload) => payload.fresh.map((s) => s.id))).size).toBe(1);
    expect(result.repairRun?.committedRounds).toBe(outcome === "merged" ? 1 : 0);
    if (outcome !== "merged") expect(result.segments).toEqual(job.segments);
    else {
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0]).toMatchObject({ startMs: 1000, endMs: 3000, sourceText: "merged acoustic phrase" });
      expect(result.segments[1]).toEqual(job.segments[2]);
      expect(result.reviewReport?.assessments?.every((a) => a.status === "current")).toBe(true);
    }
  });

  it("concurrently audits two complete chapters across two unchanged rounds, invalidating retained IDs", async () => {
    const f = await fixture();
    const job = f.store.getJob(f.job.id);
    job.chapterPlan = newCoveragePlan(job);
    job.chapterPlan.chapters = [
      { id: "chapter-one", title: "One", summary: "", startMs: 0, endMs: 4000 },
      { id: "chapter-two", title: "Two", summary: "", startMs: 4000, endMs: job.media.durationMs },
    ];
    f.store.saveJob(job);
    let active = 0; let peak = 0; const auditPayloads: { oldChapter: Segment[]; newChapter: Segment[]; targets: { id: string; suspicion: unknown[] }[] }[] = [];
    const reviews: string[][] = [];
    vi.spyOn(providers, "generateText").mockImplementation(async (_p, _k, prompt) => {
      if (prompt.startsWith("Audit subtitle repairs")) {
        const data = JSON.parse(prompt.split("\n").at(-1) ?? "{}") as { targets: (Segment & { freshIds: string[]; suspicion: unknown[]; silenceAllowed: boolean })[]; oldChapter: Segment[]; newChapter: Segment[] };
        auditPayloads.push(data); peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 30)); active--;
        return JSON.stringify({ targets: data.targets.map((s) => ({ id: s.id, replacementIds: [s.id] })), segments: data.targets.map(({ freshIds: _f, suspicion: _p, silenceAllowed: _s, ...cue }) => cue) });
      }
      const data = parseReviewPrompt(prompt); reviews.push(data.selected.map((s) => s.id));
      return repairResponse(prompt, (s) => ["a", "c"].includes(s.id) ? ["source.meaning_problem"] : []);
    });
    const pendingSnapshots: Job[] = [];
    const save = f.store.saveJob.bind(f.store);
    vi.spyOn(f.store, "saveJob").mockImplementation((value) => { if (value.repairRun?.phase === "commit" && value.revision > job.revision) pendingSnapshots.push(structuredClone(value)); return save(value); });
    const result = await f.jobs.repairLoop(loopInput(job, { maxRounds: 2 }));
    expect(result.segments).toEqual(job.segments);
    expect(result.repairRun).toMatchObject({ committedRounds: 2, reason: "max_rounds", remainingCount: 2 });
    expect(peak).toBe(2); expect(auditPayloads).toHaveLength(4);
    expect(auditPayloads[0]?.oldChapter.map((s) => s.id)).toEqual(["a", "b"]);
    expect(auditPayloads[1]?.oldChapter.map((s) => s.id)).toEqual(["c"]);
    expect(auditPayloads.every((p) => p.newChapter.length && p.targets.every((s) => s.suspicion.length))).toBe(true);
    expect(reviews).toHaveLength(6);
    expect(pendingSnapshots.some((snapshot) => snapshot.reviewReport?.assessments?.some((a) => a.segmentId === "a" && a.status === "recheck"))).toBe(true);
    expect(result.reviewReport?.assessments?.every((a) => a.status === "current")).toBe(true);
    expect(f.transcribe).toHaveBeenCalledTimes(4); expect(f.translate).toHaveBeenCalledTimes(4);
    expect(result.chapterPlan?.chapters).toEqual(job.chapterPlan.chapters);
  });

  for (const outcome of ["success", "fail", "cancel", "nonprogress"] as const) it(`final assessment-only consistency ${outcome} covers run-dependent outside cues without another round`, async () => {
    const f = await fixture(); const targets: string[][] = [];
    const generated = vi.spyOn(providers, "generateText").mockImplementation(async (_p, _k, prompt) => repairResponse(prompt, (s) => s.id === "a" ? ["source.meaning_problem"] : []));
    const initial = await f.jobs.reviewSubtitles({ jobId: f.job.id, revision: f.job.revision });
    generated.mockImplementation(async (_p, _k, prompt) => {
      const audit = auditResponse(prompt); if (audit) return audit;
      const current = f.store.getJob(f.job.id);
      if (current.repairRun?.phase === "final_consistency") {
        targets.push(parseReviewPrompt(prompt).selected.map((s) => s.id));
        if (outcome === "fail") throw new AppError("AUTH_FAILED", "fixture final check failed");
        if (outcome === "cancel") { f.jobs.cancel(current.id); throw new AppError("CANCELLED", "cancelled"); }
      }
      return repairResponse(prompt, (s) => s.id === "a" ? ["source.meaning_problem"] : []);
    });
    let injected = false;
    const save = f.store.saveJob.bind(f.store);
    vi.spyOn(f.store, "saveJob").mockImplementation((value) => {
      if (value.repairRun?.phase === "final_consistency" && (!injected || outcome === "nonprogress")) {
        injected = true;
        const assessment = value.reviewReport?.assessments?.find((a) => a.segmentId === "b");
        if (!assessment) throw new Error("dependent fixture missing");
        assessment.status = "recheck";
      }
      return save(value);
    });
    const task = f.jobs.repairLoop(loopInput(initial, { maxRounds: 1, scope: { mode: "range", startMs: 1300, endMs: 1600 } }));
    if (outcome === "success") await task;
    else await expect(task).rejects.toMatchObject({ code: outcome === "fail" ? "AUTH_FAILED" : outcome === "cancel" ? "CANCELLED" : "REPAIR_INCOMPLETE" });
    const result = f.store.getJob(f.job.id);
    expect(targets).toEqual([["b"]]);
    expect(result.repairRun?.committedRounds).toBe(1); expect(result.revision).toBe(initial.revision + 1);
    expect(f.transcribe).toHaveBeenCalledTimes(1); expect(f.translate).toHaveBeenCalledTimes(1);
    expect(result.segments.find((s) => s.id === "b")).toEqual(initial.segments[1]);
    expect(result.reviewReport?.assessments?.find((a) => a.segmentId === "b")).toMatchObject({ status: outcome === "success" ? "current" : "recheck", riskLevel: "none" });
    expect(result.repairRun?.state).toBe(outcome === "success" ? "succeeded" : outcome === "cancel" ? "cancelled" : "failed");
    if (outcome !== "success") expect(result.repairRun?.remainingCount).toBeUndefined();
  });

  for (const outcome of ["invalid", "cancel", "stale"] as const) it(`failed audit ${outcome} preserves the whole prior round and neighbours`, async () => {
    const f = await fixture();
    vi.spyOn(providers, "generateText").mockImplementation(async (_p, _k, prompt) => {
      if (!prompt.startsWith("Audit subtitle repairs")) return reviewResponse(prompt, new Set(["a"]));
      if (outcome === "cancel") f.jobs.cancel(f.job.id);
      if (outcome === "stale") { const changed = f.store.getJob(f.job.id); changed.style.textColor = "#FF0000"; changed.revision++; f.store.saveJob(changed); }
      return outcome === "invalid" ? JSON.stringify({ targets: [], segments: [] }) : auditResponse(prompt) ?? "{}";
    });
    await expect(f.jobs.repairLoop(loopInput(f.job))).rejects.toMatchObject({ code: outcome === "invalid" ? "REPAIR_AUDIT_COVERAGE" : outcome === "cancel" ? "CANCELLED" : "STALE_REVISION" });
    const result = f.store.getJob(f.job.id);
    expect(result.segments).toEqual(f.job.segments); expect(result.repairRun?.committedRounds).toBe(0);
    if (outcome === "stale") expect(result.style.textColor).toBe("#FF0000");
  });

  it("validates complete split/merge/silence mappings and rejects disjoint loss, duplicate IDs and neighbour changes", async () => {
    const f = await fixture(); const a = f.job.segments[0] as Segment; const b = f.job.segments[1] as Segment; const c = f.job.segments[2] as Segment;
    const fresh = [{ ...a, id: "fresh1", endMs: 1500 }, { ...a, id: "fresh2", startMs: 1500 }];
    const intervals = [{ startMs: 1100, endMs: 3000 }, { startMs: 5000, endMs: 6000 }];
    const split = { targets: [{ id: a.id, replacementIds: fresh.map((s) => s.id) }], segments: fresh };
    expect(validateRepairAudit(split, f.job, [a], fresh, intervals)).toEqual(fresh);
    const merged = { ...a, id: "merged", endMs: b.endMs };
    expect(validateRepairAudit({ targets: [a, b].map((s) => ({ id: s.id, replacementIds: [merged.id] })), segments: [merged] }, f.job, [a, b], [merged], intervals)).toEqual([merged]);
    expect(validateRepairAudit({ targets: [{ id: a.id, replacementIds: [] }], segments: [] }, f.job, [a], [], intervals)).toEqual([]);
    expect(() => validateRepairAudit({ targets: [a, c].map((s) => ({ id: s.id, replacementIds: [c.id] })), segments: [c] }, f.job, [a, c], [], intervals)).toThrowError(expect.objectContaining({ code: "REPAIR_AUDIT_COVERAGE" }));
    const distant = { ...c, id: "distant-fresh" };
    expect(() => validateRepairAudit({ targets: [a, c].map((s) => ({ id: s.id, replacementIds: [distant.id] })), segments: [distant] }, f.job, [a, c], [distant], [{ startMs: 1100, endMs: 6000 }])).toThrowError(expect.objectContaining({ code: "REPAIR_AUDIT_COVERAGE" }));
    expect(() => validateRepairAudit({ targets: [{ id: a.id, replacementIds: [distant.id] }], segments: [{ ...distant, startMs: a.startMs, endMs: a.endMs }] }, f.job, [a], [distant], [{ startMs: 1100, endMs: 6000 }])).toThrowError(expect.objectContaining({ code: "REPAIR_AUDIT_COVERAGE" }));
    expect(() => validateRepairAudit({ targets: [{ id: a.id, replacementIds: [fresh[0]?.id] }], segments: [{ ...fresh[0], startMs: 5000, endMs: 5500 }] }, f.job, [a], fresh, [{ startMs: 1100, endMs: 6000 }])).toThrowError(expect.objectContaining({ code: "REPAIR_AUDIT_COVERAGE" }));
    expect(() => validateRepairAudit({ ...split, segments: [fresh[0], fresh[0], fresh[1]] }, f.job, [a], fresh, intervals)).toThrow();
    expect(() => validateRepairAudit({ targets: [{ id: a.id, replacementIds: [b.id] }], segments: [b] }, f.job, [a], fresh, intervals)).toThrow();
    expect(validateRepairAudit({ targets: [{ id: a.id, replacementIds: [] }], segments: [] }, f.job, [a], [{ ...b, id: "shifted" }], intervals)).toEqual([]);
    expect(() => validateRepairAudit({ targets: [{ id: a.id, replacementIds: [] }], segments: [] }, f.job, [a], fresh, intervals)).toThrowError(expect.objectContaining({ code: "REPAIR_AUDIT_COVERAGE" }));
    for (const translationEnabled of [true, false]) {
      const before = { ...f.job, options: { ...f.job.options, translationEnabled } };
      expect(() => validateRepairAudit({ targets: [{ id: a.id, replacementIds: [a.id] }], segments: [{ ...a, sourceText: " ", translatedText: translationEnabled ? "translated" : "" }] }, before, [a], fresh, intervals)).toThrowError(expect.objectContaining({ code: "REPAIR_AUDIT_IDS" }));
    }
    expect(() => validateRepairAudit({ targets: [{ id: a.id, replacementIds: [a.id] }], segments: [{ ...a, translationStale: true }] }, f.job, [a], fresh, intervals)).toThrowError(expect.objectContaining({ code: "REPAIR_AUDIT_IDS" }));
    const chapter = newCoveragePlan(f.job).chapters[0]; if (!chapter) throw new Error("chapter missing");
    const prompt = createRepairAudit(f.job, f.job, chapter, [a], fresh, intervals).prompt;
    expect(prompt).toContain('"oldChapter"'); expect(prompt).toContain('"newChapter"'); expect(prompt).toContain('"suspicion"'); expect(prompt).toContain(c.sourceText);
  });

  it("retains proven original and fresh ASR overlap while rejecting invented or mixed overlap", () => {
    const originals = [cue("a", 1000, 2100), cue("b", 2000, 3000)];
    const fresh = originals.map((s) => ({ ...s, id: `fresh-${s.id}` }));
    expect(mergeRepairAudits(originals, fresh, originals)).toEqual(originals);
    expect(mergeRepairAudits(originals, fresh, fresh)).toEqual(fresh);
    const left = fresh[0]; const right = fresh[1]; const oldRight = originals[1];
    if (!left || !right || !oldRight) throw new Error("Overlap fixture missing");
    expect(() => mergeRepairAudits(originals, fresh, [{ ...left, endMs: 2200 }, right])).toThrowError(expect.objectContaining({ code: "REPAIR_AUDIT_CONFLICT" }));
    expect(() => mergeRepairAudits(originals, fresh, [left, oldRight])).toThrowError(expect.objectContaining({ code: "REPAIR_AUDIT_CONFLICT" }));
  });
});

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
        received.push(parseReviewPrompt(prompt));
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
  it("incomplete aggregate output and its single correction fail atomically without filling omissions with none", async () => {
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
      .mockResolvedValueOnce('{"a":[]}')
      .mockResolvedValueOnce('{"a":[]}');
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
        const input = parseReviewPrompt(prompt) as {
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
  it("covers long timelines with one bounded prompt and persists complete findings across reopening", async () => {
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
        expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(512 * 1024);
        const data = parseReviewPrompt(prompt) as {
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
    expect(batches).toHaveLength(1);
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
  it("checks one aggregate request with canonical context and persists ignore without invalidating media revision; edits require recheck", async () => {
    const f = await fixture();
    const generated = vi
      .spyOn(providers, "generateText")
      .mockImplementation(async (_profile, _key, prompt) => {
        const data = parseReviewPrompt(prompt) as {
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
    generated.mockResolvedValue('{"a":[[999,[]]]}');
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

describe("single-request review and bounded correction", () => {
  it("retains the prior report when credentials change during complete generation", async () => {
    const f = await fixture();
    const generated = vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => reviewResponse(prompt),
    );
    const previous = await f.jobs.reviewSubtitles({ jobId: f.job.id, revision: f.job.revision });
    generated.mockClear().mockImplementation(async (_p, _k, prompt) => {
      const { hasKey: _hasKey, ...profile } = f.profile;
      f.store.saveProfile({ ...profile, apiKey: "changed-fixture-key" });
      return reviewResponse(prompt);
    });
    await expect(f.jobs.reviewSubtitles({ jobId: f.job.id, revision: f.job.revision }))
      .rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(generated).toHaveBeenCalledTimes(1);
    expect(f.store.getJob(f.job.id).reviewReport).toEqual(previous.reviewReport);
  });
  it.each([31, 65, 1027])(
    "reviews %i anonymous targets through exactly one real loopback HTTP request",
    async (length) => {
      const f = await fixture();
      const job = f.store.getJob(f.job.id);
      job.segments = Array.from({ length }, (_, n) =>
        cue(`http-${n}`, n * 5, n * 5 + 4),
      );
      f.store.saveJob(job);
      let requests = 0;
      let groups = 0;
      const server = createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => {
          body += String(chunk);
        });
        request.on("end", () => {
          requests++;
          const payload = JSON.parse(body) as {
            messages: { content: string }[];
          };
          const prompt = payload.messages.at(-1)?.content ?? "";
          const data = JSON.parse(prompt.split("\n")[1] ?? "{}") as {
            groups: { targets: number[] }[];
          };
          groups = data.groups.length;
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      a: data.groups.flatMap((g) =>
                        g.targets.map((n) => [n, []]),
                      ),
                    }),
                  },
                },
              ],
            }),
          );
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("fixture port missing");
      const { hasKey: _hasKey, ...profile } = f.profile;
      f.store.saveProfile({
        ...profile,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
      });
      try {
        const result = await f.jobs.reviewSubtitles({
          jobId: job.id,
          revision: f.store.getJob(job.id).revision,
        });
        expect(requests).toBe(1);
        expect(groups).toBe(Math.ceil(length / 30));
        expect(result.reviewReport?.assessments).toHaveLength(length);
        expect(result.reviewReport?.reviewedSegmentIds).toEqual(
          job.segments.map((s) => s.id),
        );
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
  it("corrects complete-selection evidence once, visibly, without changing canonical groups", async () => {
    const f = await fixture();
    const prompts: string[] = [];
    const generated = vi
      .spyOn(providers, "generateText")
      .mockImplementation(async (_p, _k, prompt) => {
        prompts.push(prompt);
        const data = parseReviewPrompt(prompt);
        if (prompts.length === 1)
          return JSON.stringify({
            a: data.selected.map((s) => [
              s.n,
              s.n === 0
                ? [["source.context_inconsistency", "fixture evidence", [s.n]]]
                : [],
            ]),
          });
        return reviewResponse(prompt);
      });
    const result = await f.jobs.reviewSubtitles({
      jobId: f.job.id,
      revision: f.job.revision,
    });
    expect(generated).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain("Correction 1/1");
    expect(prompts[1]?.split("\n")[1]).toBe(prompts[0]?.split("\n")[1]);
    expect(result.reviewReport?.assessments).toHaveLength(3);
  });
  it("retains a prior valid report after two malformed complete outputs and no third call", async () => {
    const f = await fixture();
    const generated = vi
      .spyOn(providers, "generateText")
      .mockImplementation(async (_p, _k, prompt) => reviewResponse(prompt));
    const previous = await f.jobs.reviewSubtitles({
      jobId: f.job.id,
      revision: f.job.revision,
    });
    generated.mockClear().mockResolvedValue("invalid json");
    await expect(
      f.jobs.reviewSubtitles({ jobId: f.job.id, revision: f.job.revision }),
    ).rejects.toThrowError(expect.objectContaining({ code: "INVALID_JSON" }));
    expect(generated).toHaveBeenCalledTimes(2);
    expect(f.store.getJob(f.job.id).reviewReport).toEqual(
      previous.reviewReport,
    );
  });
  it.each(["TRUNCATED", "AUTH_ERROR", "PROVIDER_TIMEOUT", "NETWORK_ERROR"])(
    "does not content-retry %s",
    async (code) => {
      const f = await fixture();
      const generated = vi
        .spyOn(providers, "generateText")
        .mockRejectedValue(new AppError(code, "fixture"));
      await expect(
        f.jobs.reviewSubtitles({ jobId: f.job.id, revision: f.job.revision }),
      ).rejects.toThrowError(expect.objectContaining({ code }));
      expect(generated).toHaveBeenCalledTimes(1);
      expect(f.store.getJob(f.job.id).reviewReport).toBeUndefined();
    },
  );
  it("cancellation after complete validation prevents report publication", async () => {
    const f = await fixture();
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => reviewResponse(prompt),
    );
    const previous = await f.jobs.reviewSubtitles({
      jobId: f.job.id,
      revision: f.job.revision,
    });
    const jobs = new JobService(
      f.store,
      f.media,
      {
        modelPath: () => "fixture-model",
        executable: (gpu: boolean) => ({
          path: "fixture-whisper",
          backend: gpu ? "gpu" : "cpu",
        }),
      },
      f.root,
      (event) => {
        if (event.message.includes("已校验")) jobs.cancel(f.job.id);
      },
      (path) => path,
    );
    await expect(
      jobs.reviewSubtitles({ jobId: f.job.id, revision: f.job.revision }),
    ).rejects.toThrowError(expect.objectContaining({ code: "CANCELLED" }));
    expect(f.store.getJob(f.job.id).reviewReport).toEqual(
      previous.reviewReport,
    );
  });
  it("cancellation during correction never publishes or requests a third generation", async () => {
    const f = await fixture();
    let calls = 0;
    const generated = vi
      .spyOn(providers, "generateText")
      .mockImplementation(async (_p, _k, prompt) => {
        calls++;
        if (calls === 1) return '{"a":[]}';
        f.jobs.cancel(f.job.id);
        return reviewResponse(prompt);
      });
    await expect(
      f.jobs.reviewSubtitles({ jobId: f.job.id, revision: f.job.revision }),
    ).rejects.toThrowError(expect.objectContaining({ code: "CANCELLED" }));
    expect(generated).toHaveBeenCalledTimes(2);
    expect(f.store.getJob(f.job.id).reviewReport).toBeUndefined();
  });
});
