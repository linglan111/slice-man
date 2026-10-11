import { test, expect, type ElectronApplication } from "@playwright/test";
import { stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { downloadFixture } from "./download-helpers";
import { launchApp, FFPROBE } from "./helpers";
const execute = promisify(execFile);

test("authorized real YouTube and Bilibili complete download/probe/import/decoded playback via production Electron UI", async ({
  playwright: _p,
}, info) => {
  test.skip(
    process.env.APP_REAL_DOWNLOAD_E2E !== "1",
    "Explicitly gated live user-supplied video downloads",
  );
  test.setTimeout(360_000);
  const fixture = await downloadFixture(info.outputPath("tools-fixture"));
  let app: ElectronApplication | undefined;
  const results: {
    site: string;
    durationMs: number;
    bytes: number;
    width: number;
    height: number;
    decodedFrames: number;
    codec: string;
    container: string;
  }[] = [];
  try {
    const launched = await launchApp(
      info.outputPath("isolated-user-data"),
      [],
      [],
      { APP_E2E_DOWNLOAD_MANIFEST: fixture.manifest },
    );
    app = launched.app;
    const page = launched.page;
    await page
      .getByRole("button", { name: "↓ 链接导入设置", exact: true })
      .click();
    await expect(
      page.getByLabel("视频下载清晰度", { exact: true }),
    ).toHaveValue("1080p");
    await expect(page.getByLabel("下载容器格式", { exact: true })).toHaveValue(
      "mp4",
    );
    await expect(page.getByLabel("下载视频编码", { exact: true })).toHaveValue(
      "original",
    );
    await page
      .getByRole("button", { name: "一键安装下载工具", exact: true })
      .click();
    await expect(
      page.getByText("下载工具已安装并验证，可以导入视频链接。", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    for (const [site, url, minimumDuration] of [
      ["youtube.com", "https://www.youtube.com/watch?v=Z-tj9wSxrLQ", 70000],
      ["bilibili.com", "https://www.bilibili.com/video/BV1mWpF6KEMK/", 30000],
    ] as const) {
      await page.getByRole("button", { name: "链接导入", exact: true }).click();
      await page.getByLabel("视频链接", { exact: true }).fill(url);
      await page
        .getByRole("button", { name: "下载并导入", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "链接导入视频", exact: true }),
      ).not.toBeVisible({ timeout: 150000 });
      const job = await page.evaluate(async () => {
        const r = await window.api.jobs.list();
        if (!r.success || !r.data[0])
          throw new Error("Missing real video import");
        return r.data[0];
      });
      expect(job.media.durationMs).toBeGreaterThanOrEqual(minimumDuration);
      expect(job.media.hasAudio).toBe(true);
      expect(job.media.height).toBeLessThanOrEqual(1080);
      const inspected = await execute(
        FFPROBE,
        [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          job.inputPath,
        ],
        { windowsHide: true },
      );
      const media = z
        .object({
          streams: z.array(
            z.object({ codec_type: z.string(), codec_name: z.string() }),
          ),
          format: z.object({ format_name: z.string() }),
        })
        .parse(JSON.parse(inspected.stdout));
      const codec =
        media.streams.find((stream) => stream.codec_type === "video")
          ?.codec_name ?? "";
      expect(codec).not.toBe("");
      expect(media.format.format_name).toContain("mp4");
      await expect
        .poll(
          () =>
            page
              .locator("video")
              .evaluate((v: HTMLVideoElement) => v.readyState),
          { timeout: 60000 },
        )
        .toBeGreaterThanOrEqual(2);
      await page.locator("video").evaluate(async (v: HTMLVideoElement) => {
        v.currentTime = 5;
        await v.play();
      });
      await expect
        .poll(() =>
          page
            .locator("video")
            .evaluate((v: HTMLVideoElement) => v.currentTime),
        )
        .toBeGreaterThan(5.3);
      const decodedFrames = await page
        .locator("video")
        .evaluate((v: HTMLVideoElement) => {
          v.pause();
          return v.getVideoPlaybackQuality().totalVideoFrames;
        });
      expect(decodedFrames).toBeGreaterThan(0);
      results.push({
        site,
        durationMs: job.media.durationMs,
        bytes: (await stat(job.inputPath)).size,
        width: job.media.width,
        height: job.media.height,
        decodedFrames,
        codec,
        container: media.format.format_name,
      });
    }
    await writeFile(
      info.outputPath("real-results.json"),
      JSON.stringify(results, null, 2),
    );
    await info.attach("real-results", {
      body: JSON.stringify({
        native: true,
        paidAIRequests: 0,
        cookies: false,
        quality: "1080p",
        configuredContainer: "mp4",
        configuredVideoCodec: "original",
        results,
      }),
      contentType: "application/json",
    });
  } finally {
    await app?.close();
    await fixture.close();
  }
});
