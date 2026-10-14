import { z } from "zod";

export const MAX_CHAPTER_MS = 1_200_000;
export const CHAPTER_REVIEW_THRESHOLD_MS = 1_800_000;
const id = z.string().min(1).max(100);
const ms = z.number().int().nonnegative();
export const chapterSchema = z
  .object({
    id,
    startMs: ms,
    endMs: ms,
    title: z.string().trim().min(1).max(120),
    summary: z.string().max(1000),
  })
  .strict()
  .refine(
    (chapter) =>
      chapter.endMs > chapter.startMs &&
      chapter.endMs - chapter.startMs <= MAX_CHAPTER_MS,
    "章节时长须大于零且不超过 20 分钟",
  );
export type Chapter = z.infer<typeof chapterSchema>;
export const chapterCriterionSnapshotSchema = z
  .object({
    id,
    revision: z.number().int().positive(),
    name: z.string().min(1).max(120),
    instructions: z.string().min(1).max(8000),
  })
  .strict();
export type ChapterCriterionSnapshot = z.infer<
  typeof chapterCriterionSnapshotSchema
>;
export const chapterPlanSchema = z
  .object({
    version: z.literal(1),
    id,
    revision: ms,
    kind: z.enum(["normal", "custom"]),
    sourceFingerprint: z.string().min(1).max(200),
    profileId: id.optional(),
    providerFingerprint: z.string().max(1000).optional(),
    createdAt: ms,
    state: z.enum(["current", "stale"]),
    chapters: z.array(chapterSchema).max(500),
    criterion: chapterCriterionSnapshotSchema.optional(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (
      plan.kind === "normal" &&
      (plan.chapters.length === 0 || plan.criterion)
    )
      context.addIssue({
        code: "custom",
        message: "普通章节需要完整覆盖且不能包含自定义标准",
      });
    if (plan.kind === "custom" && !plan.criterion)
      context.addIssue({ code: "custom", message: "自定义章节需要标准快照" });
    const ids = new Set<string>();
    let end = 0;
    for (const chapter of plan.chapters) {
      if (
        ids.has(chapter.id) ||
        chapter.startMs < end ||
        (plan.kind === "normal" && chapter.startMs !== end)
      )
        context.addIssue({
          code: "custom",
          message: "章节重复、重叠或普通章节存在空缺",
        });
      ids.add(chapter.id);
      end = chapter.endMs;
    }
  });
export type ChapterPlan = z.infer<typeof chapterPlanSchema>;
export const planChaptersInputSchema = z
  .object({
    jobId: id,
    revision: ms,
    kind: z.enum(["normal", "custom"]),
    profileId: id.optional(),
    criterionId: id.optional(),
  })
  .strict();
export type PlanChaptersInput = z.infer<typeof planChaptersInputSchema>;
export const updateChaptersInputSchema = z
  .object({
    jobId: id,
    revision: ms,
    planId: id,
    planRevision: ms,
    chapters: z.array(chapterSchema).max(500),
  })
  .strict();
export type UpdateChaptersInput = z.infer<typeof updateChaptersInputSchema>;
export const chapterReviewRunSchema = z
  .object({
    version: z.literal(1),
    id,
    planId: id,
    planRevision: ms,
    sourceFingerprint: z.string().min(1),
    timelineFingerprint: z.string().min(1),
    profileId: id,
    providerFingerprint: z.string(),
    rubricVersion: z.string(),
    translationEnabled: z.boolean(),
    targetIds: z.array(id).min(1).max(10000),
    chapters: z
      .array(
        z
          .object({
            chapterId: id,
            targetIds: z.array(id).min(1).max(10000),
            state: z.enum(["pending", "running", "completed", "failed"]),
            code: z.string().max(100).optional(),
          })
          .strict(),
      )
      .max(500),
    state: z.enum([
      "running",
      "complete",
      "failed",
      "cancelled",
      "interrupted",
      "stale",
    ]),
    startedAt: ms,
    completedAt: ms.optional(),
  })
  .strict()
  .superRefine((run, context) => {
    const targets = new Set(run.targetIds);
    const owners = new Set<string>();
    const chapters = new Set<string>();
    if (targets.size !== run.targetIds.length)
      context.addIssue({ code: "custom", message: "检查目标重复" });
    for (const chapter of run.chapters) {
      if (chapters.has(chapter.chapterId))
        context.addIssue({ code: "custom", message: "检查章节重复" });
      chapters.add(chapter.chapterId);
      for (const id of chapter.targetIds) {
        if (!targets.has(id) || owners.has(id))
          context.addIssue({ code: "custom", message: "检查目标归属无效" });
        owners.add(id);
      }
    }
    if (
      owners.size !== targets.size ||
      (run.state === "complete" &&
        run.chapters.some((chapter) => chapter.state !== "completed"))
    )
      context.addIssue({ code: "custom", message: "检查覆盖未完成" });
  });
export type ChapterReviewRun = z.infer<typeof chapterReviewRunSchema>;
