import {
  REVIEW_RISK_RANK,
  REVIEW_RULES,
  REVIEW_RUBRIC_VERSION,
  type Job,
  type RepairScope,
  type RepairLoopInput,
  type Segment,
} from "../../../../shared/contracts";
import { AppError } from "../../../lib/errors";
import {
  cueFingerprint,
  refreshReview,
  resolveReprocess,
} from "./reprocessing";

export function scopedCues(job: Job, scope: RepairScope): Segment[] {
  if (scope.mode === "all") return job.segments;
  if (scope.startMs >= scope.endMs || scope.endMs > job.media.durationMs)
    throw new AppError("TIMING_INVALID", "请选择视频范围内有效的起止时间");
  return job.segments.filter(
    (cue) => cue.startMs < scope.endMs && cue.endMs > scope.startMs,
  );
}

export function missingAssessments(
  job: Job,
  scope: RepairScope,
  fingerprint: string,
): string[] {
  refreshReview(job);
  const report = job.reviewReport;
  const compatible =
    report?.profileId === job.options.reviewProfileId &&
    report?.providerFingerprint === fingerprint &&
    report?.rubric?.version === REVIEW_RUBRIC_VERSION &&
    report?.translationEnabled === job.options.translationEnabled;
  return scopedCues(job, scope)
    .filter(
      (cue) =>
        !compatible ||
        !report?.assessments?.some(
          (a) =>
            a.segmentId === cue.id &&
            a.status === "current" &&
            report.contextGroups?.some(
              (group) => group.id === a.contextGroupId,
            ) &&
            report.fingerprints[cue.id] ===
              cueFingerprint(cue, job.options.translationEnabled),
        ),
    )
    .map((cue) => cue.id);
}

export function repairCandidates(
  job: Job,
  input: RepairLoopInput,
): {
  recognizeIds: string[];
  translateIds: string[];
  count: number;
} {
  refreshReview(job);
  const report = job.reviewReport;
  const recognizeIds: string[] = [];
  const translateIds: string[] = [];
  if (
    !report?.assessments ||
    report.rubric?.version !== REVIEW_RUBRIC_VERSION ||
    report.translationEnabled !== job.options.translationEnabled ||
    report.profileId !== job.options.reviewProfileId
  )
    return { recognizeIds, translateIds, count: 0 };
  for (const cue of scopedCues(job, input.scope)) {
    const assessment = report.assessments.find(
      (a) => a.segmentId === cue.id && a.status === "current",
    );
    if (
      !assessment ||
      REVIEW_RISK_RANK[assessment.riskLevel] <
        REVIEW_RISK_RANK[input.threshold] ||
      !report.contextGroups?.some(
        (group) => group.id === assessment.contextGroupId,
      ) ||
      report.fingerprints[cue.id] !==
        cueFingerprint(cue, job.options.translationEnabled)
    )
      continue;
    const qualifying = report.findings.filter((f) => {
      const rule = REVIEW_RULES.find((r) => r.ruleId === f.ruleId);
      return (
        f.segmentId === cue.id &&
        f.status === "pending" &&
        assessment.findingIds.includes(f.id) &&
        f.contextGroupId === assessment.contextGroupId &&
        rule &&
        rule.category === f.category &&
        rule.riskLevel === f.riskLevel &&
        REVIEW_RISK_RANK[rule.riskLevel] >= REVIEW_RISK_RANK[input.threshold]
      );
    });
    // Every qualifying cue needs fresh acoustic evidence, even a translation issue.
    if (qualifying.length)
      recognizeIds.push(cue.id);
  }
  return {
    recognizeIds,
    translateIds,
    count: recognizeIds.length + translateIds.length,
  };
}

/** Explicit repair invalidation also applies when adjudication keeps identical text. */
export function invalidateRepairAssessments(job: Job, ids: string[]): void {
  refreshReview(job);
  const report = job.reviewReport;
  if (!report) return;
  const selected = new Set(ids);
  report.assessments = report.assessments?.map((assessment) => selected.has(assessment.segmentId)
    ? { ...assessment, status: "recheck" } : assessment);
  report.findings = report.findings.map((finding) => selected.has(finding.segmentId)
    ? { ...finding, status: "recheck" } : finding);
  report.state = "stale";
}

export function planRepairRound(
  job: Job,
  input: RepairLoopInput,
): {
  recognition: ReturnType<typeof resolveReprocess> | undefined;
  translateIds: string[];
  affectedCount: number;
  intervals: { startMs: number; endMs: number }[];
} {
  const candidates = repairCandidates(job, input);
  const recognition = candidates.recognizeIds.length
    ? resolveReprocess(job, {
        jobId: job.id,
        revision: job.revision,
        operation: "recognize",
        target: { mode: "selection", segmentIds: candidates.recognizeIds },
      })
    : undefined;
  const covered = new Set(recognition?.segmentIds ?? []);
  const translateIds = candidates.translateIds.filter((id) => !covered.has(id));
  const translations = job.segments.filter((cue) =>
    translateIds.includes(cue.id),
  );
  return {
    recognition,
    translateIds,
    affectedCount: covered.size + translateIds.length,
    intervals: [
      ...(recognition?.intervals ?? []),
      ...translations.map(({ startMs, endMs }) => ({ startMs, endMs })),
    ].sort((a, b) => a.startMs - b.startMs),
  };
}
