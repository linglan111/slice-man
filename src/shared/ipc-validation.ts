import { z } from "zod";
import { exportSettingsSchema } from "./export-contracts";
import { downloadStatusSchema } from "./download-contracts";
import {
  jobSchema,
  profileSchema,
  type ProgressEvent,
  type RuntimeStatus,
} from "./contracts";
export const runtimeStatusSchema: z.ZodType<RuntimeStatus> = z
  .object({
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
    ]),
    progress: z.number().min(0).max(1),
    message: z.string(),
    job: jobSchema.optional(),
  })
  .strict();
const outputSchemas: Record<string, z.ZodType> = {
  "exportSettings:status": exportSettingsSchema,
  "exportSettings:saveSettings": exportSettingsSchema,
  "exportSettings:chooseDirectory": exportSettingsSchema.nullable(),
  "download:status": downloadStatusSchema,
  "download:saveSettings": downloadStatusSchema,
  "download:chooseDirectory": downloadStatusSchema.nullable(),
  "download:install": downloadStatusSchema,
  "download:importUrl": jobSchema,
  "download:cancel": z.undefined(),
  "profiles:list": z.array(profileSchema),
  "profiles:save": profileSchema,
  "profiles:remove": z.undefined(),
  "profiles:test": z.object({ message: z.string() }).strict(),
  "runtime:status": runtimeStatusSchema,
  "runtime:install": runtimeStatusSchema,
  "runtime:cancel": z.undefined(),
  "jobs:list": z.array(jobSchema),
  "jobs:get": jobSchema,
  "jobs:importVideo": jobSchema.nullable(),
  "jobs:updateOptions": jobSchema,
  "jobs:recognize": jobSchema,
  "jobs:recognizeAgain": jobSchema,
  "jobs:translate": jobSchema,
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
