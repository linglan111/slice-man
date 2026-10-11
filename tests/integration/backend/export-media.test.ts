import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runProcess } from "../../../src/main/lib/process";
import { MediaService } from "../../../src/main/services/media/lib/media-service";
import { compileSubtitles } from "../../../src/main/services/subtitles/lib/compiler";
import { DEFAULT_STYLE, type MediaInfo } from "../../../src/shared/contracts";
import type { ExportVideoOptions } from "../../../src/shared/export-contracts";
const roots: string[] = [];
const media = new MediaService({
  ffmpeg: resolve("resources/media/ffmpeg.exe"),
  ffprobe: resolve("resources/media/ffprobe.exe"),
  fonts: resolve("resources/fonts"),
});
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
type Fixture = {
  root: string;
  input: string;
  info: MediaInfo;
  ass: string;
  hash: string;
};
async function fixture(
  codec = "libx264",
  height = 480,
  duration = 1,
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "slice-export-中文 space-"));
  roots.push(root);
  const input = join(
    root,
    codec.startsWith("libvpx") ? "anonymous.webm" : "anonymous.mp4",
  );
  await runProcess(media.paths.ffmpeg, [
    "-v",
    "error",
    "-nostdin",
    "-n",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${(height * 4) / 3}x${height}:r=24:d=${duration}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${duration}`,
    "-c:v",
    codec,
    "-threads",
    "2",
    ...(codec === "libx265" ? ["-x265-params", "pools=2"] : []),
    ...(codec === "libaom-av1"
      ? ["-cpu-used", "8", "-crf", "35", "-b:v", "0", "-row-mt", "1"]
      : []),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    codec.startsWith("libvpx") ? "libopus" : "aac",
    "-shortest",
    input,
  ]);
  const info = await media.probe(input);
  return {
    root,
    input,
    info,
    ass: subtitle(info),
    hash: createHash("sha256")
      .update(await readFile(input))
      .digest("hex"),
  };
}
function subtitle(info: MediaInfo): string {
  return compileSubtitles(
    [
      {
        id: "manual",
        startMs: 0,
        endMs: info.durationMs,
        sourceText: "English source",
        translatedText: "中文修订字幕",
        translationStale: false,
      },
    ],
    { ...DEFAULT_STYLE, animation: { type: "none", inMs: 0, outMs: 0 } },
    info,
    true,
    "ass",
  );
}
async function videoProperties(path: string): Promise<{
  codec: string;
  container: string;
  width: number;
  height: number;
  audio: string;
}> {
  const result = await runProcess(media.paths.ffprobe, [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    path,
  ]);
  const raw = JSON.parse(result.stdout) as {
    streams: {
      codec_type: string;
      codec_name: string;
      width: number;
      height: number;
    }[];
    format: { format_name: string };
  };
  const video = raw.streams.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error("Missing video");
  return {
    codec: video.codec_name,
    width: video.width,
    height: video.height,
    container: raw.format.format_name,
    audio:
      raw.streams.find((stream) => stream.codec_type === "audio")?.codec_name ??
      "none",
  };
}
async function verifyPixels(path: string): Promise<void> {
  const result = await runProcess(media.paths.ffmpeg, [
    "-v",
    "error",
    "-ss",
    "0.4",
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    "signalstats,metadata=print:file=-",
    "-f",
    "null",
    "-",
  ]);
  const match = /lavfi.signalstats.YMAX=(\d+)/.exec(result.stdout);
  expect(Number(match?.[1] ?? 0)).toBeGreaterThan(100);
}
async function captionBounds(
  path: string,
  width: number,
  height: number,
): Promise<number[]> {
  const result = await runProcess(media.paths.ffmpeg, [
    "-hide_banner",
    "-ss",
    "0.4",
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    "bbox=min_val=64",
    "-f",
    "null",
    "-",
  ]);
  const match = /x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/.exec(result.stderr);
  if (!match) throw new Error("Missing decoded caption bounds");
  return [
    Number(match[1]) / width,
    Number(match[2]) / width,
    Number(match[3]) / height,
    Number(match[4]) / height,
  ];
}
async function render(
  f: Fixture,
  extension: "mp4" | "mkv",
  options?: ExportVideoOptions,
): Promise<string> {
  const output = join(f.root, `burned-${Date.now()}.${extension}`);
  await media.render(
    f.input,
    join(f.root, "work"),
    f.ass,
    f.info,
    output,
    "balanced",
    undefined,
    undefined,
    undefined,
    options,
  );
  return output;
}
async function unchanged(f: Fixture): Promise<void> {
  expect(
    createHash("sha256")
      .update(await readFile(f.input))
      .digest("hex"),
  ).toBe(f.hash);
}
describe("actual configured video export", () => {
  it.each([
    ["mp4", "original"],
    ["mkv", "original"],
    ["mp4", "h264"],
    ["mkv", "h264"],
    ["mp4", "h265"],
    ["mkv", "h265"],
  ] as const)(
    "burns real caption pixels with %s/%s, preserving below-ceiling dimensions and source bytes",
    async (container, videoCodec) => {
      const f = await fixture();
      const output = await render(f, container, {
        videoCodec,
        resolution: "720p",
      });
      const properties = await videoProperties(output);
      expect(properties).toMatchObject({
        codec: videoCodec === "h265" ? "hevc" : "h264",
        width: 640,
        height: 480,
        audio: "aac",
      });
      expect(properties.container.split(",")).toContain(
        container === "mp4" ? "mp4" : "matroska",
      );
      expect(
        Math.abs((await media.probe(output)).durationMs - f.info.durationMs),
      ).toBeLessThan(100);
      await verifyPixels(output);
      await unchanged(f);
    },
    15000,
  );
  it("original HEVC is actually re-encoded with subtitles, and legacy omitted options still encode H264", async () => {
    const f = await fixture("libx265");
    const original = await render(f, "mkv", {
      videoCodec: "original",
      resolution: "original",
    });
    expect((await videoProperties(original)).codec).toBe("hevc");
    await verifyPixels(original);
    const legacy = await render(f, "mp4");
    expect((await videoProperties(legacy)).codec).toBe("h264");
    await verifyPixels(legacy);
    await unchanged(f);
  }, 15000);
  it("scales output and original ASS layout proportionally, preserving aspect and readable subtitle pixels", async () => {
    const f = await fixture();
    const output = await render(f, "mp4", {
      videoCodec: "h264",
      resolution: "360p",
    });
    expect(await videoProperties(output)).toMatchObject({
      width: 480,
      height: 360,
    });
    const full = await render(f, "mp4", {
      videoCodec: "h264",
      resolution: "original",
    });
    const sourceBounds = await captionBounds(full, 640, 480);
    const resizedBounds = await captionBounds(output, 480, 360);
    for (let index = 0; index < sourceBounds.length; index++)
      expect(
        Math.abs((sourceBounds[index] ?? 0) - (resizedBounds[index] ?? 0)),
      ).toBeLessThan(0.02);
    await verifyPixels(output);
    await unchanged(f);
  }, 15000);
  it("preserves rotated/SAR display geometry while applying the height ceiling", async () => {
    const f = await fixture();
    const anamorphic = join(f.root, "anamorphic.mp4");
    await runProcess(media.paths.ffmpeg, [
      "-v",
      "error",
      "-n",
      "-i",
      f.input,
      "-vf",
      "setsar=2/1",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-c:a",
      "copy",
      anamorphic,
    ]);
    const rotated = join(f.root, "rotated.mp4");
    await runProcess(media.paths.ffmpeg, [
      "-v",
      "error",
      "-n",
      "-display_rotation:v:0",
      "90",
      "-i",
      anamorphic,
      "-c",
      "copy",
      rotated,
    ]);
    const info = await media.probe(rotated);
    const output = join(f.root, "upright.mkv");
    await media.render(
      rotated,
      join(f.root, "work"),
      subtitle(info),
      info,
      output,
      "balanced",
      undefined,
      undefined,
      undefined,
      { videoCodec: "h265", resolution: "360p" },
    );
    expect(await videoProperties(output)).toMatchObject({
      codec: "hevc",
      width: 134,
      height: 360,
    });
    await verifyPixels(output);
    await unchanged(f);
  }, 15000);
  it("rejects unsupported original codec without hidden fallback, and succeeds after explicit supported selection", async () => {
    const f = await fixture("mpeg4");
    await expect(
      render(f, "mp4", { videoCodec: "original", resolution: "1080p" }),
    ).rejects.toMatchObject({ code: "EXPORT_CODEC_UNSUPPORTED" });
    const output = await render(f, "mp4", {
      videoCodec: "h264",
      resolution: "1080p",
    });
    expect((await videoProperties(output)).codec).toBe("h264");
    await verifyPixels(output);
    await unchanged(f);
  }, 15000);
  it.each([
    ["libaom-av1", "av1", "mp4"],
    ["libaom-av1", "av1", "mkv"],
    ["libvpx-vp9", "vp9", "mp4"],
    ["libvpx-vp9", "vp9", "mkv"],
    ["libvpx", "vp8", "mkv"],
  ] as const)(
    "burns original %s into %s/%s through its real software encoder",
    async (encoder, expectedCodec, container) => {
      const f = await fixture(encoder);
      const output = await render(f, container, {
        videoCodec: "original",
        resolution: "360p",
      });
      expect(await videoProperties(output)).toMatchObject({
        codec: expectedCodec,
        width: 480,
        height: 360,
        audio: "aac",
      });
      await verifyPixels(output);
      await unchanged(f);
    },
    30000,
  );
  it("explains unsupported VP8/MP4 instead of substituting a video codec", async () => {
    const f = await fixture("libvpx");
    await expect(
      render(f, "mp4", { videoCodec: "original" }),
    ).rejects.toMatchObject({ code: "EXPORT_CONTAINER_UNSUPPORTED" });
    await unchanged(f);
  }, 15000);
  it("cancels actual AV1 software burn-in without publication or source changes", async () => {
    const f = await fixture("libaom-av1");
    const controller = new AbortController();
    const destination = join(f.root, "cancel-av1.mp4");
    await expect(
      media.render(
        f.input,
        join(f.root, "work"),
        f.ass,
        f.info,
        destination,
        "balanced",
        controller.signal,
        undefined,
        (value) => {
          if (value > 0) controller.abort();
        },
        { videoCodec: "original", resolution: "360p" },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await readdir(f.root)).not.toContain("cancel-av1.mp4");
    await unchanged(f);
  }, 30000);
  it("cancels actual H265 export on native progress and retains existing destinations and input", async () => {
    const f = await fixture("libx264", 480, 3);
    const existing = join(f.root, "old-user.mkv");
    await writeFile(existing, "existing bytes");
    const controller = new AbortController();
    await expect(
      media.render(
        f.input,
        join(f.root, "work"),
        f.ass,
        f.info,
        existing,
        "high",
        controller.signal,
        undefined,
        (value) => {
          if (value > 0) controller.abort();
        },
        { videoCodec: "h265", resolution: "360p" },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await readFile(existing, "utf8")).toBe("existing bytes");
    expect(
      (await readdir(f.root)).some((name) => name.startsWith(".slice-")),
    ).toBe(false);
    await unchanged(f);
  }, 15000);
});
