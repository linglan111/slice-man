import { createHash } from "node:crypto";
import { z } from "zod";
import {
  planReprocessInputSchema,
  type Job,
  type Segment,
  type Profile,
  type PlanReprocessInput,
  type ReprocessPlan,
  REVIEW_RUBRIC_VERSION,
  REVIEW_RULES,
  REVIEW_RISK_RANK,
  reviewRuleIdSchema,
  type ReviewContextGroup,
  type ReviewRiskLevel,
  type ReviewRuleId,
} from "../../../../shared/contracts";
import { AppError } from "../../../lib/errors";

export function resolveReprocess(
  job: Job,
  raw: PlanReprocessInput,
): ReprocessPlan {
  const input = planReprocessInputSchema.parse(raw);
  if (job.id !== input.jobId) throw new AppError("NOT_FOUND", "视频任务不匹配");
  if (job.revision !== input.revision)
    throw new AppError("STALE_REVISION", "字幕已更新，请重新选择范围");
  const target = input.target;
  let intervals: { startMs: number; endMs: number }[];
  let ids: string[];
  if (target.mode === "selection") {
    const selected = new Set(target.segmentIds);
    if (selected.size !== target.segmentIds.length)
      throw new AppError("DUPLICATE_ID", "所选字幕 ID 重复");
    if (target.segmentIds.some((id) => !job.segments.some((s) => s.id === id)))
      throw new AppError("NOT_FOUND", "所选字幕不存在");
    const segments = job.segments.filter((s) => selected.has(s.id));
    intervals = segments.map(({ startMs, endMs }) => ({ startMs, endMs }));
    ids = segments.map((s) => s.id);
  } else {
    if (target.endMs <= target.startMs || target.endMs > job.media.durationMs)
      throw new AppError("TIMING_INVALID", "请选择视频范围内有效的起止时间");
    intervals = [{ startMs: target.startMs, endMs: target.endMs }];
    ids = job.segments
      .filter((s) => s.startMs < target.endMs && s.endMs > target.startMs)
      .map((s) => s.id);
  }
  if (input.operation === "recognize") {
    for (const interval of intervals) {
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const cue of job.segments) {
          if (cue.startMs < interval.endMs && cue.endMs > interval.startMs) {
            const startMs = Math.min(interval.startMs, cue.startMs);
            const endMs = Math.max(interval.endMs, cue.endMs);
            expanded ||=
              startMs !== interval.startMs || endMs !== interval.endMs;
            interval.startMs = startMs;
            interval.endMs = endMs;
          }
        }
      }
    }
    ids = job.segments
      .filter((s) =>
        intervals.some((r) => s.startMs < r.endMs && s.endMs > r.startMs),
      )
      .map((s) => s.id);
  } else if (!ids.length)
    throw new AppError("NO_SEGMENTS", "此范围没有可翻译的字幕");
  const merged: typeof intervals = [];
  for (const interval of intervals.sort((a, b) => a.startMs - b.startMs)) {
    const last = merged.at(-1);
    if (last && interval.startMs <= last.endMs)
      last.endMs = Math.max(last.endMs, interval.endMs);
    else merged.push({ ...interval });
  }
  return {
    jobId: job.id,
    revision: job.revision,
    operation: input.operation,
    intervals: merged,
    segmentIds: ids,
    affectedCount: ids.length,
  };
}
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function cueFingerprint(
  segment: Segment,
  translationEnabled: boolean,
): string {
  return hash([
    segment.startMs,
    segment.endMs,
    segment.sourceText,
    translationEnabled ? segment.translatedText : "",
  ]);
}
export function providerFingerprint(profile: Profile): string {
  return hash([profile.protocol, profile.mode, profile.baseUrl, profile.model]);
}
export function refreshReview(job: Job): void {
  const report = job.reviewReport;
  if (!report) return;
  const current = new Map(
    job.segments.map((s) => [
      s.id,
      cueFingerprint(s, job.options.translationEnabled),
    ]),
  );
  const changed = report.reviewedSegmentIds.filter(
    (id) => current.get(id) !== report.fingerprints[id],
  );
  const staleGroups = new Set<string>();
  let canonical: ReviewWindow[] = [];
  if (report.assessments) {
    try {
      canonical = reviewWindows(job.segments, job.options.translationEnabled);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "TEXT_LIMIT")
        throw error;
    }
  }
  const groupIds = new Set(canonical.map((window) => window.group.id));
  for (const group of report.contextGroups ?? []) {
    if (
      !groupIds.has(group.id) ||
      group.segmentIds.some((id) => current.get(id) !== group.fingerprints[id])
    )
      staleGroups.add(group.id);
  }
  const incompatible =
    !!report.assessments &&
    (report.rubric?.version !== REVIEW_RUBRIC_VERSION ||
      report.translationEnabled !== job.options.translationEnabled ||
      report.profileId !== job.options.reviewProfileId);
  report.assessments = report.assessments?.map((a) =>
    incompatible ||
    staleGroups.has(a.contextGroupId) ||
    changed.includes(a.segmentId)
      ? { ...a, status: "recheck" }
      : a,
  );
  if (
    changed.length ||
    job.segments.some((s) => !report.reviewedSegmentIds.includes(s.id)) ||
    incompatible ||
    report.assessments?.some((a) => a.status === "recheck")
  )
    report.state = "stale";
  report.findings = report.findings.map((f) =>
    incompatible ||
    changed.includes(f.segmentId) ||
    (f.contextGroupId && staleGroups.has(f.contextGroupId))
      ? { ...f, status: "recheck" }
      : f,
  );
}
export function staleReview(job: Job): void {
  const report = job.reviewReport;
  if (!report) return;
  report.state = "stale";
  report.findings = report.findings.map((f) => ({ ...f, status: "recheck" }));
  report.assessments = report.assessments?.map((a) => ({
    ...a,
    status: "recheck",
  }));
}
export type ReviewWindow = {
  targets: Segment[];
  context: Segment[];
  group: ReviewContextGroup;
};
export function reviewCue(
  segment: Segment,
  translationEnabled: boolean,
): Omit<Segment, "translationStale"> {
  return {
    id: segment.id,
    startMs: segment.startMs,
    endMs: segment.endMs,
    sourceText: segment.sourceText,
    translatedText: translationEnabled ? segment.translatedText : "",
  };
}
export function reviewWindows(
  all: Segment[],
  translationEnabled: boolean,
): ReviewWindow[] {
  const sorted = [...all].sort(
    (a, b) =>
      a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id),
  );
  const windows: ReviewWindow[] = [];
  let offset = 0;
  for (const targets of reviewBatches(sorted, translationEnabled)) {
    const neighbors: Segment[] = [];
    let size = 0;
    let beforeBlocked = false;
    let afterBlocked = false;
    for (let distance = 1; distance <= 2; distance++) {
      for (const direction of [-1, 1]) {
        if (
          (direction === -1 && beforeBlocked) ||
          (direction === 1 && afterBlocked)
        )
          continue;
        const index =
          direction === -1
            ? offset - distance
            : offset + targets.length + distance - 1;
        const cue = sorted[index];
        if (!cue) continue;
        const length = JSON.stringify(
          reviewCue(cue, translationEnabled),
        ).length;
        if (size + length > 8000) {
          if (direction === -1) beforeBlocked = true;
          else afterBlocked = true;
          continue;
        }
        size += length;
        neighbors.push(cue);
      }
    }
    const context = [...targets, ...neighbors].sort(
      (a, b) =>
        a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id),
    );
    const windowSegmentIds = targets.map((s) => s.id);
    const segmentIds = context.map((s) => s.id);
    const fingerprints = Object.fromEntries(
      context.map((s) => [s.id, cueFingerprint(s, translationEnabled)]),
    );
    const id = hash([
      REVIEW_RUBRIC_VERSION,
      translationEnabled,
      windowSegmentIds,
      segmentIds,
      fingerprints,
    ]);
    windows.push({
      targets,
      context,
      group: { id, windowSegmentIds, segmentIds, fingerprints },
    });
    offset += targets.length;
  }
  return windows;
}
export type ValidatedAssessment = {
  segmentId: string;
  riskLevel: ReviewRiskLevel;
  issues: {
    ruleId: ReviewRuleId;
    category: "timing" | "source" | "translation";
    riskLevel: "low" | "medium" | "high";
    reason: string;
    evidenceIds: string[];
  }[];
};
export function validateAssessments(
  raw: unknown,
  selected: Segment[],
  context: Segment[],
  translationEnabled: boolean,
): ValidatedAssessment[] {
  const parsed = z
    .object({
      assessments: z
        .array(
          z
            .object({
              segmentId: z.string(),
              issues: z
                .array(
                  z
                    .object({
                      ruleId: reviewRuleIdSchema,
                      reason: z.string().trim().min(1).max(500),
                      evidenceIds: z.array(z.string()).min(1).max(34),
                    })
                    .strict(),
                )
                .max(3),
            })
            .strict(),
        )
        .max(selected.length),
    })
    .strict()
    .safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      "REVIEW_INVALID",
      "AI 检查必须为每条目标字幕返回完整的规则判断，已保留上次报告",
    );
  const targets = new Map(selected.map((s) => [s.id, s]));
  const supplied = new Map(
    context.map((s, index) => [s.id, { cue: s, index }]),
  );
  const seen = new Set<string>();
  const assessments: ValidatedAssessment[] = [];
  for (const assessment of parsed.data.assessments) {
    const cue = targets.get(assessment.segmentId);
    if (!cue || seen.has(assessment.segmentId))
      throw new AppError("REVIEW_IDS", "检查结果包含未知或重复的目标字幕");
    seen.add(assessment.segmentId);
    const rules = new Set<string>();
    let riskLevel: ReviewRiskLevel = "none";
    const issues: ValidatedAssessment["issues"] = [];
    for (const issue of assessment.issues) {
      const rule = REVIEW_RULES.find((r) => r.ruleId === issue.ruleId);
      if (
        !rule ||
        rules.has(issue.ruleId) ||
        new Set(issue.evidenceIds).size !== issue.evidenceIds.length ||
        !issue.evidenceIds.includes(cue.id) ||
        issue.evidenceIds.some((id) => !supplied.has(id)) ||
        (rule.category === "translation" &&
          (!translationEnabled || !cue.translatedText.trim()))
      )
        throw new AppError(
          "REVIEW_IDS",
          "检查规则或证据不适用于当前字幕上下文",
        );
      rules.add(issue.ruleId);
      const cueIndex = supplied.get(cue.id)?.index;
      const neighboringEvidence = issue.evidenceIds.filter(
        (id) =>
          id !== cue.id &&
          cueIndex !== undefined &&
          Math.abs((supplied.get(id)?.index ?? -100) - cueIndex) <= 2,
      );
      if (
        (issue.ruleId === "source.sustained_breakdown" &&
          neighboringEvidence.length < 2) ||
        (["source.context_inconsistency", "source.suspected_omission"].includes(
          issue.ruleId,
        ) &&
          !neighboringEvidence.length)
      )
        throw new AppError(
          "REVIEW_EVIDENCE",
          "上下文疑点缺少所要求的相邻字幕证据",
        );
      const chars = [
        ...(translationEnabled && cue.translatedText
          ? cue.translatedText
          : cue.sourceText
        ).replace(/\s/gu, ""),
      ].length;
      const duration = cue.endMs - cue.startMs;
      if (
        issue.ruleId === "timing.severe_readability" &&
        !(chars >= 20 && (duration <= 500 || (chars / duration) * 1000 >= 45))
      )
        throw new AppError(
          "REVIEW_EVIDENCE",
          "高风险时轴判断不符合固定的严重阅读时长标准",
        );
      if (REVIEW_RISK_RANK[rule.riskLevel] > REVIEW_RISK_RANK[riskLevel])
        riskLevel = rule.riskLevel;
      issues.push({
        ...issue,
        category: rule.category,
        riskLevel: rule.riskLevel,
      });
    }
    assessments.push({ segmentId: cue.id, riskLevel, issues });
  }
  if (seen.size !== targets.size)
    throw new AppError(
      "REVIEW_INCOMPLETE",
      "AI 检查遗漏了目标字幕，未发布不完整的评级",
    );
  return selected.map((s) => {
    const result = assessments.find((a) => a.segmentId === s.id);
    if (!result) throw new AppError("REVIEW_INCOMPLETE", "字幕评级缺失");
    return result;
  });
}
export function reviewBatches(
  selected: Segment[],
  translationEnabled = true,
): Segment[][] {
  const batches: Segment[][] = [];
  let batch: Segment[] = [];
  let size = 0;
  for (const cue of selected) {
    const length = JSON.stringify({
      ...cue,
      translatedText: translationEnabled ? cue.translatedText : "",
    }).length;
    if (length > 24000)
      throw new AppError(
        "TEXT_LIMIT",
        "单条字幕内容过长，请拆分或缩短后再处理",
      );
    if (batch.length && (batch.length >= 30 || size + length > 24000)) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(cue);
    size += length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export function neighboringContext(
  all: Segment[],
  selected: Segment[],
): Segment[] {
  const indexes = selected.map((s) =>
    all.findIndex((candidate) => candidate.id === s.id),
  );
  return all.filter(
    (s, index) =>
      !selected.some((cue) => cue.id === s.id) &&
      indexes.some((i) => Math.abs(i - index) <= 2),
  );
}
export function validateReview(
  raw: unknown,
  selected: Segment[],
  translationEnabled: boolean,
): {
  segmentId: string;
  category: "timing" | "source" | "translation";
  reason: string;
}[] {
  const parsed = z
    .object({
      findings: z
        .array(
          z
            .object({
              segmentId: z.string(),
              category: z.enum(["timing", "source", "translation"]),
              reason: z.string().trim().min(1).max(500),
            })
            .strict(),
        )
        .max(selected.length * 3),
    })
    .strict()
    .safeParse(raw);
  if (!parsed.success)
    throw new AppError("REVIEW_INVALID", "AI 检查结果格式无效，已保留上次报告");
  const seen = new Set<string>();
  for (const finding of parsed.data.findings) {
    const cue = selected.find((s) => s.id === finding.segmentId);
    const key = `${finding.segmentId}:${finding.category}`;
    if (
      !cue ||
      seen.has(key) ||
      (finding.category === "translation" &&
        (!translationEnabled || !cue.translatedText.trim()))
    )
      throw new AppError(
        "REVIEW_IDS",
        "检查结果包含未知、重复或不适用的字幕项",
      );
    seen.add(key);
  }
  return parsed.data.findings;
}
