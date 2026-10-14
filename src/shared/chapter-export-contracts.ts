import { z } from 'zod';
import { chapterCriterionSnapshotSchema } from './chapter-contracts';
import { exportQualitySchema, exportVideoCodecSchema, exportResolutionSchema } from './export-contracts';

const id = z.string().min(1).max(100);
const revision = z.number().int().nonnegative();
export const chapterCriterionSchema = chapterCriterionSnapshotSchema.extend({ createdAt: revision, updatedAt: revision });
export type ChapterCriterion = z.infer<typeof chapterCriterionSchema>;
export const criterionLibrarySchema = z.object({ items: z.array(chapterCriterionSchema).max(100), selectedId: id.optional() }).strict();
export type CriterionLibrary = z.infer<typeof criterionLibrarySchema>;
export const saveCriterionInputSchema = z.object({ id: id.optional(), revision: z.number().int().positive().optional(), name: z.string().trim().min(1).max(120), instructions: z.string().trim().min(1).max(8000) }).strict();
export type SaveCriterionInput = z.infer<typeof saveCriterionInputSchema>;
export const criterionIdentitySchema = z.object({ id, revision: z.number().int().positive() }).strict();
export type CriterionIdentity = z.infer<typeof criterionIdentitySchema>;
export const selectCriterionInputSchema = z.object({ id: id.optional() }).strict();
export const chapterExportInputSchema = z.object({
  jobId: id, revision, planId: id, planRevision: revision, chapterIds: z.array(id).min(1).max(500),
  format: z.enum(['mp4', 'mkv', 'srt', 'ass', 'vtt']), quality: exportQualitySchema.optional(),
  videoCodec: exportVideoCodecSchema.optional(), resolution: exportResolutionSchema.optional(), runId: id.optional(),
}).strict().refine((input) => new Set(input.chapterIds).size === input.chapterIds.length, '章节选择不能重复');
export type ChapterExportInput = z.infer<typeof chapterExportInputSchema>;
export const chapterExportRunSchema = z.object({
  version: z.literal(1), id, jobId: id, planId: id, planRevision: revision, identity: z.string().length(64),
  input: chapterExportInputSchema.optional(),
  state: z.enum(['running', 'complete', 'failed', 'cancelled', 'interrupted']), startedAt: revision, endedAt: revision.optional(),
  clips: z.array(z.object({ chapterId: id, title: z.string().max(120), state: z.enum(['pending', 'running', 'complete', 'failed']), path: z.string().max(32768).optional(), sha256: z.string().length(64).optional(), code: z.string().max(100).optional() }).strict()).min(1).max(500),
}).strict();
export type ChapterExportRun = z.infer<typeof chapterExportRunSchema>;
