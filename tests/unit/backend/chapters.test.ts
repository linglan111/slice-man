import { describe, expect, it } from "vitest";
import {
  coverageChapters,
  chapterTargets,
  groundChapterResponse,
  validateChapterPlan,
  chapterSourceFingerprint,
} from "../../../src/main/services/jobs/lib/chapters";
import {
  DEFAULT_STYLE,
  optionsSchema,
  type Job,
  type Segment,
} from "../../../src/shared/contracts";
import {
  MAX_CHAPTER_MS,
  chapterPlanSchema,
} from "../../../src/shared/chapter-contracts";
const cue = (id: string, startMs: number, endMs: number): Segment => ({
  id,
  startMs,
  endMs,
  sourceText: id,
  translatedText: "",
  translationStale: false,
});
const job = (durationMs: number): Job => ({
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
  options: optionsSchema.parse({}),
  segments: [],
  style: DEFAULT_STYLE,
  revision: 0,
  createdAt: 0,
  updatedAt: 0,
  stages: Object.fromEntries(
    ["recognize", "translate", "style", "preview", "export"].map((name) => [
      name,
      { state: "idle", progress: 0, message: "" },
    ]),
  ) as Job["stages"],
  outputs: [],
});
describe("chapter planning integrity", () => {
  it("partitions silence and a single overlong cue without changing source", () => {
    const source = [cue("long", 0, 3 * MAX_CHAPTER_MS + 1)];
    const chapters = coverageChapters(source, source[0]?.endMs ?? 1);
    expect(chapters).toHaveLength(4);
    expect(chapters.every((c) => c.endMs - c.startMs <= MAX_CHAPTER_MS)).toBe(
      true,
    );
    expect(source[0]?.endMs).toBe(3 * MAX_CHAPTER_MS + 1);
    expect(coverageChapters([], 2 * MAX_CHAPTER_MS)).toHaveLength(2);
  });
  it("strictly grounds anchors, validates coverage and splits a long topic", () => {
    const snapshot = job(2 * MAX_CHAPTER_MS);
    const plan = groundChapterResponse(
      {
        chapters: [
          { startAnchor: 0, endAnchor: 2, title: "topic", summary: "summary" },
        ],
      },
      snapshot,
      "normal",
      [0, MAX_CHAPTER_MS, 2 * MAX_CHAPTER_MS],
      "profile",
      "provider",
    );
    expect(plan.chapters).toHaveLength(2);
    expect(() =>
      groundChapterResponse(
        {
          chapters: [
            { startAnchor: 0, endAnchor: 9, title: "bad", summary: "" },
          ],
        },
        snapshot,
        "normal",
        [0, MAX_CHAPTER_MS],
        "p",
        "f",
      ),
    ).toThrow();
    expect(() =>
      validateChapterPlan(
        {
          ...plan,
          chapters: [plan.chapters[0]].filter((c) => c !== undefined),
        },
        snapshot.media.durationMs,
      ),
    ).toThrow();
    expect(
      chapterPlanSchema.safeParse({
        ...plan,
        chapters: [...plan.chapters, ...plan.chapters],
      }).success,
    ).toBe(false);
  });
  it("allows empty/gapped custom selection but not ordinary coverage gaps", () => {
    const snapshot = job(100);
    const criterion = {
      id: "c",
      revision: 1,
      name: "core",
      instructions: "core only",
    };
    expect(
      groundChapterResponse(
        { chapters: [] },
        snapshot,
        "custom",
        [0, 20, 80, 100],
        "p",
        "f",
        criterion,
      ).chapters,
    ).toEqual([]);
    const raw = {
      chapters: [
        { startAnchor: 1, endAnchor: 2, title: "selected", summary: "" },
      ],
    };
    expect(
      groundChapterResponse(
        raw,
        snapshot,
        "custom",
        [0, 20, 80, 100],
        "p",
        "f",
        criterion,
      ).chapters,
    ).toHaveLength(1);
    expect(() =>
      groundChapterResponse(
        raw,
        snapshot,
        "normal",
        [0, 20, 80, 100],
        "p",
        "f",
      ),
    ).toThrow();
  });
  it("owns each crossing cue once by its original start", () => {
    const snapshot = job(200);
    const plan = groundChapterResponse(
      {
        chapters: [
          { startAnchor: 0, endAnchor: 1, title: "a", summary: "" },
          { startAnchor: 1, endAnchor: 2, title: "b", summary: "" },
        ],
      },
      snapshot,
      "normal",
      [0, 100, 200],
      "p",
      "f",
    );
    expect(
      chapterTargets(plan, [
        cue("cross", 90, 110),
        cue("boundary", 100, 120),
      ]).map((c) => c.targets.map((s) => s.id)),
    ).toEqual([["cross"], ["boundary"]]);
  });
  it("ignores translated/style edits in semantic fingerprint and detects source edits", () => {
    const snapshot = job(100);
    snapshot.segments = [cue("a", 0, 100)];
    const fingerprint = chapterSourceFingerprint(snapshot);
    const first = snapshot.segments[0];
    if (!first) throw new Error("fixture");
    first.translatedText = "translated";
    snapshot.style = { ...DEFAULT_STYLE, textColor: "#000000" };
    expect(chapterSourceFingerprint(snapshot)).toBe(fingerprint);
    first.sourceText = "changed";
    expect(chapterSourceFingerprint(snapshot)).not.toBe(fingerprint);
  });
});
