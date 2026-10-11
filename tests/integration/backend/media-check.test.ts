import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MediaService } from "../../../src/main/services/media/lib/media-service";
import { runProcess } from "../../../src/main/lib/process";
import { compileSubtitles } from "../../../src/main/services/subtitles/lib/compiler";
import { DEFAULT_STYLE } from "../../../src/shared/contracts";

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
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "slice-independent-中文-"));
  roots.push(root);
  return root;
}
describe("independent actual media geometry and finite effects", () => {
  it("cancels an encoding that emitted progress without publishing its output", async () => {
    const root = await fixture();
    const input = join(root, "cancel-input.mp4");
    await runProcess(media.paths.ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=1280x720:r=25:d=4",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      input,
    ]);
    const info = await media.probe(input);
    const ass = compileSubtitles(
      [
        {
          id: "c",
          startMs: 0,
          endMs: 4000,
          sourceText: "source",
          translatedText: "取消编码测试",
          translationStale: false,
        },
      ],
      DEFAULT_STYLE,
      info,
      false,
      "ass",
    );
    const controller = new AbortController();
    const output = join(root, "cancel-output.mp4");
    let didProgress = false;
    await expect(
      media.render(
        input,
        join(root, "work"),
        ass,
        info,
        output,
        "high",
        controller.signal,
        undefined,
        (value) => {
          if (value > 0) {
            didProgress = true;
            controller.abort();
          }
        },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(didProgress).toBe(true);
    await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await readdir(root)).some((name) => name.startsWith(".slice-")),
    ).toBe(false);
  }, 20000);
  it("normalizes non-square pixels and rotation together for proxy and burn-in", async () => {
    const root = await fixture();
    const source = join(root, "anamorphic.mp4");
    const input = join(root, "rotated.mp4");
    await runProcess(media.paths.ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=black:s=320x240:r=24:d=1",
      "-vf",
      "setsar=2/1",
      "-c:v",
      "libx264",
      source,
    ]);
    await runProcess(media.paths.ffmpeg, [
      "-v",
      "error",
      "-display_rotation:v:0",
      "90",
      "-i",
      source,
      "-c",
      "copy",
      input,
    ]);
    const info = await media.probe(input);
    expect(info).toMatchObject({
      width: 240,
      height: 640,
      sampleAspectRatio: "2:1",
      hasAudio: false,
    });
    const segments = [
      {
        id: "c",
        startMs: 0,
        endMs: 1000,
        sourceText: "This is a long source sentence for a portrait video",
        translatedText: "这是用于验证竖屏和非方形像素的很长中文字幕",
        translationStale: false,
      },
    ];
    const ass = compileSubtitles(segments, DEFAULT_STYLE, info, true, "ass");
    const output = join(root, "burned.mkv");
    await media.render(input, join(root, "work"), ass, info, output, "high");
    expect(await media.probe(output)).toMatchObject({
      width: 240,
      height: 640,
      sampleAspectRatio: "1:1",
      hasAudio: false,
    });
    const [proxy, repeatedProxy] = await Promise.all([
      media.proxy(input, join(root, "proxy"), info),
      media.proxy(input, join(root, "proxy"), info),
    ]);
    expect(repeatedProxy).toBe(proxy);
    expect(await media.probe(proxy)).toMatchObject({
      width: 240,
      height: 640,
      sampleAspectRatio: "1:1",
    });
    const narrowStyle = structuredClone(DEFAULT_STYLE);
    narrowStyle.fontSizeRatio = 0.08;
    narrowStyle.layout.maxWidthRatio = 0.5;
    const narrowAss = compileSubtitles(
      [
        {
          ...segments[0],
          id: "narrow",
          startMs: 0,
          endMs: 1000,
          sourceText: "source",
          translatedText: "一二三四五六七八",
          translationStale: false,
        },
      ],
      narrowStyle,
      info,
      false,
      "ass",
    );
    const narrowFrame = join(root, "narrow.png");
    const narrowRaw = join(root, "narrow.gray");
    await media.render(
      input,
      join(root, "narrow-work"),
      narrowAss,
      info,
      narrowFrame,
      "high",
      undefined,
      500,
    );
    await runProcess(media.paths.ffmpeg, [
      "-v",
      "error",
      "-i",
      narrowFrame,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      narrowRaw,
    ]);
    const pixels = await readFile(narrowRaw);
    let visible = 0;
    let outside = 0;
    for (let index = 0; index < pixels.length; index++) {
      if ((pixels[index] ?? 0) > 50) {
        visible++;
        const x = index % info.width;
        if (x < 45 || x > 195) outside++;
      }
    }
    expect(visible).toBeGreaterThan(1000);
    expect(outside).toBe(0);
  }, 15000);
  it("renders actual fading and bounded bilingual line breaks with bundled CJK fonts", async () => {
    const root = await fixture();
    const input = join(root, "black.mp4");
    await runProcess(media.paths.ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=black:s=640x360:r=25:d=2",
      "-c:v",
      "libx264",
      input,
    ]);
    const info = await media.probe(input);
    const style = structuredClone(DEFAULT_STYLE);
    style.animation = { type: "fade", inMs: 800, outMs: 800 };
    style.layout.maxWidthRatio = 0.5;
    style.emphasisBySegment = [{ segmentId: "c", keywords: ["测试"] }];
    const ass = compileSubtitles(
      [
        {
          id: "c",
          startMs: 0,
          endMs: 2000,
          sourceText: "Literal {\\pos(0,0)} source text with several words",
          translatedText: "中文多行字幕测试以及强调关键词测试",
          translationStale: false,
        },
      ],
      style,
      info,
      true,
      "ass",
    );
    expect(ass).not.toContain("{\\pos(0,0)}");
    expect(ass).toContain("\\N");
    const signals: number[] = [];
    for (const atMs of [0, 1000, 1960]) {
      const frame = join(root, `frame-${atMs}.png`);
      const raw = join(root, `frame-${atMs}.gray`);
      await media.render(
        input,
        join(root, "work"),
        ass,
        info,
        frame,
        "high",
        undefined,
        atMs,
      );
      await runProcess(media.paths.ffmpeg, [
        "-v",
        "error",
        "-i",
        frame,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        raw,
      ]);
      signals.push((await readFile(raw)).reduce((sum, byte) => sum + byte, 0));
    }
    expect(signals[1]).toBeGreaterThan(50000);
    expect(signals[0]).toBeLessThan((signals[1] ?? 0) * 0.15);
    expect(signals[2]).toBeLessThan((signals[1] ?? 0) * 0.3);
  }, 20000);
});
