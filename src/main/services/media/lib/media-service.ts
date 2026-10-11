import { z } from "zod";
import {
  exportVideoOptionsSchema,
  type ExportVideoOptions,
} from "../../../../shared/export-contracts";
import { join, dirname, extname } from "node:path";
import {
  mkdir,
  writeFile,
  rename,
  rm,
  stat,
  copyFile,
  link,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { MediaPaths, MediaInfo } from "../types";
import { runProcess } from "../../../lib/process";
import { AppError, checkAbort } from "../../../lib/errors";
const streamSchema = z.object({
  codec_type: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  start_time: z.string().optional(),
  duration: z.string().optional(),
  sample_aspect_ratio: z.string().optional(),
  tags: z.object({ rotate: z.string().optional() }).optional(),
  side_data_list: z
    .array(z.object({ rotation: z.number().optional() }))
    .optional(),
});
function softwareProfile(
  codec: string,
  quality: "balanced" | "high" | "small",
): { encoder: string; args: string[] } {
  if (codec === "av1")
    return {
      encoder: "libaom-av1",
      args: [
        "-cpu-used",
        "6",
        "-crf",
        quality === "high" ? "26" : quality === "small" ? "38" : "32",
        "-b:v",
        "0",
        "-row-mt",
        "1",
      ],
    };
  if (codec === "vp9")
    return {
      encoder: "libvpx-vp9",
      args: [
        "-deadline",
        "good",
        "-cpu-used",
        "4",
        "-crf",
        quality === "high" ? "22" : quality === "small" ? "36" : "30",
        "-b:v",
        "0",
        "-row-mt",
        "1",
      ],
    };
  if (codec === "vp8")
    return {
      encoder: "libvpx",
      args: [
        "-deadline",
        "good",
        "-cpu-used",
        "4",
        "-crf",
        quality === "high" ? "10" : quality === "small" ? "25" : "18",
        "-b:v",
        "0",
      ],
    };
  return {
    encoder: codec === "hevc" ? "libx265" : "libx264",
    args: [
      "-preset",
      "medium",
      "-crf",
      codec === "hevc"
        ? quality === "high"
          ? "22"
          : quality === "small"
            ? "30"
            : "26"
        : quality === "high"
          ? "18"
          : quality === "small"
            ? "27"
            : "22",
      ...(codec === "hevc" ? ["-x265-params", "pools=2"] : []),
    ],
  };
}
export class MediaService {
  private readonly proxies = new Map<string, Promise<string>>();
  constructor(readonly paths: MediaPaths) {}
  private async encodingInfo(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ codec: string; formatNames: string[]; audioCodecs: string[] }> {
    const result = await runProcess(
      this.paths.ffprobe,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
      { signal },
    );
    const raw = z
      .object({
        streams: z.array(
          z.object({
            codec_type: z.string(),
            codec_name: z.string().optional(),
          }),
        ),
        format: z.object({ format_name: z.string() }),
      })
      .parse(JSON.parse(result.stdout));
    const video = raw.streams.find((stream) => stream.codec_type === "video");
    if (!video?.codec_name)
      throw new AppError(
        "MEDIA_CODEC",
        "无法读取源视频编码，请重新导入或选择其他视频。",
      );
    return {
      codec: video.codec_name,
      formatNames: raw.format.format_name.split(","),
      audioCodecs: raw.streams
        .filter((stream) => stream.codec_type === "audio")
        .map((stream) => stream.codec_name ?? "unknown"),
    };
  }
  async probe(path: string, signal?: AbortSignal): Promise<MediaInfo> {
    const result = await runProcess(
      this.paths.ffprobe,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
      { signal },
    );
    const raw = z
      .object({
        streams: z.array(streamSchema),
        format: z.object({
          duration: z.string().optional(),
          start_time: z.string().optional(),
        }),
      })
      .parse(JSON.parse(result.stdout));
    const video = raw.streams.find((s) => s.codec_type === "video");
    if (!video?.width || !video.height)
      throw new AppError("NO_VIDEO", "文件中没有可解码的视频");
    const durationMs = Math.round(
      Number(raw.format.duration ?? video.duration) * 1000,
    );
    if (!Number.isFinite(durationMs) || durationMs <= 0)
      throw new AppError("MEDIA_DURATION", "无法读取视频长度");
    const audio = raw.streams.find((s) => s.codec_type === "audio");
    const rotation = Number(
      video.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ??
        video.tags?.rotate ??
        0,
    );
    const isQuarter = Math.abs(rotation) % 180 === 90;
    const sar = video.sample_aspect_ratio ?? "1:1";
    const [num, den] = sar.split(":").map(Number);
    const displayWidth = Math.round(video.width * (num && den ? num / den : 1));
    return {
      durationMs,
      width: isQuarter ? video.height : displayWidth,
      height: isQuarter ? displayWidth : video.height,
      hasAudio: !!audio,
      audioOffsetMs: audio
        ? Math.round(
            (Number(audio.start_time ?? 0) -
              Number(raw.format.start_time ?? 0)) *
              1000,
          )
        : 0,
      rotation,
      sampleAspectRatio: sar,
    };
  }
  async extract(
    input: string,
    path: string,
    startMs: number,
    durationMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await runProcess(
      this.paths.ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        input,
        "-ss",
        (startMs / 1000).toFixed(3),
        "-t",
        (durationMs / 1000).toFixed(3),
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        path,
      ],
      { signal },
    );
  }
  async render(
    input: string,
    workspace: string,
    ass: string,
    media: MediaInfo,
    destination: string,
    quality: "balanced" | "high" | "small",
    signal?: AbortSignal,
    previewAtMs?: number,
    onProgress?: (value: number) => void,
    videoOptions?: ExportVideoOptions,
  ): Promise<void> {
    checkAbort(signal);
    const options =
      previewAtMs === undefined
        ? exportVideoOptionsSchema.parse(videoOptions ?? {})
        : {};
    let codec = options.videoCodec === "h265" ? "hevc" : "h264";
    if (previewAtMs === undefined && options.videoCodec === "original") {
      codec = (await this.encodingInfo(input, signal)).codec;
      if (!["h264", "hevc", "av1", "vp9", "vp8"].includes(codec))
        throw new AppError(
          "EXPORT_CODEC_UNSUPPORTED",
          "原视频编码暂不支持字幕烧录，请明确选择 H.264 或 H.265；不会自动替换编码。",
        );
    }
    const suffix = extname(destination);
    if (previewAtMs === undefined && codec === "vp8" && suffix === ".mp4")
      throw new AppError(
        "EXPORT_CONTAINER_UNSUPPORTED",
        "VP8 原编码无法写入 MP4，请选择 MKV 或明确选择 H.264/H.265；源文件已保留。",
      );
    const profile = softwareProfile(codec, quality);
    const encoder = profile.encoder;
    if (previewAtMs === undefined) {
      const available = await runProcess(
        this.paths.ffmpeg,
        ["-hide_banner", "-encoders"],
        { signal },
      );
      if (
        !new RegExp(`^\\s*V\\S*\\s+${encoder}\\s`, "m").test(available.stdout)
      )
        throw new AppError(
          "EXPORT_ENCODER_UNAVAILABLE",
          `媒体工具缺少 ${encoder} 软件编码器，请更新应用或选择其他编码。`,
        );
    }
    const cap =
      !options.resolution || options.resolution === "original"
        ? media.height
        : Number(options.resolution.replace("p", ""));
    const ratio = Math.min(1, cap / media.height);
    const width =
      previewAtMs === undefined
        ? Math.floor((media.width * ratio) / 2) * 2
        : media.width;
    const height =
      previewAtMs === undefined
        ? Math.floor((media.height * ratio) / 2) * 2
        : media.height;
    if (width < 2 || height < 2)
      throw new AppError(
        "EXPORT_DIMENSIONS",
        "视频尺寸过小，无法生成有效的导出视频。",
      );
    await mkdir(workspace, { recursive: true });
    const assName = `sub-${randomUUID()}.ass`;
    await writeFile(join(workspace, assName), ass, "utf8");
    const fontFolder = join(workspace, "fonts");
    await mkdir(fontFolder, { recursive: true });
    for (const name of ["NotoSansCJKsc-Regular.otf", "NotoSansCJKsc-Bold.otf"])
      await copyFile(join(this.paths.fonts, name), join(fontFolder, name));
    // Controlled relative filter paths avoid drive-letter and Unicode filter quoting entirely.
    // ASS retains the source display PlayRes. Libass maps those coordinates to
    // the proportionally scaled output, including sizes, margins and outlines.
    const originalSize =
      width !== media.width || height !== media.height
        ? `:original_size=${media.width}x${media.height}`
        : "";
    const filter = `scale=${width}:${height},setsar=1,subtitles=${assName}:fontsdir=fonts${originalSize}`;
    const temporary = join(
      dirname(destination),
      `.slice-${randomUUID()}${suffix}`,
    );
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-vf",
      filter,
    ];
    if (previewAtMs !== undefined)
      args.push(
        "-ss",
        (previewAtMs / 1000).toFixed(3),
        "-frames:v",
        "1",
        "-update",
        "1",
      );
    else
      args.push(
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        encoder,
        ...profile.args,
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        ...(suffix === ".mp4"
          ? [
              "-movflags",
              "+faststart",
              ...(codec === "hevc" ? ["-tag:v", "hvc1"] : []),
            ]
          : []),
        "-progress",
        "pipe:2",
      );
    args.push(temporary);
    const callbackController = new AbortController();
    const processSignal = signal
      ? AbortSignal.any([signal, callbackController.signal])
      : callbackController.signal;
    let progressError: unknown;
    let pendingProgress = "";
    let lastProgress = 0;
    try {
      try {
        await runProcess(this.paths.ffmpeg, args, {
          cwd: workspace,
          signal: processSignal,
          onStderr: (text) => {
            pendingProgress = (pendingProgress + text).slice(-8192);
            const lines = pendingProgress.split(/\r?\n/);
            pendingProgress = lines.pop() ?? "";
            for (const line of lines) {
              const match = /^out_time_us=(\d+)$/.exec(line);
              if (!match?.[1]) continue;
              lastProgress = Math.max(
                lastProgress,
                Math.min(0.99, Number(match[1]) / 1000 / media.durationMs),
              );
              try {
                onProgress?.(lastProgress);
              } catch (error) {
                progressError = error;
                callbackController.abort();
              }
            }
          },
        });
      } catch (error) {
        if (progressError)
          throw new AppError(
            "EXPORT_PROGRESS",
            "导出进度更新失败，已停止编码；请重试。",
          );
        throw error;
      }
      checkAbort(signal);
      const size = await stat(temporary);
      if (size.size === 0) throw new AppError("EMPTY_OUTPUT", "导出文件为空");
      if (previewAtMs === undefined) {
        const output = await this.probe(temporary, signal);
        const properties = await this.encodingInfo(temporary, signal);
        const isContainerValid =
          suffix === ".mp4"
            ? properties.formatNames.includes("mp4")
            : suffix === ".mkv" && properties.formatNames.includes("matroska");
        if (
          !isContainerValid ||
          properties.codec !== codec ||
          output.width !== width ||
          output.height !== height ||
          output.hasAudio !== media.hasAudio ||
          properties.audioCodecs.some((audioCodec) => audioCodec !== "aac") ||
          Math.abs(output.durationMs - media.durationMs) >
            Math.max(250, Math.min(1000, media.durationMs * 0.01))
        )
          throw new AppError(
            "OUTPUT_VALIDATION",
            "导出视频的容器、编码、尺寸或时长校验失败；未发布输出。",
          );
        const decoded = await runProcess(
          this.paths.ffmpeg,
          [
            "-v",
            "error",
            "-nostdin",
            "-i",
            temporary,
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-progress",
            "pipe:1",
            "-nostats",
            "-f",
            "null",
            "-",
          ],
          { signal },
        );
        if (!/^frame=[1-9]\d*$/m.test(decoded.stdout))
          throw new AppError(
            "OUTPUT_VALIDATION",
            "导出视频无法解码；未发布输出。",
          );
      }
      checkAbort(signal);
      await publish(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
      await rm(join(workspace, assName), { force: true });
    }
  }
  async proxy(
    input: string,
    workspace: string,
    media: MediaInfo,
    signal?: AbortSignal,
  ): Promise<string> {
    const existing = this.proxies.get(workspace);
    if (existing) return existing;
    const pending = this.generateProxy(input, workspace, media, signal);
    this.proxies.set(workspace, pending);
    try {
      return await pending;
    } finally {
      this.proxies.delete(workspace);
    }
  }
  private async generateProxy(
    input: string,
    workspace: string,
    media: MediaInfo,
    signal?: AbortSignal,
  ): Promise<string> {
    await mkdir(workspace, { recursive: true });
    const path = join(workspace, "playback.mp4");
    try {
      await stat(path);
      return path;
    } catch {
      /* Missing proxy is generated below. */
    }
    const temporary = join(workspace, "playback.partial.mp4");
    try {
      await runProcess(
        this.paths.ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          input,
          "-map",
          "0:v:0",
          "-map",
          "0:a?",
          "-vf",
          `scale=${media.width}:${media.height},setsar=1`,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "25",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-movflags",
          "+faststart",
          temporary,
        ],
        { signal },
      );
      checkAbort(signal);
      await rename(temporary, path);
      return path;
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
export async function publish(
  temporary: string,
  destination: string,
): Promise<void> {
  // Atomic no-clobber publication: a competing destination is never replaced.
  // Both paths are adjacent on the same volume; NTFS supports hard links.
  try {
    await link(temporary, destination);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new AppError(
        "DESTINATION_EXISTS",
        "目标已存在，请选择一个新文件名。",
      );
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EPERM"].includes(
        String(error.code),
      )
    )
      throw new AppError(
        "DESTINATION_UNSUPPORTED",
        "目标目录不支持安全发布文件，请选择本地 NTFS 磁盘目录。",
      );
    if (error instanceof Error && "code" in error && error.code === "EACCES")
      throw new AppError(
        "DESTINATION_PERMISSION",
        "无法写入目标目录，请选择有写入权限的目录。",
      );
    throw error;
  }
  await rm(temporary, { force: true });
}
