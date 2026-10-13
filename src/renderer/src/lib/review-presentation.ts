import {
  REVIEW_RUBRIC_VERSION,
  reviewRiskLevelSchema,
  type Job,
  type ReviewRiskLevel,
} from "../../../shared/contracts";

export type ReviewFilter = "all" | "pending" | "unchecked" | ReviewRiskLevel;
export type ReviewGradeView = {
  state: "current" | "stale" | "legacy" | "unreviewed";
  riskLevel?: ReviewRiskLevel;
};
export const REVIEW_LEVELS = reviewRiskLevelSchema.options;

/** A missing or outdated assessment must never acquire an implicit none grade. */
export function reviewGrades(job: Job): {
  views: Map<string, ReviewGradeView>;
  counts: Record<ReviewRiskLevel, number>;
  pendingIds: string[];
  uncheckedIds: string[];
} {
  const views = new Map<string, ReviewGradeView>();
  const counts: Record<ReviewRiskLevel, number> = {
    none: 0,
    low: 0,
    medium: 0,
    high: 0,
  };
  const report = job.reviewReport;
  const assessments = new Map(
    report?.assessments?.map((assessment) => [
      assessment.segmentId,
      assessment,
    ]),
  );
  const inspectedIds = new Set(report?.reviewedSegmentIds ?? []);
  const pending = new Set<string>();
  const isConfigurationStale = Boolean(
    report?.assessments &&
    (report.rubric?.version !== REVIEW_RUBRIC_VERSION ||
      (report.translationEnabled !== undefined &&
        report.translationEnabled !== job.options.translationEnabled)),
  );
  for (const segment of job.segments) {
    const assessment = assessments.get(segment.id);
    let view: ReviewGradeView;
    if (assessment) {
      const isStale = assessment.status === "recheck" || isConfigurationStale;
      view = {
        state: isStale ? "stale" : "current",
        riskLevel: assessment.riskLevel,
      };
      if (isStale) pending.add(segment.id);
      else counts[assessment.riskLevel]++;
    } else if (inspectedIds.has(segment.id)) {
      view = { state: "legacy" };
      pending.add(segment.id);
    } else {
      view = { state: "unreviewed" };
      pending.add(segment.id);
    }
    views.set(segment.id, view);
  }
  for (const finding of report?.findings ?? []) {
    if (
      finding.status !== "ignored" &&
      views.has(finding.segmentId) &&
      (job.options.translationEnabled || finding.category !== "translation")
    )
      pending.add(finding.segmentId);
  }
  // Keep selections in video order regardless of report/model output order.
  return {
    views,
    counts,
    pendingIds: job.segments
      .filter((segment) => pending.has(segment.id))
      .map((segment) => segment.id),
    uncheckedIds: job.segments
      .filter((segment) => views.get(segment.id)?.state === "unreviewed")
      .map((segment) => segment.id),
  };
}

export function filteredReviewIds(
  job: Job,
  filter: ReviewFilter,
  grades: ReturnType<typeof reviewGrades>,
): string[] {
  if (filter === "pending") return grades.pendingIds;
  if (filter === "unchecked") return grades.uncheckedIds;
  if (filter === "all") return job.segments.map((segment) => segment.id);
  return job.segments
    .filter((segment) => {
      const view = grades.views.get(segment.id);
      return view?.state === "current" && view.riskLevel === filter;
    })
    .map((segment) => segment.id);
}

/** Multiple grades form a union, with IDs kept in the original video order. */
export function multiFilteredReviewIds(
  job: Job,
  filters: ReviewFilter[],
  grades: ReturnType<typeof reviewGrades>,
): string[] {
  if (!filters.length || filters.includes('all')) return job.segments.map((segment) => segment.id);
  const pendingIds = new Set(grades.pendingIds);
  const uncheckedIds = new Set(grades.uncheckedIds);
  const selectedFilters = new Set(filters);
  return job.segments.filter((segment) => {
    if (selectedFilters.has('pending') && pendingIds.has(segment.id)) return true;
    if (selectedFilters.has('unchecked') && uncheckedIds.has(segment.id)) return true;
    const view = grades.views.get(segment.id);
    return view?.state === 'current' && view.riskLevel !== undefined && selectedFilters.has(view.riskLevel);
  }).map((segment) => segment.id);
}
