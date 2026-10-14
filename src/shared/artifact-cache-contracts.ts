import { z } from "zod";

export const managedArtifactIdSchema = z.enum([
  "model-base", "model-small", "model-large-v3-turbo", "whisper-cpu",
  "whisper-gpu", "yt-dlp", "deno",
]);
export type ManagedArtifactId = z.infer<typeof managedArtifactIdSchema>;
export const artifactCacheSummarySchema = z.object({
  assets: z.array(z.object({
    id: managedArtifactIdSchema,
    name: z.string().min(1).max(120),
    downloadedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().positive(),
    state: z.enum(["partial", "verified"]),
    resumable: z.boolean(),
  }).strict()).max(100),
  totalBytes: z.number().int().nonnegative(),
}).strict();
export type ArtifactCacheSummary = z.infer<typeof artifactCacheSummarySchema>;
