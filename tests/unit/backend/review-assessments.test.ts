import { describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE,
  optionsSchema,
  jobSchema,
  REVIEW_RUBRIC,
  REVIEW_RUBRIC_VERSION,
  type Job,
  type Segment,
  type ReviewRuleId,
} from "../../../src/shared/contracts";
import {
  cueFingerprint,
  resolveReviewInput,
  refreshReview,
  reviewWindows,
  validateAssessments,
} from "../../../src/main/services/jobs/lib/reprocessing";

function cue(index: number): Segment {
  return {
    id: `cue-${index}`,
    startMs: index * 1000,
    endMs: index * 1000 + 900,
    sourceText: `Chronological source ${index}`,
    translatedText: `对应译文 ${index}`,
    translationStale: false,
  };
}
function output(
  ids: string[],
  rule?: ReviewRuleId,
  evidence?: string[],
): unknown {
  return {
    assessments: ids.map((id) => ({
      segmentId: id,
      issues: rule
        ? [
            {
              ruleId: rule,
              reason: "具体原文或上下文存在疑点，需要人工听音确认",
              evidenceIds: evidence ?? [id],
            },
          ]
        : [],
    })),
  };
}
function gradedJob(count = 65): Job {
  const segments = Array.from({ length: count }, (_, i) => cue(i));
  const stage = { state: "idle" as const, progress: 0, message: "" };
  const windows = reviewWindows(segments, true);
  return {
    id: "job",
    name: "anonymous",
    inputPath: "fixture",
    media: {
      durationMs: count * 1000,
      width: 640,
      height: 480,
      hasAudio: false,
      audioOffsetMs: 0,
      rotation: 0,
      sampleAspectRatio: "1:1",
    },
    options: optionsSchema.parse({ reviewProfileId: "review" }),
    segments,
    style: structuredClone(DEFAULT_STYLE),
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    outputs: [],
    stages: {
      recognize: { ...stage },
      translate: { ...stage },
      style: { ...stage },
      preview: { ...stage },
      export: { ...stage },
    },
    reviewReport: {
      id: "report",
      profileId: "review",
      providerFingerprint: "fixture",
      completedAt: 1,
      state: "complete",
      reviewedSegmentIds: segments.map((s) => s.id),
      fingerprints: Object.fromEntries(
        segments.map((s) => [s.id, cueFingerprint(s, true)]),
      ),
      findings: [],
      rubric: {
        version: REVIEW_RUBRIC_VERSION,
        rules: [...REVIEW_RUBRIC.rules],
      },
      translationEnabled: true,
      contextGroups: windows.map((window) => window.group),
      assessments: windows.flatMap((window) =>
        window.targets.map((s) => ({
          segmentId: s.id,
          riskLevel: "none" as const,
          status: "current" as const,
          contextGroupId: window.group.id,
          findingIds: [],
        })),
      ),
    },
  };
}
describe("canonical contextual rubric and explicit assessment coverage", () => {
  it("derives fixed categories/levels, maximum grade and explicit none without trusting arbitrary severity", () => {
    const context = [cue(0), cue(1), cue(2)];
    const raw = {
      assessments: [
        { segmentId: "cue-0", issues: [] },
        {
          segmentId: "cue-1",
          issues: [
            {
              ruleId: "source.minor_wording",
              reason: "轻微措辞",
              evidenceIds: ["cue-1"],
            },
            {
              ruleId: "translation.negation_contradiction",
              reason: "原文否定关系被译文颠倒",
              evidenceIds: ["cue-1"],
            },
          ],
        },
      ],
    };
    const grades = validateAssessments(raw, context.slice(0, 2), context, true);
    expect(grades.map((a) => a.riskLevel)).toEqual(["none", "high"]);
    expect(
      grades[1]?.issues.map((issue) => [issue.category, issue.riskLevel]),
    ).toEqual([
      ["source", "low"],
      ["translation", "high"],
    ]);
    expect(() =>
      validateAssessments(
        {
          assessments: [{ segmentId: "cue-0", riskLevel: "high", issues: [] }],
        },
        [context[0] as Segment],
        context,
        true,
      ),
    ).toThrowError(expect.objectContaining({ code: "REVIEW_INVALID" }));
  });
  it.each([
    { assessments: [] },
    {
      assessments: [
        { segmentId: "cue-0", issues: [] },
        { segmentId: "cue-0", issues: [] },
      ],
    },
    { assessments: [{ segmentId: "unknown", issues: [] }] },
    {
      assessments: [
        {
          segmentId: "cue-0",
          issues: [
            { ruleId: "invented-high", reason: "bad", evidenceIds: ["cue-0"] },
          ],
        },
      ],
    },
    {
      assessments: [
        {
          segmentId: "cue-0",
          issues: [
            {
              ruleId: "source.minor_wording",
              reason: "bad",
              evidenceIds: ["outside"],
            },
          ],
        },
      ],
    },
    {
      assessments: [
        {
          segmentId: "cue-0",
          issues: [
            {
              ruleId: "source.minor_wording",
              reason: "bad",
              evidenceIds: ["cue-0", "cue-0"],
            },
          ],
        },
      ],
    },
  ])(
    "rejects missing/duplicate/unknown cue, rule and evidence without producing implicit none: %j",
    (raw) => {
      expect(() =>
        validateAssessments(raw, [cue(0), cue(1)], [cue(0), cue(1)], true),
      ).toThrow();
    },
  );
  it("requires nearby evidence for strong contextual high and measurable severe readability, while guarding inactive translations", () => {
    const context = Array.from({ length: 10 }, (_, i) => cue(i));
    expect(
      validateAssessments(
        output(["cue-1"], "source.sustained_breakdown", [
          "cue-1",
          "cue-0",
          "cue-2",
        ]),
        [context[1] as Segment],
        context,
        true,
      )[0]?.riskLevel,
    ).toBe("high");
    expect(() =>
      validateAssessments(
        output(["cue-1"], "source.sustained_breakdown", [
          "cue-1",
          "cue-9",
          "cue-8",
        ]),
        [context[1] as Segment],
        context,
        true,
      ),
    ).toThrowError(expect.objectContaining({ code: "REVIEW_EVIDENCE" }));
    expect(() =>
      validateAssessments(
        output(["cue-1"], "source.context_inconsistency"),
        [context[1] as Segment],
        context,
        true,
      ),
    ).toThrowError(expect.objectContaining({ code: "REVIEW_EVIDENCE" }));
    expect(() =>
      validateAssessments(
        output(["cue-1"], "translation.negation_contradiction"),
        [context[1] as Segment],
        context,
        false,
      ),
    ).toThrowError(expect.objectContaining({ code: "REVIEW_IDS" }));
    expect(() =>
      validateAssessments(
        output(["cue-1"], "timing.severe_readability"),
        [context[1] as Segment],
        context,
        true,
      ),
    ).toThrowError(expect.objectContaining({ code: "REVIEW_EVIDENCE" }));
    const rapid = {
      ...cue(1),
      endMs: 1400,
      translatedText: "严重不可读的字幕文字".repeat(4),
    };
    expect(
      validateAssessments(
        output(["cue-1"], "timing.severe_readability"),
        [rapid],
        [rapid],
        true,
      )[0]?.riskLevel,
    ).toBe("high");
    expect(
      REVIEW_RUBRIC.rules.find(
        (rule) => rule.ruleId === "source.sustained_breakdown",
      )?.counterexample,
    ).toContain("话题变化");
  });
});
describe("stable chronological context snapshots", () => {
  it("provides identical actual context to full, boundary-selected and sparse selected targets", () => {
    const all = Array.from({ length: 65 }, (_, i) => cue(i));
    const full = reviewWindows(all, true);
    const sparseIds = new Set(["cue-0", "cue-29", "cue-30", "cue-64"]);
    const selected = reviewWindows(all, true).filter((w) =>
      w.targets.some((s) => sparseIds.has(s.id)),
    );
    expect(selected.map((w) => w.context)).toEqual(full.map((w) => w.context));
    expect(full[0]?.context.at(-1)?.id).toBe("cue-31");
    expect(full[1]?.context[0]?.id).toBe("cue-28");
    expect(full[0]?.context.some((s) => s.id === "cue-64")).toBe(false);
    expect(
      full.every((w) => w.targets.length <= 30 && w.context.length <= 34),
    ).toBe(true);
  });
  it("invalidates all dependent none/results for neighbor edits while leaving unrelated windows current", () => {
    const job = gradedJob();
    const report = job.reviewReport;
    if (!report) throw new Error("missing report");
    report.findings = [
      {
        id: "finding",
        segmentId: "cue-0",
        category: "source",
        reason: "prior suspicion",
        riskLevel: "low",
        status: "ignored",
        contextGroupId: report.assessments?.[0]?.contextGroupId,
      },
    ];
    const changed = job.segments[30];
    if (!changed) throw new Error("missing cue");
    changed.sourceText = "changed neighboring evidence";
    refreshReview(job);
    expect(
      report.assessments?.find((a) => a.segmentId === "cue-0")?.status,
    ).toBe("recheck");
    expect(
      report.assessments?.find((a) => a.segmentId === "cue-29")?.status,
    ).toBe("recheck");
    expect(
      report.assessments?.find((a) => a.segmentId === "cue-64")?.status,
    ).toBe("current");
    expect(report.findings[0]?.status).toBe("recheck");
    expect(report.state).toBe("stale");
  });
  it("detects insertion/removal/fresh IDs in supplied chronology and never transfers grades to fresh cues", () => {
    for (const mutation of ["insert", "remove", "replace"] as const) {
      const job = gradedJob();
      if (mutation === "insert")
        job.segments.push({ ...cue(0), id: "new", startMs: 500, endMs: 700 });
      else if (mutation === "remove") job.segments.splice(1, 1);
      else {
        const cue = job.segments[1];
        if (cue) cue.id = "new";
      }
      refreshReview(job);
      expect(job.reviewReport?.assessments?.[0]?.status).toBe("recheck");
      expect(
        job.reviewReport?.assessments?.some((a) => a.segmentId === "new"),
      ).toBe(false);
    }
  });
  it("keeps legacy reports readable/ungraded and marks version/mode/config switches stale even for none", () => {
    const legacy = gradedJob(3);
    const report = legacy.reviewReport;
    if (!report) throw new Error("missing");
    delete report.assessments;
    delete report.contextGroups;
    delete report.rubric;
    delete report.translationEnabled;
    expect(jobSchema.parse(legacy).reviewReport?.assessments).toBeUndefined();
    for (const kind of ["rubric", "mode", "profile"] as const) {
      const job = gradedJob(3);
      if (kind === "rubric" && job.reviewReport?.rubric)
        job.reviewReport.rubric.version = "old-rubric";
      else if (kind === "mode") job.options.translationEnabled = false;
      else if (kind === "profile") job.options.reviewProfileId = "new-profile";
      refreshReview(job);
      expect(
        job.reviewReport?.assessments?.every((a) => a.status === "recheck"),
      ).toBe(true);
      expect(job.revision).toBe(1);
    }
  });
});


describe("review time-range resolution before provider work", () => {
  it("selects half-open overlapping complete cues without losing global context", () => {
    const job = gradedJob(5);
    expect(resolveReviewInput(job, { jobId: job.id, revision: job.revision, range: { startMs: 900, endMs: 2100 } }).segmentIds)
      .toEqual(["cue-1", "cue-2"]);
    expect(job.segments).toHaveLength(5);
  });
  it.each([{ startMs: 2000, endMs: 2000 }, { startMs: 3000, endMs: 2000 }, { startMs: 0, endMs: 5001 }])("rejects invalid bounds before provider work %j", (range) => {
    const job = gradedJob(5);
    expect(() => resolveReviewInput(job, { jobId: job.id, revision: job.revision, range })).toThrowError(expect.objectContaining({ code: "TIMING_INVALID" }));
  });
  it("rejects empty ranges and simultaneous selections without falling back to all cues", () => {
    const job = gradedJob(5);
    expect(() => resolveReviewInput(job, { jobId: job.id, revision: job.revision, range: { startMs: 900, endMs: 1000 } })).toThrowError(expect.objectContaining({ code: "NO_SEGMENTS" }));
    expect(() => resolveReviewInput(job, { jobId: job.id, revision: job.revision, segmentIds: ["cue-0"], range: { startMs: 0, endMs: 1000 } })).toThrow();
    expect(() => resolveReviewInput(job, { jobId: job.id, revision: job.revision - 1, range: { startMs: 0, endMs: 1000 } })).toThrowError(expect.objectContaining({ code: "STALE_REVISION" }));
  });
});
