import { z } from "zod";
import { reviewRiskLevelSchema, reviewRuleSchema } from "./review-rubric";
export * from "./review-rubric";

const id = z.string().min(1).max(100);
const ms = z.number().int().nonnegative();
export const importOptionsSchema = z
  .object({
    translationEnabled: z.boolean().optional(),
    sourceLanguage: z.string().min(1).max(50).optional(),
    targetLanguage: z.string().min(1).max(50).optional(),
  })
  .strict();
export type ImportOptions = z.infer<typeof importOptionsSchema>;
export const reprocessTargetSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("selection"),
      segmentIds: z.array(id).min(1).max(10000),
    })
    .strict(),
  z.object({ mode: z.literal("range"), startMs: ms, endMs: ms }).strict(),
]);
export type ReprocessTarget = z.infer<typeof reprocessTargetSchema>;
export const reprocessInputSchema = z
  .object({
    jobId: id,
    revision: ms,
    target: reprocessTargetSchema,
  })
  .strict();
export type ReprocessInput = z.infer<typeof reprocessInputSchema>;
export const planReprocessInputSchema = reprocessInputSchema.extend({
  operation: z.enum(["recognize", "translate"]),
});
export type PlanReprocessInput = z.infer<typeof planReprocessInputSchema>;
export const recognizePartialInputSchema = reprocessInputSchema.extend({
  translate: z.boolean().default(false),
});
export type RecognizePartialInput = z.input<typeof recognizePartialInputSchema>;
export const reprocessPlanSchema = z
  .object({
    jobId: id,
    revision: ms,
    operation: z.enum(["recognize", "translate"]),
    intervals: z.array(z.object({ startMs: ms, endMs: ms }).strict()),
    segmentIds: z.array(id),
    affectedCount: ms,
  })
  .strict();
export type ReprocessPlan = z.infer<typeof reprocessPlanSchema>;
export const reviewFindingSchema = z
  .object({
    id,
    segmentId: id,
    category: z.enum(["timing", "source", "translation"]),
    reason: z.string().trim().min(1).max(500),
    startMs: ms.optional(),
    endMs: ms.optional(),
    status: z.enum(["pending", "ignored", "recheck"]),
    riskLevel: reviewRiskLevelSchema.optional(),
    ruleId: z.string().min(1).max(100).optional(),
    evidenceIds: z.array(id).max(40).optional(),
    contextGroupId: id.optional(),
  })
  .strict();
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export const reviewAssessmentSchema = z
  .object({
    segmentId: id,
    riskLevel: reviewRiskLevelSchema,
    status: z.enum(["current", "recheck"]),
    contextGroupId: id,
    findingIds: z.array(id).max(3),
  })
  .strict();
export type ReviewAssessment = z.infer<typeof reviewAssessmentSchema>;
export const reviewContextGroupSchema = z
  .object({
    id,
    windowSegmentIds: z.array(id).min(1).max(30),
    segmentIds: z.array(id).min(1).max(34),
    fingerprints: z.record(z.string(), z.string()),
  })
  .strict();
export type ReviewContextGroup = z.infer<typeof reviewContextGroupSchema>;
export const reviewReportSchema = z
  .object({
    id,
    profileId: id,
    providerFingerprint: z.string(),
    completedAt: ms,
    state: z.enum(["complete", "stale"]),
    reviewedSegmentIds: z.array(id).max(10000),
    fingerprints: z.record(z.string(), z.string()),
    findings: z.array(reviewFindingSchema).max(30000),
    assessments: z.array(reviewAssessmentSchema).max(10000).optional(),
    contextGroups: z.array(reviewContextGroupSchema).max(10000).optional(),
    rubric: z
      .object({ version: z.string(), rules: z.array(reviewRuleSchema).max(50) })
      .strict()
      .optional(),
    translationEnabled: z.boolean().optional(),
  })
  .strict();
export type ReviewReport = z.infer<typeof reviewReportSchema>;
export const reviewSubtitlesInputSchema = z
  .object({
    jobId: id,
    revision: ms,
    segmentIds: z.array(id).min(1).max(10000).optional(),
    range: z.object({ startMs: ms, endMs: ms }).strict().optional(),
  })
  .strict().refine((input) => !input.range || !input.segmentIds, "Choose a time range or selected subtitles, not both");
export type ReviewSubtitlesInput = z.infer<typeof reviewSubtitlesInputSchema>;
export const acknowledgeFindingInputSchema = z
  .object({
    jobId: id,
    reportId: id,
    findingId: id,
    status: z.enum(["pending", "ignored"]),
  })
  .strict();
export type AcknowledgeFindingInput = z.infer<
  typeof acknowledgeFindingInputSchema
>;

export const repairScopeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }).strict(),
  z.object({ mode: z.literal("range"), startMs: ms, endMs: ms }).strict(),
]);
export type RepairScope = z.infer<typeof repairScopeSchema>;
export const repairLoopInputSchema = z
  .object({
    jobId: id,
    revision: ms,
    threshold: z.enum(["low", "medium", "high"]),
    maxRounds: z.number().int().min(1).max(20),
    scope: repairScopeSchema,
  })
  .strict();
export type RepairLoopInput = z.infer<typeof repairLoopInputSchema>;
export const repairRunSchema = z
  .object({
    id,
    scope: repairScopeSchema,
    threshold: repairLoopInputSchema.shape.threshold,
    maxRounds: repairLoopInputSchema.shape.maxRounds,
    state: z.enum([
      "running",
      "succeeded",
      "cancelled",
      "failed",
      "interrupted",
    ]),
    phase: z.enum([
      "analysis",
      "recognize",
      "translate",
      "adjudication",
      "commit",
      "reassessment",
      "final_consistency",
      "done",
    ]),
    round: ms.max(20),
    committedRounds: ms.max(20),
    affectedCount: ms,
    remainingCount: ms.optional(),
    effectiveIntervals: z
      .array(z.object({ startMs: ms, endMs: ms }).strict())
      .max(10000),
    startedAt: ms,
    completedAt: ms.optional(),
    reason: z
      .enum([
        "no_eligible",
        "max_rounds",
        "user_cancelled",
        "error",
        "interrupted",
      ])
      .optional(),
    errorCode: z.string().max(100).optional(),
    errorMessage: z.string().max(500).optional(),
  })
  .strict();
export type RepairRun = z.infer<typeof repairRunSchema>;
