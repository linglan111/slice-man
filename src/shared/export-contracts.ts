import { z } from "zod";

export const exportVideoCodecSchema = z.enum(["original", "h264", "h265"]);
export const exportResolutionSchema = z.enum([
  "original",
  "360p",
  "480p",
  "720p",
  "1080p",
  "1440p",
  "2160p",
]);
export const exportQualitySchema = z.enum(["balanced", "high", "small"]);
export const exportSettingsSchema = z
  .object({
    directory: z
      .string()
      .min(1)
      .max(32768)
      .refine(
        (value) =>
          /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/)/i.test(value) &&
          !Array.from(value).some((character) => character.charCodeAt(0) < 32),
        "请选择有效的绝对导出目录",
      ),
    videoFormat: z.enum(["mp4", "mkv"]),
    videoCodec: exportVideoCodecSchema,
    resolution: exportResolutionSchema,
    quality: exportQualitySchema,
    subtitleFormat: z.enum(["srt", "ass", "vtt"]),
  })
  .strict();
export const exportVideoOptionsSchema = z
  .object({
    videoCodec: exportVideoCodecSchema.optional(),
    resolution: exportResolutionSchema.optional(),
  })
  .strict();
export type ExportSettings = z.infer<typeof exportSettingsSchema>;
export type ExportSettingsInput = z.input<typeof exportSettingsSchema>;
export type ExportVideoOptions = z.infer<typeof exportVideoOptionsSchema>;
