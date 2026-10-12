import { describe, expect, it } from "vitest";
import { savedJob } from "./app-fixtures";
import {
  reviewGrades,
  filteredReviewIds,
} from "../../../src/renderer/src/lib/review-presentation";

describe("unchecked review classification", () => {
  it.each([269, 1027])(
    "includes %i never-assessed cues in pending and explicit unchecked",
    (length) => {
      const job = savedJob();
      job.reviewReport = undefined;
      job.segments = Array.from({ length }, (_, n) => ({
        id: `anonymous-${n}`,
        startMs: n * 100,
        endMs: n * 100 + 80,
        sourceText: "anonymous",
        translatedText: "",
        translationStale: false,
      }));
      const grades = reviewGrades(job);
      expect(grades.pendingIds).toHaveLength(length);
      expect(grades.uncheckedIds).toHaveLength(length);
      expect(grades.counts.none).toBe(0);
      expect(filteredReviewIds(job, "unchecked", grades)).toEqual(
        grades.pendingIds,
      );
    },
  );
});
