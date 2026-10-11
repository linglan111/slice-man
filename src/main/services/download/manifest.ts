import { z } from "zod";
export const downloadArtifactsSchema = z
  .object({
    version: z.string().regex(/^[\w.-]{1,80}$/),
    denoVersion: z.string().regex(/^[\w.-]{1,80}$/),
    ytdlp: z
      .object({
        url: z.url(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        sizeBytes: z.number().int().positive(),
      })
      .strict(),
    deno: z
      .object({
        url: z.url(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        sizeBytes: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type DownloadArtifacts = z.infer<typeof downloadArtifactsSchema>;
export const DOWNLOAD_ARTIFACTS: DownloadArtifacts = {
  version: "2026.08.19",
  denoVersion: "2.9.7",
  ytdlp: {
    url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe",
    sizeBytes: 17840399,
    sha256: "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a",
  },
  deno: {
    url: "https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-pc-windows-msvc.zip",
    sizeBytes: 42630221,
    sha256: "a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238",
  },
};
