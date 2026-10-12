import { describe, expect, it } from "vitest";
import type { Segment } from "../../../src/shared/contracts";
import {
  createReviewRequest,
  validateReviewResponse,
  reviewCorrectionPrompt,
  assertReviewPromptBudget,
  MAX_REVIEW_PROMPT_BYTES,
  REVIEW_CORRECTION_RESERVE_BYTES,
} from "../../../src/main/services/jobs/lib/review-request";
import { AppError } from "../../../src/main/lib/errors";

const cues = (length: number): Segment[] =>
  Array.from({ length }, (_, n) => ({
    id: `cue-${n}`,
    startMs: n * 1000,
    endMs: n * 1000 + 900,
    sourceText: `Anonymous cue ${n}`,
    translatedText: "",
    translationStale: false,
  }));
const none = (targets: number[]): unknown => ({
  a: targets.map((n) => [n, []]),
});
describe("aggregate compact review wire", () => {
  it.each([31, 65, 1027, 2000])(
    "covers %i targets with original canonical groups",
    (length) => {
      const all = cues(length);
      const request = createReviewRequest(all, all, false);
      const validated = validateReviewResponse(
        none([...request.targetAliases]),
        request,
        false,
      );
      expect(validated.flatMap((group) => group.assessments)).toHaveLength(
        length,
      );
      expect(request.groups).toHaveLength(Math.ceil(length / 30));
      expect(
        Buffer.byteLength(request.prompt) + REVIEW_CORRECTION_RESERVE_BYTES,
      ).toBeLessThanOrEqual(MAX_REVIEW_PROMPT_BYTES);
    },
  );
  it("preserves full-timeline gaps and rejects globally present evidence outside the target canonical group", () => {
    const all = cues(100);
    const request = createReviewRequest(
      all,
      [all[0] as Segment, all[90] as Segment],
      false,
    );
    expect([...request.targetAliases]).toEqual([0, 90]);
    expect(request.aliases.has(90)).toBe(true);
    expect(() =>
      validateReviewResponse(
        {
          a: [
            [0, [["source.context_inconsistency", "test", [0, 90]]]],
            [90, []],
          ],
        },
        request,
        false,
      ),
    ).toThrowError(expect.objectContaining({ code: "REVIEW_IDS" }));
    const validated = validateReviewResponse(none([0, 90]), request, false);
    expect(validated[0]?.window.group.segmentIds).not.toContain("cue-90");
  });
  it("diagnoses actual late-group evidence failure using only trusted aliases and rules", () => {
    const all = cues(31);
    const request = createReviewRequest(all, all, false);
    const raw = {
      a: all.map((_, n) => [
        n,
        n === 29
          ? [["source.context_inconsistency", "PRIVATE PROVIDER REASON", [29]]]
          : [],
      ]),
    };
    let failure: unknown;
    try {
      validateReviewResponse(raw, request, false);
    } catch (error) {
      failure = error;
    }
    const correction = reviewCorrectionPrompt(request, failure);
    expect(correction).toContain('"target":29');
    expect(correction).toContain('"adjacent":[27,28,30]');
    expect(correction).not.toContain("PRIVATE PROVIDER REASON");
  });
  it.each([
    { a: [[-1, []]] },
    { a: [[0.5, []]] },
    { a: [[0, [], 1]] },
    { a: [[0, [["unknown", "reason", [0]]]]] },
    { a: [[0, [["source.minor_wording", "reason", [0, 0]]]]] },
    {
      a: [
        [0, []],
        [0, []],
      ],
    },
    { a: [] },
    { a: [[8, []]] },
    { a: [[0, []]], extra: true },
  ])(
    "rejects malformed, duplicate, missing or unknown compact tuples %j",
    (raw) => {
      const all = cues(1);
      expect(() =>
        validateReviewResponse(
          raw,
          createReviewRequest(all, all, false),
          false,
        ),
      ).toThrow();
    },
  );
  it("rejects context-only targets, impossible severe timing and source-only translation", () => {
    const all = cues(3);
    const request = createReviewRequest(all, [all[1] as Segment], false);
    for (const raw of [
      { a: [[0, []]] },
      { a: [[1, [["timing.severe_readability", "reason", [1]]]]] },
      { a: [[1, [["translation.meaning_problem", "reason", [1]]]]] },
    ])
      expect(() => validateReviewResponse(raw, request, false)).toThrow();
  });
  it("preflights target cap and counts UTF-8 bytes including correction reserve exactly", () => {
    const all = cues(2001);
    expect(() => createReviewRequest(all, all, false)).toThrowError(
      expect.objectContaining({ code: "TEXT_LIMIT" }),
    );
    const allowance = MAX_REVIEW_PROMPT_BYTES - REVIEW_CORRECTION_RESERVE_BYTES;
    assertReviewPromptBudget("a".repeat(allowance));
    expect(() =>
      assertReviewPromptBudget(
        JSON.stringify('"'.repeat(Math.floor(allowance / 2))),
      ),
    ).toThrow();
    expect(() =>
      assertReviewPromptBudget("a".repeat(allowance) + "a"),
    ).toThrow();
    expect(() =>
      assertReviewPromptBudget("界".repeat(Math.floor(allowance / 3) + 1)),
    ).toThrow();
    const large = cues(1200).map((c) => ({
      ...c,
      sourceText: "界".repeat(200),
    }));
    expect(() => createReviewRequest(large, large, false)).toThrowError(
      expect.objectContaining({ code: "TEXT_LIMIT" }),
    );
  });
  it.each([
    "CANCELLED",
    "TRUNCATED",
    "AUTH_ERROR",
    "PROVIDER_TIMEOUT",
    "NETWORK_ERROR",
    "TEXT_LIMIT",
    "STALE_REVISION",
  ])("never content-corrects %s", (code) => {
    const all = cues(1);
    expect(
      reviewCorrectionPrompt(
        createReviewRequest(all, all, false),
        new AppError(code, "unsafe detail"),
      ),
    ).toBeUndefined();
  });
});
