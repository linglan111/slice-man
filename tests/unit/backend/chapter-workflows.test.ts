import { afterEach, describe, expect, it, vi } from "vitest";
import { JobService } from "../../../src/main/services/jobs/lib/job-service";
import {
  chapterSourceFingerprint,
  newCoveragePlan,
  refreshChapters,
} from "../../../src/main/services/jobs/lib/chapters";
import {
  boundedChapterPieces,
  orderedChapterWorkers,
} from "../../../src/main/services/jobs/lib/chapter-work";
import { createReviewRequest } from "../../../src/main/services/jobs/lib/review-request";
import * as providers from "../../../src/main/services/providers/lib/text-provider";
import { AppError } from "../../../src/main/lib/errors";
import type { Store } from "../../../src/main/db/store";
import type { MediaService } from "../../../src/main/services/media/lib/media-service";
import {
  DEFAULT_STYLE,
  optionsSchema,
  type Job,
  type Profile,
  type Segment,
} from "../../../src/shared/contracts";

afterEach(() => vi.restoreAllMocks());
function cue(id: string, startMs: number, endMs = startMs + 5000): Segment {
  return {
    id,
    startMs,
    endMs,
    sourceText: `source ${id}`,
    translatedText: "",
    translationStale: true,
  };
}
type Fixture = {
  jobs: JobService;
  store: Store;
  get: () => Job;
  set: (update: (job: Job) => void) => void;
  key: (value: string) => void;
  profile: (value: Partial<Profile>) => void;
};
function fixture(
  durationMs = 3_600_000,
  segments = Array.from({ length: 6 }, (_, index) =>
    cue(`cue-${index}`, index * 600_000),
  ),
): Fixture {
  let current: Job = {
    id: "job",
    name: "video",
    inputPath: "/video.mp4",
    media: {
      durationMs,
      width: 100,
      height: 100,
      hasAudio: true,
      audioOffsetMs: 0,
      rotation: 0,
      sampleAspectRatio: "1:1",
    },
    options: optionsSchema.parse({
      reviewProfileId: "p",
      translationProfileId: "p",
      chapterConcurrency: 1,
    }),
    segments,
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
  let profile: Profile = {
    id: "p",
    name: "fixture",
    protocol: "openai",
    mode: "chat",
    baseUrl: "http://fixture.invalid",
    model: "fixture",
    sessionOnly: true,
    hasKey: true,
    timeoutMs: 120000,
    maxUploadBytes: 24000000,
    structuredOutput: false,
  };
  let key = "fixture-key";
  const store = {
    getJob: () => {
      const job = structuredClone(current);
      refreshChapters(job);
      return job;
    },
    saveJob: (job: Job) => {
      refreshChapters(job);
      current = structuredClone(job);
      return job;
    },
    getProfile: () => profile,
    key: () => key,
  } as unknown as Store;
  const jobs = new JobService(
    store,
    {} as MediaService,
    { modelPath: () => "", executable: () => ({ path: "", backend: "cpu" }) },
    "/fixture",
    () => {},
    () => "",
  );
  return {
    jobs,
    store,
    get: () => store.getJob("job"),
    set: (update: (job: Job) => void) => {
      update(current);
    },
    key: (value: string) => {
      key = value;
    },
    profile: (value: Partial<Profile>) => {
      profile = { ...profile, ...value };
    },
  };
}
function normal(f: ReturnType<typeof fixture>): void {
  f.set((job) => {
    job.chapterPlan = newCoveragePlan(job);
  });
}
function payload(prompt: string): {
  groups: { targets: number[]; context: number[] }[];
  cues: { n: number; sourceText: string }[];
} {
  return JSON.parse(prompt.split("\n").slice(1).join("\n"));
}
function goodReview(prompt: string): string {
  return JSON.stringify({
    a: payload(prompt).groups.flatMap((group) =>
      group.targets.map((n) => [n, []]),
    ),
  });
}
function goodTranslations(selected: Segment[]): { id: string; text: string }[] {
  return selected.map((cue) => ({ id: cue.id, text: `translated ${cue.id}` }));
}

describe("chapter orchestration boundaries", () => {
  it("retains one aggregate selected-set check at exactly 30 minutes", async () => {
    const f = fixture(1_800_000, [cue("a", 0), cue("b", 1_700_000)]);
    const generate = vi
      .spyOn(providers, "generateText")
      .mockImplementation(async (_p, _k, prompt) => goodReview(prompt));
    const result = await f.jobs.reviewSubtitles({ jobId: "job", revision: 0 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.reviewRun).toBeUndefined();
    expect(result.reviewReport?.assessments).toHaveLength(2);
    expect(result.chapterPlan).toBeUndefined();
  });
  it("retains full checked chapters on failure and retries only remaining compatible targets", async () => {
    const f = fixture();
    normal(f);
    const seen: number[][] = [];
    let fail = true;
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => {
        const ids = payload(prompt).groups.flatMap((group) => group.targets);
        seen.push(ids);
        if (ids.includes(2) && fail)
          throw new AppError("PROVIDER_IDLE_TIMEOUT", "fixture");
        return goodReview(prompt);
      },
    );
    await expect(
      f.jobs.reviewSubtitles({ jobId: "job", revision: 0 }),
    ).rejects.toMatchObject({ code: "PROVIDER_IDLE_TIMEOUT" });
    const partial = f.get();
    expect(partial.reviewRun?.chapters.map((chapter) => chapter.state)).toEqual(
      ["completed", "failed", "pending"],
    );
    expect(partial.reviewReport?.reviewedSegmentIds).toEqual([
      "cue-0",
      "cue-1",
    ]);
    expect(partial.reviewReport?.assessments).toHaveLength(2);
    fail = false;
    const complete = await f.jobs.reviewSubtitles({
      jobId: "job",
      revision: 0,
    });
    expect(seen).toEqual([
      [0, 1],
      [2, 3],
      [2, 3],
      [4, 5],
    ]);
    expect(complete.reviewRun?.state).toBe("complete");
    expect(complete.reviewReport?.assessments).toHaveLength(6);
  });
  it("uses global canonical groups and ordinals for sparse cross-chapter targets", async () => {
    const f = fixture(3_600_000, [
      cue("left", 1_190_000),
      cue("cross", 1_199_000, 1_201_000),
      cue("right", 1_200_000),
      cue("distant", 3_000_000),
    ]);
    normal(f);
    const expected = createReviewRequest(
      f.get().segments,
      [f.get().segments[1]].filter((cue) => cue !== undefined),
      true,
    );
    let first: ReturnType<typeof payload> | undefined;
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => {
        first ??= payload(prompt);
        return goodReview(prompt);
      },
    );
    const result = await f.jobs.reviewSubtitles({
      jobId: "job",
      revision: 0,
      segmentIds: ["cross", "distant"],
    });
    expect(first?.groups).toEqual(payload(expected.prompt).groups);
    expect(first?.cues.map((cue) => cue.n)).toContain(2);
    expect(
      result.reviewRun?.chapters.flatMap((chapter) => chapter.targetIds),
    ).toEqual(["cross", "distant"]);
    expect(result.reviewReport?.reviewedSegmentIds).toEqual([
      "cross",
      "distant",
    ]);
  });
  it("does not publish a partly validated dense chapter", async () => {
    const f = fixture(3_600_000, [
      ...Array.from({ length: 151 }, (_, index) =>
        cue(`dense-${index}`, index * 6000),
      ),
      cue("last", 3_000_000),
    ]);
    normal(f);
    let calls = 0;
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => {
        if (++calls === 2) throw new AppError("NETWORK_ERROR", "fixture");
        return goodReview(prompt);
      },
    );
    await expect(
      f.jobs.reviewSubtitles({ jobId: "job", revision: 0 }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(f.get().reviewReport).toBeUndefined();
    expect(f.get().reviewRun?.chapters[0]?.state).toBe("failed");
  });
  it("keeps earlier results but marks interrupted stale source runs inapplicable", async () => {
    const f = fixture();
    normal(f);
    let calls = 0;
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => {
        if (++calls === 2)
          f.set((job) => {
            job.revision++;
            const cue = job.segments[2];
            if (cue) cue.sourceText = "manual edit";
          });
        return goodReview(prompt);
      },
    );
    await expect(
      f.jobs.reviewSubtitles({ jobId: "job", revision: 0 }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(f.get().reviewRun?.state).toBe("stale");
    expect(f.get().reviewReport?.reviewedSegmentIds).toEqual([
      "cue-0",
      "cue-1",
    ]);
    expect(f.get().segments[2]?.sourceText).toBe("manual edit");
  });
  it("rejects a mid-request credential change without publishing the affected chapter", async () => {
    const f = fixture();
    normal(f);
    vi.spyOn(providers, "generateText").mockImplementation(
      async (_p, _k, prompt) => {
        f.key("changed");
        return goodReview(prompt);
      },
    );
    await expect(
      f.jobs.reviewSubtitles({ jobId: "job", revision: 0 }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(f.get().reviewReport).toBeUndefined();
  });
  it("does not invent none assessments for missing/duplicate IDs after one correction", async () => {
    const f = fixture();
    normal(f);
    const generate = vi
      .spyOn(providers, "generateText")
      .mockResolvedValue('{"a": [[0, []], [0, []]]}');
    await expect(
      f.jobs.reviewSubtitles({ jobId: "job", revision: 0 }),
    ).rejects.toMatchObject({ code: "REVIEW_IDS" });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(f.get().reviewReport).toBeUndefined();
    expect(f.get().reviewRun?.state).toBe("failed");
  });
  it("cancellation retains saved checking chapters and allows compatible remaining retry", async () => {
    const f = fixture();
    normal(f);
    let calls = 0;
    const generate = vi
      .spyOn(providers, "generateText")
      .mockImplementation(async (_p, _k, prompt) => {
        if (++calls === 2) f.jobs.cancel("job");
        return goodReview(prompt);
      });
    await expect(
      f.jobs.reviewSubtitles({ jobId: "job", revision: 0 }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(f.get().reviewRun?.state).toBe("cancelled");
    expect(f.get().reviewReport?.assessments).toHaveLength(2);
    generate.mockImplementation(async (_p, _k, prompt) => goodReview(prompt));
    await f.jobs.reviewSubtitles({ jobId: "job", revision: 0 });
    expect(generate).toHaveBeenCalledTimes(4);
  });
});

describe("default chapter translation", () => {
  it("uses one free coverage chapter for short video and no planning generation", async () => {
    const f = fixture(10000, [cue("a", 0), cue("b", 5000)]);
    const generate = vi.spyOn(providers, "generateText");
    const translate = vi
      .spyOn(providers, "translateBatch")
      .mockImplementation(async (_p, _k, targets) => goodTranslations(targets));
    const result = await f.jobs.translate("job");
    expect(generate).not.toHaveBeenCalled();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(result.chapterPlan?.chapters).toHaveLength(1);
    expect(result.segments.map((cue) => cue.translatedText)).toEqual([
      "translated a",
      "translated b",
    ]);
    expect(translate.mock.calls[0]?.[8]).toMatchObject({ title: "章节 1" });
  });
  it("plans long video by content once then reuses chapters and skips completed translations on retry", async () => {
    const f = fixture();
    const generate = vi
      .spyOn(providers, "generateText")
      .mockImplementation(async (_p, _k, prompt) => {
        const raw = JSON.parse(prompt.split("\n").slice(1).join("\n")) as {
          anchors: { index: number; timeMs: number }[];
        };
        return JSON.stringify({
          chapters: [
            {
              startAnchor: 0,
              endAnchor: raw.anchors.length - 1,
              title: "Topic",
              summary: "Whole topic",
            },
          ],
        });
      });
    let fail = true;
    const seen: string[][] = [];
    vi.spyOn(providers, "translateBatch").mockImplementation(
      async (_p, _k, targets) => {
        seen.push(targets.map((cue) => cue.id));
        if (targets.some((cue) => cue.id === "cue-2") && fail)
          throw new AppError("NETWORK_ERROR", "fixture");
        return goodTranslations(targets);
      },
    );
    await expect(f.jobs.translate("job")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    expect(
      f.get().segments.filter((cue) => !cue.translationStale),
    ).toHaveLength(2);
    fail = false;
    const result = await f.jobs.translate("job");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      ["cue-0", "cue-1"],
      ["cue-2", "cue-3"],
      ["cue-2", "cue-3"],
      ["cue-4", "cue-5"],
    ]);
    expect(result.segments.every((cue) => !cue.translationStale)).toBe(true);
    expect(
      result.chapterPlan?.chapters.every(
        (chapter) => chapter.endMs - chapter.startMs <= 1_200_000,
      ),
    ).toBe(true);
  });
  it("keeps selected cross-chapter translation atomic on later failure", async () => {
    const f = fixture();
    normal(f);
    vi.spyOn(providers, "translateBatch").mockImplementation(
      async (_p, _k, targets) => {
        if (targets.some((cue) => cue.id === "cue-2"))
          throw new AppError("NETWORK_ERROR", "fixture");
        return goodTranslations(targets);
      },
    );
    await expect(
      f.jobs.translate("job", ["cue-0", "cue-2"]),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(f.get().segments.every((cue) => cue.translatedText === "")).toBe(
      true,
    );
    expect(f.get().revision).toBe(0);
  });
  it('retains a fast completed later chapter when an earlier concurrent chapter fails', async () => {
    const f=fixture(2_400_000,Array.from({length:4},(_,index)=>cue(`cue-${index}`,index*600_000))); normal(f);
    f.set((job)=>{job.options.chapterConcurrency=2;});
    vi.spyOn(providers,'translateBatch').mockImplementation(async (_p,_k,targets)=>{
      if(targets.some((cue)=>cue.id==='cue-0')) {await new Promise<void>((resolve)=>setTimeout(resolve,15)); throw new AppError('NETWORK_ERROR','earlier failed');}
      return goodTranslations(targets);
    });
    await expect(f.jobs.translate('job')).rejects.toMatchObject({code:'NETWORK_ERROR'});
    expect(f.get().segments.map((cue)=>cue.translatedText)).toEqual(['','','translated cue-2','translated cue-3']);
    expect(f.get().segments.map((cue)=>cue.id)).toEqual(['cue-0','cue-1','cue-2','cue-3']);
  });
  it('retains a later chapter saved before cancellation without publishing work completed after cancel', async () => {
    const f=fixture(2_400_000,Array.from({length:4},(_,index)=>cue(`cue-${index}`,index*600_000))); normal(f);
    f.set((job)=>{job.options.chapterConcurrency=2;});
    vi.spyOn(providers,'translateBatch').mockImplementation(async (_p,_k,targets,_c,_s,_t,signal)=>{
      if(targets.some((cue)=>cue.id==='cue-0')) {await new Promise<void>((resolve)=>setTimeout(resolve,20)); if(signal?.aborted) throw new AppError('CANCELLED','fixture');}
      else setTimeout(()=>f.jobs.cancel('job'),5);
      return goodTranslations(targets);
    });
    await expect(f.jobs.translate('job')).rejects.toMatchObject({code:'CANCELLED'});
    expect(f.get().segments.map((cue)=>cue.translatedText)).toEqual(['','','translated cue-2','translated cue-3']);
    expect(()=>f.jobs.assertIdle()).not.toThrow();
  });
  it("keeps scoped dense retranslation atomic across bounded pieces", async () => {
    const f = fixture(
      100000,
      Array.from({ length: 151 }, (_, index) =>
        cue(`s${index}`, index * 500, index * 500 + 500),
      ),
    );
    let calls = 0;
    vi.spyOn(providers, "translateBatch").mockImplementation(
      async (_p, _k, targets) => {
        if (++calls === 2) throw new AppError("NETWORK_ERROR", "fixture");
        return goodTranslations(targets);
      },
    );
    await expect(
      f.jobs.translatePartial({
        jobId: "job",
        revision: 0,
        target: { mode: "range", startMs: 0, endMs: 100000 },
      }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(f.get().revision).toBe(0);
    expect(f.get().segments.every((cue) => cue.translatedText === "")).toBe(
      true,
    );
  });
  it("settles all concurrent work before releasing its owner on cancellation", async () => {
    const f = fixture();
    normal(f);
    f.set((job) => {
      job.options.chapterConcurrency = 2;
    });
    let active = 0;
    let max = 0;
    let calls = 0;
    vi.spyOn(providers, "translateBatch").mockImplementation(
      async (_p, _k, targets, _c, _s, _t, signal) => {
        active++;
        max = Math.max(max, active);
        calls++;
        try {
          if (calls === 2) f.jobs.cancel("job");
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
          if (signal?.aborted) throw new AppError("CANCELLED", "fixture");
          return goodTranslations(targets);
        } finally {
          active--;
        }
      },
    );
    await expect(f.jobs.translate("job")).rejects.toMatchObject({
      code: "CANCELLED",
    });
    await f.jobs.waitForIdle();
    expect(max).toBe(2);
    expect(active).toBe(0);
    expect(calls).toBe(2);
    expect(f.get().revision).toBe(0);
    expect(() => f.jobs.assertIdle()).not.toThrow();
  });
  it("never invokes planning or translation for original-only mode", async () => {
    const f = fixture();
    f.set((job) => {
      job.options.translationEnabled = false;
    });
    const generate = vi.spyOn(providers, "generateText");
    const translate = vi.spyOn(providers, "translateBatch");
    await expect(f.jobs.translate("job")).rejects.toMatchObject({
      code: "TRANSLATION_DISABLED",
    });
    expect(generate).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
  });
  it("checks names with one full global timeline even across chapters", async () => {
    const f = fixture();
    normal(f);
    const generate = vi
      .spyOn(providers, "generateText")
      .mockResolvedValue('{"candidates":[]}');
    await f.jobs.analyzeNames({ jobId: "job", revision: 0 });
    expect(generate).toHaveBeenCalledTimes(1);
    const prompt = generate.mock.calls[0]?.[2] ?? "";
    expect(prompt).toContain("cue-0");
    expect(prompt).toContain("cue-5");
  });
  it("does not let style-only edits invalidate source chapter identity", () => {
    const f = fixture();
    normal(f);
    const source = chapterSourceFingerprint(f.get());
    f.set((job) => {
      job.style.textColor = "#000000";
      job.revision++;
    });
    expect(chapterSourceFingerprint(f.get())).toBe(source);
    expect(f.get().chapterPlan?.state).toBe("current");
  });
});

describe("chapter capacity and coordinator", () => {
  it("enforces bounded pieces with every target owned once", () => {
    const source = Array.from({ length: 302 }, (_, index) =>
      cue(`s${index}`, index * 5),
    );
    const parts = boundedChapterPieces(source);
    expect(parts.map((part) => part.length)).toEqual([150, 150, 2]);
    expect(parts.flat().map((cue) => cue.id)).toEqual(
      source.map((cue) => cue.id),
    );
  });
  it("commits in chronology even when a later worker finishes earlier", async () => {
    const seen: number[] = [];
    const completed: number[] = [];
    await orderedChapterWorkers(
      [0, 1, 2],
      2,
      new AbortController().signal,
      async (value) => {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, value === 0 ? 15 : 1),
        );
        completed.push(value);
        return value;
      },
      (value) => {
        seen.push(value);
      },
    );
    expect(completed[0]).toBe(1);
    expect(seen).toEqual([0, 1, 2]);
  });
});
