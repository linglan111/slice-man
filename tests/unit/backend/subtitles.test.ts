import { describe, it, expect } from "vitest";
import {
  DEFAULT_STYLE,
  styleSchema,
  type Segment,
} from "../../../src/shared/contracts";
import {
  normalizeCloud,
  normalizeWhisper,
  mergeChunkSegments,
  validateTimeline,
} from "../../../src/main/services/subtitles/lib/timeline";
import {
  compileSubtitles,
  escapeAss,
} from "../../../src/main/services/subtitles/lib/compiler";
const cue: Segment = {
  id: "s1",
  startMs: 1001,
  endMs: 1002,
  sourceText: "hello",
  translatedText: "你好",
  translationStale: false,
};
const geometry = { width: 1280, height: 720, durationMs: 5000 };
describe("subtitle timeline contracts", () => {
  it("adds chunk offset exactly once and keeps stable order", () => {
    expect(
      normalizeCloud(
        { segments: [{ start: 0.2, end: 0.8, text: "Hello" }] },
        1000,
        5000,
        "part",
      )[0],
    ).toMatchObject({ id: "part-0", startMs: 1200, endMs: 1800 });
  });
  it("accepts explicit silence but rejects plaintext-only and malformed timing", () => {
    expect(normalizeCloud({ segments: [] }, 0, 5000, "p")).toEqual([]);
    expect(() => normalizeCloud({ text: "hi" }, 0, 5000, "p")).toThrow(
      "segments",
    );
    expect(() =>
      normalizeCloud(
        { segments: [{ start: 1, end: 0.5, text: "hi" }] },
        0,
        5000,
        "p",
      ),
    ).toThrow();
    expect(() =>
      normalizeCloud(
        { segments: [{ start: 4, end: 6, text: "hi" }] },
        0,
        5000,
        "p",
      ),
    ).toThrow();
    expect(() => validateTimeline([cue, cue], 5000)).toThrow("ID");
    expect(() => validateTimeline([cue], NaN)).toThrow();
  });
  it("uses whisper millisecond offsets without seconds conversion", () => {
    expect(
      normalizeWhisper(
        { transcription: [{ offsets: { from: 125, to: 750 }, text: " hi " }] },
        500,
        5000,
      )[0],
    ).toMatchObject({ startMs: 625, endMs: 1250, sourceText: "hi" });
  });
  it("deduplicates overlap while preserving repeated speech elsewhere", () => {
    const first = { ...cue, startMs: 1000, endMs: 2000 };
    const duplicate = { ...first, id: "dup", startMs: 1100, endMs: 2100 };
    const repeat = { ...first, id: "repeat", startMs: 2500, endMs: 3500 };
    expect(
      mergeChunkSegments([first], [duplicate, repeat]).map((s) => s.id),
    ).toEqual(["s1", "repeat"]);
  });
});
describe("declarative styles and serializers", () => {
  it("honors narrow portrait width even when fewer than eight CJK characters fit", () => {
    const style = structuredClone(DEFAULT_STYLE);
    style.fontSizeRatio = 0.08;
    style.layout.maxWidthRatio = 0.5;
    const ass = compileSubtitles(
      [{ ...cue, translatedText: "一二三四五六七八" }],
      style,
      { width: 240, height: 640, durationMs: 5000 },
      false,
      "ass",
    );
    expect(ass).toContain("一二\\N三四\\N五六\\N七八");
  });
  it("rounds ASS starts down and ends up while retaining exact SRT milliseconds", () => {
    const s = { ...cue, startMs: 1009, endMs: 1059 };
    const ass = compileSubtitles([s], DEFAULT_STYLE, geometry, false, "ass");
    expect(ass).toContain("0:00:01.00,0:00:01.06");
    expect(
      compileSubtitles([s], DEFAULT_STYLE, geometry, false, "srt"),
    ).toContain("00:00:01,009 --> 00:00:01,059");
    const end = { ...s, startMs: 4999, endMs: 5000 };
    expect(
      compileSubtitles([end], DEFAULT_STYLE, geometry, false, "ass"),
    ).toContain("0:00:04.99,0:00:05.00");
    const nonCentisecond = { ...s, startMs: 4999, endMs: 5001 };
    expect(
      compileSubtitles(
        [nonCentisecond],
        DEFAULT_STYLE,
        { ...geometry, durationMs: 5001 },
        false,
        "ass",
      ),
    ).toContain("0:00:04.99,0:00:05.01");
  });
  it("rejects commands, paths, unknown fields and invalid ratios", () => {
    expect(
      styleSchema.safeParse({ ...DEFAULT_STYLE, filter: "movie=secret" })
        .success,
    ).toBe(false);
    expect(
      styleSchema.safeParse({
        ...DEFAULT_STYLE,
        fontId: "C:/Windows/private.ttf",
      }).success,
    ).toBe(false);
    expect(
      styleSchema.safeParse({ ...DEFAULT_STYLE, fontSizeRatio: 0.2 }).success,
    ).toBe(false);
  });
  it("neutralizes literal ASS override text using visible fullwidth punctuation", () => {
    expect(escapeAss("{\\pos(0,0)}")).toBe("｛＼pos(0,0)｝");
    const ass = compileSubtitles(
      [{ ...cue, translatedText: "{\\pos(0,0)}" }],
      DEFAULT_STYLE,
      geometry,
      false,
      "ass",
    );
    expect(ass).not.toContain("{\\pos");
    expect(ass).not.toContain("\\uFF");
  });
  it("represents sub-centisecond cues for at least one centisecond and clips fade totals", () => {
    const ass = compileSubtitles([cue], DEFAULT_STYLE, geometry, false, "ass");
    expect(ass).toContain("0:00:01.00,0:00:01.01");
    expect(ass).toContain("\\fad(5,5)");
  });
  it("preserves SRT/VTT millisecond timing and bilingual line breaks", () => {
    const srt = compileSubtitles([cue], DEFAULT_STYLE, geometry, true, "srt");
    expect(srt).toContain("00:00:01,001 --> 00:00:01,002\n你好\nhello");
    const vtt = compileSubtitles([cue], DEFAULT_STYLE, geometry, true, "vtt");
    expect(vtt).toContain("WEBVTT\n\n00:00:01.001");
  });
  it("emphasizes regex-special literal keywords without corrupting adjacent text", () => {
    const ass = compileSubtitles(
      [{ ...cue, translatedText: "C++ (x) C++" }],
      {
        ...DEFAULT_STYLE,
        emphasisBySegment: [{ segmentId: "s1", keywords: ["C++", "(x)"] }],
      },
      geometry,
      false,
      "ass",
    );
    expect(ass.match(/\\c&H4FD5FF&/g)?.length).toBe(3);
    expect(ass).toContain("C++");
    expect(ass).toContain("(x)");
  });
  it("wraps long CJK/latin lines deterministically and scales bilingual source", () => {
    const s = {
      ...cue,
      endMs: 3000,
      translatedText: "翻译".repeat(100),
      sourceText: "original long source text",
    };
    const ass = compileSubtitles([s], DEFAULT_STYLE, geometry, true, "ass");
    expect(ass).toContain("\\N");
    expect(ass).toContain("\\fs25.92");
    expect(compileSubtitles([s], DEFAULT_STYLE, geometry, true, "ass")).toBe(
      ass,
    );
  });
});
