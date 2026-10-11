import { describe, expect, it } from "vitest";
import {
  normalizeCloud,
  normalizeWhisper,
  validateTimeline,
} from "../../../src/main/services/subtitles/lib/timeline";

// Anonymous representative whisper.cpp large-v3-turbo JSON. Extra model,
// timestamp and token metadata intentionally reflects the real native shape.
function nativeResult(
  cues: { from: number; to: number; text: string }[],
): unknown {
  return {
    model: { type: "large-v3-turbo", multilingual: true, vocab: 51866 },
    params: { language: "ja", translate: false },
    result: { language: "ja" },
    transcription: cues.map(({ from, to, text }) => ({
      timestamps: { from: "00:00:00,000", to: "00:00:01,000" },
      offsets: { from, to },
      text,
      tokens: [],
    })),
  };
}

describe("local whisper native-result normalization", () => {
  it("keeps Japanese cues around a nonempty zero-span middle token", () => {
    const normalized = normalizeWhisper(
      nativeResult([
        { from: 100, to: 1000, text: " 最初の字幕です。 " },
        { from: 1000, to: 1000, text: "、" },
        { from: 1000, to: 2200, text: "次の字幕です。" },
      ]),
      500,
      5000,
    );
    expect(normalized).toEqual([
      {
        id: "local-0",
        startMs: 600,
        endMs: 1500,
        sourceText: "最初の字幕です。",
        translatedText: "",
        translationStale: false,
      },
      {
        id: "local-2",
        startMs: 1500,
        endMs: 2700,
        sourceText: "次の字幕です。",
        translatedText: "",
        translationStale: false,
      },
    ]);
  });

  it("drops a zero-span final token without lengthening its valid neighbour", () => {
    const normalized = normalizeWhisper(
      nativeResult([
        { from: 100, to: 4999, text: "最後の字幕。" },
        { from: 5000, to: 5000, text: "。" },
      ]),
      0,
      5000,
    );
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({ startMs: 100, endMs: 4999 });
  });

  it("returns no cues when all native tokens have zero duration, including zero at origin", () => {
    expect(
      normalizeWhisper(
        nativeResult([
          { from: 0, to: 0, text: "。" },
          { from: 1000, to: 1000, text: "、" },
        ]),
        0,
        5000,
      ),
    ).toEqual([]);
  });

  it("does not discard or coalesce legitimate repeated speech", () => {
    const normalized = normalizeWhisper(
      nativeResult([
        { from: 100, to: 800, text: "はい。" },
        { from: 800, to: 800, text: "、" },
        { from: 1000, to: 1800, text: "はい。" },
      ]),
      0,
      5000,
    );
    expect(normalized.map((cue) => [cue.startMs, cue.endMs])).toEqual([
      [100, 800],
      [1000, 1800],
    ]);
  });

  it.each([
    { from: 2000, to: 1000, text: "倒退" },
    { from: 4990, to: 5100, text: "超出" },
    { from: 5100, to: 5100, text: "零时长也超出" },
  ])(
    "retains strict rejection of reversed/out-of-media native times: %j",
    (cue) => {
      expect(() => normalizeWhisper(nativeResult([cue]), 0, 5000)).toThrowError(
        expect.objectContaining({ code: "TIMING_INVALID" }),
      );
    },
  );

  it.each([
    { from: NaN, to: 100, text: "invalid" },
    { from: 0, to: Infinity, text: "invalid" },
    { from: -1, to: 100, text: "invalid" },
    { from: 1.5, to: 100, text: "invalid" },
  ])(
    "returns an actionable structured error for malformed native times: %j",
    (cue) => {
      expect(() => normalizeWhisper(nativeResult([cue]), 0, 5000)).toThrowError(
        expect.objectContaining({ code: "LOCAL_RECOGNITION_INVALID" }),
      );
    },
  );

  it("rejects missing native fields with a safe error rather than leaking raw result", () => {
    expect(() =>
      normalizeWhisper({ text: "private result" }, 0, 5000),
    ).toThrowError(
      expect.objectContaining({ code: "LOCAL_RECOGNITION_INVALID" }),
    );
  });

  it("leaves cloud and manual zero-span validation strict", () => {
    expect(() =>
      normalizeCloud(
        { segments: [{ start: 1, end: 1, text: "zero span" }] },
        0,
        5000,
        "cloud",
      ),
    ).toThrow();
    expect(() =>
      validateTimeline(
        [
          {
            id: "manual",
            startMs: 1000,
            endMs: 1000,
            sourceText: "manual cue",
            translatedText: "",
            translationStale: false,
          },
        ],
        5000,
      ),
    ).toThrow();
  });
});
