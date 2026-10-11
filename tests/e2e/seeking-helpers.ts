import { expect, type Page, type ElectronApplication } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { FFMPEG } from "./helpers";

const execute = promisify(execFile);
export async function makeSeekVideo(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await execute(
    FFMPEG,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=960x540:rate=12:duration=75",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=16000:cl=mono",
      "-t",
      "75",
      "-vf",
      "drawbox=x=0:y=0:w=120:h=120:color=red:t=fill:enable='lt(t,15)',drawbox=x=0:y=0:w=120:h=120:color=green:t=fill:enable='between(t,15,35)',drawbox=x=0:y=0:w=120:h=120:color=blue:t=fill:enable='between(t,35,60)',drawbox=x=0:y=0:w=120:h=120:color=yellow:t=fill:enable='gte(t,60)'",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "15",
      "-g",
      "24",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-shortest",
      path,
    ],
    { windowsHide: true, timeout: 120000 },
  );
}

export async function rangeProbe(
  app: ElectronApplication,
  url: string,
): Promise<{
  status: number;
  contentRange: string | null;
  acceptRanges: string | null;
  length: string | null;
  receivedBytes: number;
}> {
  return app.evaluate(async ({ net }, mediaUrl) => {
    const response = await net.fetch(mediaUrl, {
      headers: { Range: "bytes=0-31" },
    });
    const result = {
      status: response.status,
      contentRange: response.headers.get("content-range"),
      acceptRanges: response.headers.get("accept-ranges"),
      length: response.headers.get("content-length"),
      receivedBytes: 0,
    };
    if (response.status === 206)
      result.receivedBytes = (await response.arrayBuffer()).byteLength;
    else await response.body?.cancel();
    return result;
  }, url);
}

export async function installSeekTelemetry(page: Page): Promise<void> {
  await page.locator("video").evaluate((video: HTMLVideoElement) => {
    video.dataset.seekedCount = "0";
    video.dataset.frameCount = "0";
    video.addEventListener("seeked", () => {
      video.dataset.seekedCount = String(
        Number(video.dataset.seekedCount ?? "0") + 1,
      );
    });
    const recordFrame: VideoFrameRequestCallback = (_now, metadata) => {
      video.dataset.frameCount = String(
        Number(video.dataset.frameCount ?? "0") + 1,
      );
      video.dataset.frameTime = String(metadata.mediaTime);
      video.requestVideoFrameCallback(recordFrame);
    };
    video.requestVideoFrameCallback(recordFrame);
  });
}

export type SeekObservation = {
  targetSeconds: number;
  bufferedBefore: [number, number][];
  targetWasBuffered: boolean;
  currentTime: number;
  decodedFrameTime: number;
  seekedEvents: number;
  rgb: number[];
};
export async function assertDecodedSeek(
  page: Page,
  targetSeconds: number,
  imagePath: string,
  action?: () => Promise<void>,
): Promise<SeekObservation> {
  const video = page.locator("video");
  const before = await video.evaluate((element: HTMLVideoElement) => ({
    seeks: Number(element.dataset.seekedCount ?? "0"),
    frames: Number(element.dataset.frameCount ?? "0"),
    buffered: Array.from(
      { length: element.buffered.length },
      (_, index): [number, number] => [
        element.buffered.start(index),
        element.buffered.end(index),
      ],
    ),
  }));
  if (action) await action();
  else
    await video.evaluate((element: HTMLVideoElement, time) => {
      element.currentTime = time;
    }, targetSeconds);
  await expect
    .poll(
      () =>
        video.evaluate((element: HTMLVideoElement) =>
          Number(element.dataset.seekedCount ?? "0"),
        ),
      {
        timeout: 10000,
        message:
          "Real decoder seeked event must occur, not merely an optimistic UI timestamp.",
      },
    )
    .toBeGreaterThan(before.seeks);
  await expect
    .poll(
      () =>
        video.evaluate((element: HTMLVideoElement) =>
          Number(element.dataset.frameCount ?? "0"),
        ),
      {
        timeout: 10000,
        message: "A newly decoded frame must be presented after seeking.",
      },
    )
    .toBeGreaterThan(before.frames);
  await expect
    .poll(
      () =>
        video.evaluate(
          (element: HTMLVideoElement, target) =>
            Math.abs(Number(element.dataset.frameTime ?? "-1000") - target),
          targetSeconds,
        ),
      {
        timeout: 10000,
        message:
          "Presented decoded frame time must match the requested destination.",
      },
    )
    .toBeLessThan(0.15);
  const after = await video.evaluate((element: HTMLVideoElement) => ({
    currentTime: element.currentTime,
    decodedFrameTime: Number(element.dataset.frameTime),
    seeks: Number(element.dataset.seekedCount),
    seeking: element.seeking,
  }));
  expect(after.seeking).toBe(false);
  expect(after.currentTime).toBeCloseTo(targetSeconds, 1);
  expect(Math.abs(after.decodedFrameTime - targetSeconds)).toBeLessThan(0.15);
  await video.screenshot({ path: imagePath });
  // The persistent preview uses object-fit: contain. Sample the encoded time band
  // inside the actual video image rather than the element's letterboxed corner.
  const sample = await video.evaluate((element: HTMLVideoElement) => {
    const bounds = element.getBoundingClientRect();
    const scale = Math.min(
      bounds.width / element.videoWidth,
      bounds.height / element.videoHeight,
    );
    const left = (bounds.width - element.videoWidth * scale) / 2;
    const top = (bounds.height - element.videoHeight * scale) / 2;
    return {
      x: Math.floor(left + 60 * scale - 5),
      y: Math.floor(top + 60 * scale - 5),
    };
  });
  const pixel = await execute(
    FFMPEG,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      imagePath,
      "-vf",
      `crop=10:10:${sample.x}:${sample.y},scale=1:1`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { encoding: "buffer", windowsHide: true },
  );
  const rgb = Array.from(pixel.stdout);
  const expected =
    targetSeconds < 15
      ? [255, 0, 0]
      : targetSeconds < 35
        ? [0, 128, 0]
        : targetSeconds < 60
          ? [0, 0, 255]
          : [255, 255, 0];
  // Chromium's display color conversion can lift saturated channel values; distinct bands
  // still differ by at least 128, so this tolerance cannot accept a stale time-band frame.
  for (let channel = 0; channel < 3; channel++)
    expect(
      Math.abs((rgb[channel] ?? 0) - (expected[channel] ?? 0)),
      "Decoded screenshot must show the independently encoded time-band color.",
    ).toBeLessThan(60);
  return {
    targetSeconds,
    bufferedBefore: before.buffered,
    targetWasBuffered: before.buffered.some(
      ([start, end]) => targetSeconds >= start && targetSeconds <= end,
    ),
    currentTime: after.currentTime,
    decodedFrameTime: after.decodedFrameTime,
    seekedEvents: after.seeks - before.seeks,
    rgb,
  };
}
