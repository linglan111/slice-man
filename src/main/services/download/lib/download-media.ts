import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdir, rm, stat } from "node:fs/promises";
import { z } from "zod";
import { AppError, checkAbort } from "../../../lib/errors";
import { runProcess } from "../../../lib/process";
import { runDownloadProcess } from "./download-process";

export type NormalizeDownloadInput = {
  input: string;
  workingDirectory: string;
  container: "mp4" | "mkv" | "original";
  videoCodec: "original" | "h264" | "h265";
  maxHeight?: number;
  signal: AbortSignal;
  ffmpeg: string;
  ffprobe: string;
  onProgress: (ratio: number) => void;
};
const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().min(1),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      sample_aspect_ratio: z.string().optional(),
      tags: z.object({ rotate: z.string().optional() }).optional(),
      side_data_list: z
        .array(z.object({ rotation: z.number().finite().optional() }))
        .optional(),
    }),
  ),
  format: z.object({
    format_name: z.string().min(1),
    duration: z.string(),
    tags: z.object({ major_brand: z.string().optional() }).optional(),
  }),
});
type DownloadProbe = {
  codec: string;
  width: number;
  height: number;
  codedWidth: number;
  codedHeight: number;
  durationMs: number;
  formatNames: string[];
  majorBrand?: string;
  audioCodecs: string[];
};
async function probe(
  input: NormalizeDownloadInput,
  path: string,
): Promise<DownloadProbe> {
  checkAbort(input.signal);
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) throw new Error("Empty media");
    const result = await runProcess(
      input.ffprobe,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
      { signal: input.signal },
    );
    const raw = probeSchema.parse(JSON.parse(result.stdout));
    const video = raw.streams.find((stream) => stream.codec_type === "video");
    if (!video?.width || !video.height) throw new Error("No video");
    const durationMs = Number(raw.format.duration) * 1000;
    if (!Number.isFinite(durationMs) || durationMs <= 0)
      throw new Error("Invalid duration");
    const [numerator, denominator] = (video.sample_aspect_ratio ?? "1:1")
      .split(":")
      .map(Number);
    const sar = numerator && denominator ? numerator / denominator : 1;
    if (!Number.isFinite(sar) || sar <= 0)
      throw new Error("Invalid aspect ratio");
    const rotation = Number(
      video.side_data_list?.find((side) => side.rotation !== undefined)
        ?.rotation ??
        video.tags?.rotate ??
        0,
    );
    if (!Number.isFinite(rotation)) throw new Error("Invalid rotation");
    const isQuarterTurn = Math.abs(rotation) % 180 === 90;
    // A successful probe alone does not prove that a video frame is decodable.
    const decoded = await runProcess(
      input.ffmpeg,
      [
        "-v",
        "error",
        "-nostdin",
        "-i",
        path,
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
      { signal: input.signal },
    );
    if (!/^frame=[1-9]\d*$/m.test(decoded.stdout))
      throw new Error("No decoded frame");
    checkAbort(input.signal);
    return {
      codec: video.codec_name,
      codedWidth: video.width,
      codedHeight: video.height,
      width: isQuarterTurn ? video.height : video.width * sar,
      height: isQuarterTurn ? video.width * sar : video.height,
      durationMs,
      formatNames: raw.format.format_name.split(","),
      majorBrand: raw.format.tags?.major_brand,
      audioCodecs: raw.streams
        .filter((stream) => stream.codec_type === "audio")
        .map((stream) => stream.codec_name),
    };
  } catch (error) {
    checkAbort(input.signal);
    if (
      error instanceof AppError &&
      ["PROCESS_START", "PROCESS_TIMEOUT"].includes(error.code)
    )
      throw error;
    throw new AppError(
      "DOWNLOAD_MEDIA_INVALID",
      "下载的视频无效或无法解码，请检查源视频或重新下载。",
    );
  }
}

export async function normalizeDownload(
  input: NormalizeDownloadInput,
): Promise<string> {
  checkAbort(input.signal);
  if (
    !["mp4", "mkv", "original"].includes(input.container) ||
    !["original", "h264", "h265"].includes(input.videoCodec) ||
    (input.maxHeight !== undefined &&
      (!Number.isInteger(input.maxHeight) ||
        input.maxHeight < 2 ||
        input.maxHeight > 2160))
  )
    throw new AppError(
      "DOWNLOAD_MEDIA_OPTIONS",
      "下载容器、编码或分辨率参数无效。",
    );
  const source = await probe(input, input.input);
  if (
    input.videoCodec === "original" &&
    input.maxHeight !== undefined &&
    source.height > input.maxHeight
  )
    throw new AppError(
      "DOWNLOAD_RESOLUTION",
      "源视频超过所选分辨率；请选更高分辨率或 H.264/H.265 编码后缩小，原编码不会自动转码。",
    );
  if (input.container === "original" && input.videoCodec === "original") {
    input.onProgress(1);
    checkAbort(input.signal);
    return input.input;
  }
  const container = input.container === "original" ? "mkv" : input.container;
  const targetCodec = input.videoCodec === "h265" ? "hevc" : input.videoCodec;
  const ratio = Math.min(1, (input.maxHeight ?? source.height) / source.height);
  const width = Math.floor((source.width * ratio) / 2) * 2;
  const height = Math.floor((source.height * ratio) / 2) * 2;
  const needsEncoding =
    input.videoCodec !== "original" &&
    (source.codec !== targetCodec ||
      ratio < 1 ||
      source.codedWidth % 2 !== 0 ||
      source.codedHeight % 2 !== 0);
  if (needsEncoding && (width < 2 || height < 2))
    throw new AppError(
      "DOWNLOAD_RESOLUTION",
      "视频尺寸过小，无法按所选编码生成有效视频。",
    );
  const encoder = input.videoCodec === "h265" ? "libx265" : "libx264";
  if (needsEncoding) {
    const available = await runProcess(
      input.ffmpeg,
      ["-hide_banner", "-encoders"],
      { signal: input.signal },
    );
    if (!new RegExp(`^\\s*V\\S*\\s+${encoder}\\s`, "m").test(available.stdout))
      throw new AppError(
        "DOWNLOAD_ENCODER_UNAVAILABLE",
        `媒体工具缺少 ${encoder} 软件编码器，请更新应用或选择原编码。`,
      );
  }
  checkAbort(input.signal);
  await mkdir(input.workingDirectory, { recursive: true });
  const output = join(
    input.workingDirectory,
    `normalized-${randomUUID()}.${container}`,
  );
  // A unique name and -n prevent an operation from replacing existing media.
  if (resolve(output) === resolve(input.input))
    throw new AppError("DOWNLOAD_PATH", "转换输出不能覆盖源视频。");
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-n",
    "-i",
    input.input,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
  ];
  if (needsEncoding)
    args.push(
      "-c:v",
      encoder,
      "-preset",
      "medium",
      "-crf",
      input.videoCodec === "h265" ? "26" : "22",
      "-threads",
      "2",
      ...(input.videoCodec === "h265" ? ["-x265-params", "pools=2"] : []),
      "-pix_fmt",
      "yuv420p",
      "-vf",
      `scale=${width}:${height},setsar=1`,
    );
  else args.push("-c:v", "copy");
  const transcodeAudio = input.videoCodec !== "original" && container === "mp4";
  args.push(
    "-c:a",
    transcodeAudio ? "aac" : "copy",
    ...(transcodeAudio ? ["-b:a", "192k"] : []),
    ...(container === "mp4"
      ? [
          "-movflags",
          "+faststart",
          ...(targetCodec === "hevc" ? ["-tag:v", "hvc1"] : []),
        ]
      : []),
    "-progress",
    "pipe:1",
    "-nostats",
    "-f",
    container === "mp4" ? "mp4" : "matroska",
    output,
  );
  let lastProgress = 0;
  input.onProgress(0);
  try {
    try {
      await runDownloadProcess(input.ffmpeg, args, {
        cwd: input.workingDirectory,
        signal: input.signal,
        onLine: (line) => {
          const match = /^out_time_us=(\d+)$/.exec(line);
          if (!match?.[1]) return;
          lastProgress = Math.max(
            lastProgress,
            Math.min(0.99, Number(match[1]) / 1000 / source.durationMs),
          );
          input.onProgress(lastProgress);
        },
      });
    } catch (error) {
      checkAbort(input.signal);
      if (
        error instanceof AppError &&
        ["PROCESS_START", "DOWNLOAD_TIMEOUT"].includes(error.code)
      )
        throw error;
      throw new AppError(
        input.videoCodec === "original"
          ? "DOWNLOAD_CONTAINER_INCOMPATIBLE"
          : "DOWNLOAD_CONVERSION_FAILED",
        input.videoCodec === "original"
          ? "原视频或音频编码无法重封装为所选格式；请尝试 MKV 或明确选择 H.264/H.265 编码。"
          : "视频转换失败，请尝试 MKV、其他编码或原格式；源文件已保留。",
      );
    }
    checkAbort(input.signal);
    const result = await probe(input, output);
    const isContainerValid =
      container === "mp4"
        ? result.formatNames.includes("mp4") &&
          result.majorBrand?.trim() !== "qt"
        : result.formatNames.includes("matroska");
    const expectedCodec =
      input.videoCodec === "original" ? source.codec : targetCodec;
    const isSizeValid = needsEncoding
      ? result.width === width && result.height === height
      : Math.abs(result.width - source.width) < 1 &&
        Math.abs(result.height - source.height) < 1;
    const isAudioValid =
      result.audioCodecs.length === source.audioCodecs.length &&
      result.audioCodecs.every(
        (codec, index) =>
          codec === (transcodeAudio ? "aac" : source.audioCodecs[index]),
      );
    if (
      !isContainerValid ||
      result.codec !== expectedCodec ||
      !isSizeValid ||
      !isAudioValid ||
      (input.maxHeight !== undefined && result.height > input.maxHeight) ||
      Math.abs(result.durationMs - source.durationMs) >
        Math.max(250, Math.min(1000, source.durationMs * 0.01))
    )
      throw new AppError(
        "DOWNLOAD_CONVERSION_VALIDATION",
        "转换结果的容器、编码、尺寸或时长校验失败，未导入项目。",
      );
    input.onProgress(1);
    checkAbort(input.signal);
    return output;
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  }
}
