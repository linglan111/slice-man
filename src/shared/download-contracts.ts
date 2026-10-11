import { z } from "zod";

export const onlineUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !!url.hostname &&
        !url.username &&
        !url.password &&
        !Array.from(value).some((character) => character.charCodeAt(0) <= 32)
      );
    } catch {
      return false;
    }
  }, "请输入不包含登录信息的 HTTP(S) 视频链接");
export const downloadSettingsSchema = z
  .object({
    quality: z
      .enum(["360p", "480p", "720p", "1080p", "1440p", "2160p", "best"])
      .default("1080p"),
    container: z.enum(["mp4", "mkv", "original"]).default("mp4"),
    videoCodec: z.enum(["original", "h264", "h265"]).default("original"),
    directory: z
      .string()
      .max(32768)
      .refine(
        (value) =>
          !Array.from(value).some((character) => character.charCodeAt(0) < 32),
        "下载目录包含无效字符",
      )
      .default(""),
    proxy: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return (
            ["http:", "https:", "socks5:", "socks5h:"].includes(url.protocol) &&
            !!url.hostname &&
            !url.username &&
            !url.password &&
            ["", "/"].includes(url.pathname) &&
            !url.search &&
            !url.hash &&
            !Array.from(value).some(
              (character) => character.charCodeAt(0) <= 32,
            )
          );
        } catch {
          return false;
        }
      }, "代理须为无账号密码的 HTTP(S)/SOCKS5 地址"),
  })
  .strict();
export type DownloadSettings = z.infer<typeof downloadSettingsSchema>;
export type DownloadSettingsInput = z.input<typeof downloadSettingsSchema>;
export const downloadStatusSchema = z
  .object({
    ready: z.boolean(),
    version: z.string(),
    denoVersion: z.string(),
    sizeBytes: z.number().int().positive(),
    settings: downloadSettingsSchema,
    defaultDirectory: z.string(),
    state: z.enum([
      "idle",
      "installing",
      "downloading",
      "converting",
      "importing",
      "succeeded",
      "failed",
      "cancelled",
    ]),
    progress: z.number().min(0).max(1),
    message: z.string(),
  })
  .strict();
export type DownloadStatus = z.infer<typeof downloadStatusSchema>;
