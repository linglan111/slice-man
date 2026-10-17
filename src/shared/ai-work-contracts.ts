import { z } from "zod";

const count = z.number().int().nonnegative();
export const aiWorkRequestSchema = z.object({
  id: z.string().min(1).max(200),
  chapterId: z.string().max(100).optional(),
  label: z.string().max(200),
  state: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  targetCount: count,
  startedAt: count.optional(),
  endedAt: count.optional(),
  code: z.string().max(100).optional(),
}).strict();
export const aiWorkProgressSchema = z.object({
  runId: z.string().min(1).max(100),
  operation: z.string().min(1).max(100),
  phase: z.string().min(1).max(100),
  round: count.max(20).optional(),
  maxRounds: count.max(20).optional(),
  startedAt: count,
  targetsCompleted: count,
  targetsTotal: count,
  chaptersCompleted: count,
  chaptersTotal: count,
  requests: z.array(aiWorkRequestSchema).max(500),
}).strict();
export type AiWorkProgress = z.infer<typeof aiWorkProgressSchema>;
export type AiWorkRequest = z.infer<typeof aiWorkRequestSchema>;
