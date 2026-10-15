import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const time = count;
export const textOperationSchema = z.enum(["review", "names", "translate", "chapters", "style"]);
export const diagnosticStateSchema = z.enum(["waiting", "receiving", "transport_complete", "validated", "published", "failed", "cancelled", "interrupted"]);
export const providerUsageSchema = z.object({
  inputTokens: count.optional(), outputTokens: count.optional(), totalTokens: count.optional(),
  cachedTokens: count.optional(), reasoningTokens: count.optional(),
}).strict();
export const providerDiagnosticSchema = z.object({
  id: z.string().uuid(), runId: z.string().max(100), jobId: z.string().max(100).optional(),
  chapterId: z.string().max(100).optional(), operation: textOperationSchema,
  profileId: z.string().max(100), model: z.string().max(200),
  protocol: z.enum(["openai", "anthropic", "gemini"]), mode: z.enum(["chat", "responses"]),
  state: diagnosticStateSchema, attempt: count, targetCount: count, promptBytes: count,
  streamRequested: z.boolean(), streamActual: z.boolean().optional(),
  timeoutMs: count, textTimeoutMs: count, startedAt: time,
  headersAt: time.optional(), firstByteAt: time.optional(), firstAnswerAt: time.optional(),
  lastByteAt: time.optional(), endedAt: time.optional(), elapsedMs: count,
  wireBytes: count, textBytes: count, events: count, heartbeats: count,
  httpStatus: z.number().int().min(100).max(599).optional(),
  finishReason: z.string().regex(/^[a-zA-Z0-9_:-]{1,80}$/).optional(),
  errorCode: z.string().regex(/^[A-Z0-9_]{1,80}$/).optional(),
  errorPhase: z.enum(["headers", "idle", "overall", "protocol", "storage", "cancel", "network", "http", "validation"]).optional(),
  usage: providerUsageSchema.optional(), artifact: z.string().regex(/^[0-9a-f-]{36}\/answer\.(partial|complete)\.txt$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict().superRefine((record, ctx) => {
  if (!record.artifact.startsWith(`${record.id}/`)) ctx.addIssue({ code: "custom", path: ["artifact"], message: "Diagnostic artifact must belong to its request" });
});
export type ProviderDiagnostic = z.infer<typeof providerDiagnosticSchema>;
export type ProviderUsage = z.infer<typeof providerUsageSchema>;
export type TextOperation = z.infer<typeof textOperationSchema>;
export const diagnosticsListInputSchema = z.object({
  jobId: z.string().min(1).max(100).optional(), before: time.optional(), beforeId: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).default(50),
}).strict().refine((input) => input.beforeId === undefined || input.before !== undefined, 'A cursor ID requires its timestamp');
export type DiagnosticsListInput = z.input<typeof diagnosticsListInputSchema>;

/** Live provider content is session memory only, deliberately separate from persisted diagnostics. */
export const diagnosticsLiveInputSchema = z.object({
  jobId: z.string().min(1).max(100).optional(), requestId: z.string().uuid().optional(),
}).strict();
export type DiagnosticsLiveInput = z.infer<typeof diagnosticsLiveInputSchema>;
export const providerLiveSnapshotSchema = z.object({
  requestId: z.string().uuid(), jobId: z.string().max(100).optional(), operation: textOperationSchema,
  model: z.string().max(200), state: diagnosticStateSchema,
  phase: z.enum(["waiting", "thinking", "answer", "complete", "failed", "cancelled"]),
  startedAt: time, updatedAt: time, elapsedMs: count, wireBytes: count, answerBytes: count,
  thinkingText: z.string().max(32000), answerText: z.string().max(32000),
  thinkingTruncated: z.boolean(), answerTruncated: z.boolean(),
}).strict();
export type ProviderLiveSnapshot = z.infer<typeof providerLiveSnapshotSchema>;
