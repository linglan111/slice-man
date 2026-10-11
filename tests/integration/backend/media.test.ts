import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  MediaService,
  publish,
} from "../../../src/main/services/media/lib/media-service";
import { runProcess } from "../../../src/main/lib/process";
import { compileSubtitles } from "../../../src/main/services/subtitles/lib/compiler";
import { normalizeCloud } from "../../../src/main/services/subtitles/lib/timeline";
import { DEFAULT_STYLE } from "../../../src/shared/contracts";
const roots: string[] = [];
const media = new MediaService({
  ffmpeg: resolve("resources/media/ffmpeg.exe"),
  ffprobe: resolve("resources/media/ffprobe.exe"),
  fonts: resolve("resources/fonts"),
});
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(): Promise<{ root: string; input: string }> {
  const root = await mkdtemp(join(tmpdir(), "slice-media-中文 space-"));
  roots.push(root);
  const input = join(root, "input.mp4");
  await runProcess(media.paths.ffmpeg, [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=320x240:r=24:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    input,
  ]);
  return { root, input };
}
describe("real native media contracts", () => {
  it("publishes atomically without replacing existing user files", async () => {
    const f = await fixture();
    const temp = join(f.root, "temp");
    const output = join(f.root, "user output");
    await writeFile(temp, "new");
    await writeFile(output, "old");
    await expect(publish(temp, output)).rejects.toMatchObject({
      code: "DESTINATION_EXISTS",
    });
    expect(await readFile(output, "utf8")).toBe("old");
    expect(await readFile(temp, "utf8")).toBe("new");
    await rm(output);
    await publish(temp, output);
    expect(await readFile(output, "utf8")).toBe("new");
    await expect(stat(temp)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("retains positive audio stream delay exactly once in subtitle timing", async () => {
    const f = await fixture();
    const path = join(f.root, "delayed.mkv");
    await runProcess(media.paths.ffmpeg, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x240:r=24:d=2",
      "-itsoffset",
      "0.5",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=16000:duration=1.5",
      "-c:v",
      "libx264",
      "-c:a",
      "pcm_s16le",
      path,
    ]);
    const info = await media.probe(path);
    expect(info.audioOffsetMs).toBe(500);
    const wav = join(f.root, "audio.wav");
    await media.extract(path, wav, 0, 2000);
    const bytes = await readFile(wav);
    const dataOffset = bytes.indexOf(Buffer.from("data"));
    expect(dataOffset).toBeGreaterThan(0);
    expect(bytes.readUInt32LE(dataOffset + 4)).toBe(48000);
    const cue = normalizeCloud(
      { segments: [{ start: 0, end: 0.5, text: "speech" }] },
      info.audioOffsetMs,
      info.durationMs,
      "p",
    )[0];
    expect(cue).toMatchObject({ startMs: 500, endMs: 1000 });
  });
  it("reads display rotation and renders portrait output using that geometry", async () => {
    const f = await fixture();
    const rotated = join(f.root, "rotated.mp4");
    await runProcess(media.paths.ffmpeg, [
      "-v",
      "error",
      "-y",
      "-display_rotation:v:0",
      "90",
      "-i",
      f.input,
      "-c",
      "copy",
      rotated,
    ]);
    const info = await media.probe(rotated);
    expect(info.width).toBe(240);
    expect(info.height).toBe(320);
    const ass = compileSubtitles(
      [
        {
          id: "a",
          startMs: 0,
          endMs: 1900,
          sourceText: "source",
          translatedText: "竖屏字幕",
          translationStale: false,
        },
      ],
      DEFAULT_STYLE,
      info,
      true,
      "ass",
    );
    const output = join(f.root, "portrait.mkv");
    await media.render(
      rotated,
      join(f.root, "work"),
      ass,
      info,
      output,
      "balanced",
    );
    expect(await media.probe(output)).toMatchObject({
      width: 240,
      height: 320,
    });
  }, 15000);
  it("reference preview and burned video contain matching subtitle pixels without subtitle tracks", async () => {
    const f = await fixture();
    const info = await media.probe(f.input);
    const ass = compileSubtitles(
      [
        {
          id: "a",
          startMs: 0,
          endMs: 1900,
          sourceText: "English source",
          translatedText: "中文翻译",
          translationStale: false,
        },
      ],
      DEFAULT_STYLE,
      info,
      true,
      "ass",
    );
    const preview = join(f.root, "reference.png");
    const output = join(f.root, "burned.mp4");
    await media.render(
      f.input,
      join(f.root, "work"),
      ass,
      info,
      preview,
      "high",
      undefined,
      1000,
    );
    await media.render(
      f.input,
      join(f.root, "work"),
      ass,
      info,
      output,
      "high",
    );
    const previewRaw = join(f.root, "preview.raw");
    const outputRaw = join(f.root, "output.raw");
    await runProcess(media.paths.ffmpeg, [
      "-v",
      "error",
      "-y",
      "-i",
      preview,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      previewRaw,
    ]);
    await runProcess(media.paths.ffmpeg, [
      "-v",
      "error",
      "-y",
      "-ss",
      "1",
      "-i",
      output,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      outputRaw,
    ]);
    const a = await readFile(previewRaw);
    const b = await readFile(outputRaw);
    expect(a.length).toBe(320 * 240);
    expect(b.length).toBe(a.length);
    let signal = 0,
      difference = 0;
    for (let i = 0; i < a.length; i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      if (av > 50) signal++;
      difference += Math.abs(av - bv);
    }
    expect(signal).toBeGreaterThan(100);
    expect(difference / a.length).toBeLessThan(2);
    const probe = await runProcess(media.paths.ffprobe, [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      output,
    ]);
    const raw = JSON.parse(probe.stdout) as {
      streams: { codec_type: string }[];
    };
    expect(raw.streams.some((s) => s.codec_type === "subtitle")).toBe(false);
  }, 15000);
  it("cancellation does not publish a partial video", async () => {
    const f = await fixture();
    const info = await media.probe(f.input);
    const output = join(f.root, "cancelled.mp4");
    const c = new AbortController();
    c.abort();
    await expect(
      media.render(
        f.input,
        join(f.root, "work"),
        "invalid",
        info,
        output,
        "balanced",
        c.signal,
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
