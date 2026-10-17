import { z } from "zod";
import { aiWorkProgressSchema } from "./ai-work-contracts";
import { providerDiagnosticSchema, providerLiveSnapshotSchema } from './provider-diagnostics-contracts';
import { criterionLibrarySchema, chapterExportRunSchema } from './chapter-export-contracts';
import { artifactCacheSummarySchema } from "./artifact-cache-contracts";
import { exportSettingsSchema } from "./export-contracts";
import { downloadStatusSchema } from "./download-contracts";
import {
  jobSchema,
  reprocessPlanSchema,
  profileSchema,
  type ProgressEvent,
  type RuntimeStatus,
} from "./contracts";
export const runtimeStatusSchema: z.ZodType<RuntimeStatus> = z
  .object({
    downloadCache: artifactCacheSummarySchema.optional(),
    installed: z.boolean(),
    cpuReady: z.boolean(),
    gpuReady: z.boolean(),
    actualBackend: z.enum(["cpu", "gpu", "unavailable"]),
    message: z.string(),
    installedModels: z.array(z.string()),
    gpuName: z.string().optional(),
    totalMemoryGb: z.number().nonnegative(),
    catalog: z.array(
      z
        .object({
          id: z.enum(["base", "small", "large-v3-turbo"]),
          name: z.string(),
          sizeBytes: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();
export const progressSchema: z.ZodType<ProgressEvent> = z
  .object({
    jobId: z.string().optional(),
    stage: z.enum([
      "recognize",
      "translate",
      "style",
      "preview",
      "export",
      "install",
      "review",
      "repair",
      "names",
      "chapters",
    ]),
    progress: z.number().min(0).max(1),
    message: z.string(),
    job: jobSchema.optional(),
    repairRunId: z.string().min(1).max(100).optional(),
    work: aiWorkProgressSchema.optional(),
  })
  .strict();
const outputSchemas: Record<string, z.ZodType> = {
  "diagnostics:live": z.array(providerLiveSnapshotSchema).max(128),
  "diagnostics:list": z.array(providerDiagnosticSchema).max(100),
  "diagnostics:detail": providerDiagnosticSchema,
  "diagnostics:readAnswer": z.object({ text: z.string().max(20000), truncated: z.boolean() }).strict(),
  "diagnostics:clear": z.undefined(),
  "chapterCriteria:list": criterionLibrarySchema,
  "chapterCriteria:save": criterionLibrarySchema,
  "chapterCriteria:copy": criterionLibrarySchema,
  "chapterCriteria:remove": criterionLibrarySchema,
  "chapterCriteria:select": criterionLibrarySchema,
  "chapterExports:export": chapterExportRunSchema.nullable(),
  "chapterExports:list": z.array(chapterExportRunSchema).max(100),
  "exportSettings:status": exportSettingsSchema,
  "exportSettings:saveSettings": exportSettingsSchema,
  "exportSettings:chooseDirectory": exportSettingsSchema.nullable(),
  "download:status": downloadStatusSchema,
  "download:saveSettings": downloadStatusSchema,
  "download:chooseDirectory": downloadStatusSchema.nullable(),
  "download:install": downloadStatusSchema,
  "download:importUrl": jobSchema,
  "download:cancel": z.undefined(),
  "download:clearDownloadCache": downloadStatusSchema,
  "profiles:list": z.array(profileSchema),
  "profiles:save": profileSchema,
  "profiles:remove": z.undefined(),
  "profiles:test": z.object({ message: z.string() }).strict(),
  "runtime:status": runtimeStatusSchema,
  "runtime:install": runtimeStatusSchema,
  "runtime:cancel": z.undefined(),
  "runtime:clearDownloadCache": runtimeStatusSchema,
  "jobs:list": z.array(jobSchema),
  "jobs:get": jobSchema,
  "jobs:importVideo": jobSchema.nullable(),
  "jobs:planChapters": jobSchema,
  "jobs:updateChapters": jobSchema,
  "jobs:updateOptions": jobSchema,
  "jobs:recognize": jobSchema,
  "jobs:recognizeAgain": jobSchema,
  "jobs:translate": jobSchema,
  "jobs:planReprocess": reprocessPlanSchema,
  "jobs:recognizePartial": jobSchema,
  "jobs:translatePartial": jobSchema,
  "jobs:reviewSubtitles": jobSchema,
  "jobs:analyzeNames": jobSchema,
  "jobs:applyNames": jobSchema,
  "jobs:undoNames": jobSchema,
  "jobs:repairLoop": jobSchema,
  "jobs:acknowledgeFinding": jobSchema,
  "jobs:editSegment": jobSchema,
  "jobs:addSegment": jobSchema,
  "jobs:removeSegment": jobSchema,
  "jobs:setStyle": jobSchema,
  "jobs:designStyle": jobSchema,
  "jobs:preview": z.object({ url: z.string(), job: jobSchema }).strict(),
  "jobs:playback": z.object({ url: z.string() }).strict(),
  "jobs:export": z.object({ path: z.string() }).strict().nullable(),
  "jobs:cancel": z.undefined(),
};
export function resultSchema(channel: string): z.ZodType {
  const output = outputSchemas[channel];
  if (!output) throw new Error("Unknown IPC channel");
  return z.discriminatedUnion("success", [
    z.object({ success: z.literal(true), data: output }).strict(),
    z
      .object({
        success: z.literal(false),
        error: z.string(),
        code: z.string(),
      })
      .strict(),
  ]);
}
