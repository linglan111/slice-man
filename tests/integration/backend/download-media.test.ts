import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runProcess } from "../../../src/main/lib/process";
import {
  normalizeDownload,
  type NormalizeDownloadInput,
} from "../../../src/main/services/download/lib/download-media";

const roots: string[] = [];
const ffmpeg = resolve("resources/media/ffmpeg.exe");
const ffprobe = resolve("resources/media/ffprobe.exe");
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(
  codec = "libx264",
  container = "mp4",
  height = 180,
): Promise<{ root: string; input: string; hash: string }> {
  const root = await mkdtemp(join(tmpdir(), "slice-normalize-中文 space-"));
  roots.push(root);
  const input = join(root, `anonymous source.${container}`);
  await runProcess(ffmpeg, [
    "-v",
    "error",
    "-nostdin",
    "-n",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${Math.round((height * 16) / 9)}x${height}:rate=24:duration=0.8`,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=16000:duration=0.8",
    "-c:v",
    codec,
    "-threads",
    "2",
    "-c:a",
    container === "webm" ? "libopus" : "aac",
    "-shortest",
    input,
  ]);
  return {
    root,
    input,
    hash: createHash("sha256")
      .update(await readFile(input))
      .digest("hex"),
  };
}
type Probed = {
  streams: {
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
  }[];
  format: { format_name: string; duration: string };
};
async function actualProbe(path: string): Promise<Probed> {
  const result = await runProcess(ffprobe, [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    path,
  ]);
  return JSON.parse(result.stdout) as Probed;
}
function options(
  f: Awaited<ReturnType<typeof fixture>>,
  settings: Partial<NormalizeDownloadInput> = {},
): NormalizeDownloadInput {
  return {
    input: f.input,
    workingDirectory: join(f.root, "operation"),
    container: "mp4",
    videoCodec: "original",
    maxHeight: 1080,
    ffmpeg,
    ffprobe,
    signal: new AbortController().signal,
    onProgress: () => {},
    ...settings,
  };
}
async function assertSource(
  f: Awaited<ReturnType<typeof fixture>>,
): Promise<void> {
  expect(
    createHash("sha256")
      .update(await readFile(f.input))
      .digest("hex"),
  ).toBe(f.hash);
}
describe("actual native downloaded media normalization", () => {
  it.each([
    ["original", "original"],
    ["mp4", "original"],
    ["mkv", "original"],
    ["original", "h264"],
    ["mp4", "h264"],
    ["mkv", "h264"],
    ["original", "h265"],
    ["mp4", "h265"],
    ["mkv", "h265"],
  ] as const)(
    "validates actual %s / %s output, audio, dimensions, time and source hash",
    async (container, videoCodec) => {
      const f = await fixture();
      const progress: number[] = [];
      const output = await normalizeDownload(
        options(f, {
          container,
          videoCodec,
          onProgress: (value) => progress.push(value),
        }),
      );
      const actual = await actualProbe(output);
      const video = actual.streams.find(
        (stream) => stream.codec_type === "video",
      );
      expect(video).toMatchObject({
        codec_name: videoCodec === "h265" ? "hevc" : "h264",
        width: 320,
        height: 180,
      });
      expect(
        actual.streams.find((stream) => stream.codec_type === "audio")
          ?.codec_name,
      ).toBe("aac");
      expect(Number(actual.format.duration)).toBeGreaterThan(0.7);
      expect(Number(actual.format.duration)).toBeLessThan(1);
      const effectiveContainer =
        container === "original"
          ? videoCodec === "original"
            ? "mp4"
            : "mkv"
          : container;
      expect(actual.format.format_name.split(",")).toContain(
        effectiveContainer === "mp4" ? "mp4" : "matroska",
      );
      expect(output.endsWith(`.${effectiveContainer}`)).toBe(true);
      if (container === "original" && videoCodec === "original")
        expect(output).toBe(f.input);
      else expect(output).not.toBe(f.input);
      expect(progress.at(-1)).toBe(1);
      expect(
        progress.every(
          (value, index) =>
            value >= 0 && value <= 1 && value >= (progress[index - 1] ?? 0),
        ),
      ).toBe(true);
      await assertSource(f);
    },
    15000,
  );

  it("actually changes VP9 to H264 and downsizes without changing aspect or making odd pixels", async () => {
    const f = await fixture("libvpx-vp9", "webm", 360);
    const output = await normalizeDownload(
      options(f, { videoCodec: "h264", maxHeight: 180 }),
    );
    const actual = await actualProbe(output);
    expect(
      actual.streams.find((stream) => stream.codec_type === "video"),
    ).toMatchObject({ codec_name: "h264", width: 320, height: 180 });
    expect(
      actual.streams.find((stream) => stream.codec_type === "audio")
        ?.codec_name,
    ).toBe("aac");
    await assertSource(f);
  }, 15000);

  it("uses displayed rotation when capping height and encodes upright even geometry", async () => {
    const f = await fixture();
    const rotated = join(f.root, "rotated.mp4");
    await runProcess(ffmpeg, [
      "-v",
      "error",
      "-n",
      "-display_rotation:v:0",
      "90",
      "-i",
      f.input,
      "-c",
      "copy",
      rotated,
    ]);
    const output = await normalizeDownload(
      options(f, {
        input: rotated,
        container: "mkv",
        videoCodec: "h265",
        maxHeight: 180,
      }),
    );
    expect(
      (await actualProbe(output)).streams.find(
        (stream) => stream.codec_type === "video",
      ),
    ).toMatchObject({ codec_name: "hevc", width: 100, height: 180 });
    await assertSource(f);
  }, 15000);

  it("keeps original WebM bytes and codec when both preferences are original", async () => {
    const f = await fixture("libvpx-vp9", "webm");
    expect(await normalizeDownload(options(f, { container: "original" }))).toBe(
      f.input,
    );
    expect(
      (await actualProbe(f.input)).streams.find(
        (stream) => stream.codec_type === "video",
      )?.codec_name,
    ).toBe("vp9");
    await assertSource(f);
  }, 15000);

  it("refuses an exceeded height when original encoding is selected, without conversion or source mutation", async () => {
    const f = await fixture("libx264", "mp4", 360);
    await expect(
      normalizeDownload(options(f, { maxHeight: 180 })),
    ).rejects.toMatchObject({ code: "DOWNLOAD_RESOLUTION" });
    expect(await readdir(f.root)).toEqual(["anonymous source.mp4"]);
    await assertSource(f);
  });

  it("reports incompatible VP8 MP4 remux and keeps source plus unrelated existing files", async () => {
    const f = await fixture("libvpx", "webm");
    const existing = join(f.root, "existing user.mp4");
    await writeFile(existing, "existing bytes");
    await expect(normalizeDownload(options(f))).rejects.toMatchObject({
      code: "DOWNLOAD_CONTAINER_INCOMPATIBLE",
    });
    expect(await readdir(join(f.root, "operation"))).toEqual([]);
    expect(await readFile(existing, "utf8")).toBe("existing bytes");
    await assertSource(f);
    const output = await normalizeDownload(options(f, { container: "mkv" }));
    expect(
      (await actualProbe(output)).streams.find(
        (stream) => stream.codec_type === "video",
      )?.codec_name,
    ).toBe("vp8");
  }, 15000);

  it("cancels a running actual conversion, removes only its own stage and never alters source", async () => {
    const f = await fixture("libx264", "mp4", 360);
    const controller = new AbortController();
    const existing = join(f.root, "existing user.mkv");
    await writeFile(existing, "preserved bytes");
    await expect(
      normalizeDownload(
        options(f, {
          videoCodec: "h265",
          signal: controller.signal,
          onProgress: (value) => {
            if (value > 0 && value < 1) controller.abort();
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await readdir(join(f.root, "operation"))).toEqual([]);
    expect(await readFile(existing, "utf8")).toBe("preserved bytes");
    await assertSource(f);
  }, 15000);

  it("rejects corrupt input and already-cancelled work before any valid-looking output", async () => {
    const f = await fixture();
    const invalid = join(f.root, "invalid.mp4");
    await writeFile(invalid, "not a video");
    await expect(
      normalizeDownload(options(f, { input: invalid })),
    ).rejects.toMatchObject({ code: "DOWNLOAD_MEDIA_INVALID" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      normalizeDownload(options(f, { signal: controller.signal })),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await assertSource(f);
  });
});
