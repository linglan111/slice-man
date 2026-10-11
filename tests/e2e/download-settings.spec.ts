import {
  test,
  expect,
  type Page,
  type ElectronApplication,
} from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { z } from "zod";
import type { Job } from "../../src/shared/contracts";
import { launchApp, FFMPEG, FFPROBE } from "./helpers";
import { downloadFixture } from "./download-helpers";
const execute = promisify(execFile);

test("an actual isolated NTFS write denial rejects a download directory and retains saved defaults and existing files", async ({
  playwright: _p,
}, info) => {
  const scope = resolve(info.outputPath("permission-fixture"));
  const workspace = resolve(".");
  if (!scope.startsWith(workspace + sep))
    throw new Error("Permission fixture must remain inside the workspace");
  await mkdir(scope);
  const denied = join(scope, "denied-directory");
  const allowed = join(scope, "allowed-directory");
  await mkdir(denied);
  await mkdir(allowed);
  const sentinel = join(allowed, "existing-source.mp4");
  await writeFile(sentinel, "existing user bytes");
  const { stdout } = await execute(
    "whoami.exe",
    ["/user", "/fo", "csv", "/nh"],
    { windowsHide: true },
  );
  const sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0];
  if (!sid) throw new Error("Cannot establish isolated permission fixture");
  let hasDenyRule = false;
  let app: ElectronApplication | undefined;
  try {
    await execute("icacls.exe", [denied, "/deny", `*${sid}:(WD,AD)`], {
      windowsHide: true,
    });
    hasDenyRule = true;
    await expect(
      writeFile(join(denied, "permission-check"), "probe", { flag: "wx" }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(?:EACCES|EPERM)$/),
    });
    const launched = await launchApp(
      info.outputPath("isolated-permission-data"),
      [],
      [],
      {
        APP_E2E_DOWNLOAD_DIRECTORIES: JSON.stringify([allowed, denied]),
      },
    );
    app = launched.app;
    const page = launched.page;
    await page
      .getByRole("button", { name: "链接导入设置", exact: true })
      .click();
    await page
      .getByRole("button", { name: "选择下载位置", exact: true })
      .click();
    await expect(page.getByLabel("下载位置", { exact: true })).toHaveValue(
      allowed,
    );
    await page
      .getByRole("button", { name: "保存下载设置", exact: true })
      .click();
    await expect(
      page.getByText("下载设置已保存。", { exact: true }),
    ).toBeVisible();
    const previous = await page.evaluate(async () => {
      const result = await window.api.download.status();
      if (!result.success) throw new Error("Missing saved settings");
      return result.data.settings;
    });
    await page
      .getByLabel("视频下载清晰度", { exact: true })
      .selectOption("720p");
    await page
      .getByRole("button", { name: "选择下载位置", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("所选下载目录无法写入");
    await expect(page.getByLabel("下载位置", { exact: true })).toHaveValue(
      allowed,
    );
    await expect(
      page.getByLabel("视频下载清晰度", { exact: true }),
    ).toHaveValue("720p");
    const saved = await page.evaluate(async () => {
      const result = await window.api.download.status();
      if (!result.success) throw new Error("Cannot inspect preserved settings");
      return result.data.settings;
    });
    expect(saved).toEqual(previous);
    expect(await readFile(sentinel, "utf8")).toBe("existing user bytes");
    expect(await readdir(allowed)).toEqual(["existing-source.mp4"]);
    expect(await readdir(denied)).toEqual([]);
    await info.attach("native-permission-result", {
      body: JSON.stringify({
        actualNTFSWriteDenied: true,
        nativeDialogSelectionFixture: true,
        previousSettingsPreserved: true,
        unsavedDraftPreserved: true,
        existingFilePreserved: true,
        ownedProbeCleaned: true,
      }),
      contentType: "application/json",
    });
  } finally {
    try {
      await app?.close();
    } finally {
      if (hasDenyRule)
        await execute("icacls.exe", [denied, "/remove:d", `*${sid}`], {
          windowsHide: true,
        });
    }
  }
});

async function settings(
  page: Page,
  container: string,
  videoCodec: string,
  quality = "1080p",
): Promise<void> {
  await page.getByRole("button", { name: "链接导入设置", exact: true }).click();
  await page
    .getByLabel("下载容器格式", { exact: true })
    .selectOption(container);
  await page
    .getByLabel("下载视频编码", { exact: true })
    .selectOption(videoCodec);
  await page
    .getByLabel("视频下载清晰度", { exact: true })
    .selectOption(quality);
  if (container === "original" && videoCodec !== "original")
    await expect(page.getByText(/当前组合最终保存为 MKV/)).toBeVisible();
  await page.getByRole("button", { name: "保存下载设置", exact: true }).click();
  await expect(
    page.getByText("下载设置已保存。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
}
async function importUrl(page: Page, url: string): Promise<void> {
  await page.getByRole("button", { name: "链接导入", exact: true }).click();
  await page.getByLabel("视频链接", { exact: true }).fill(url);
  await page.getByRole("button", { name: "下载并导入", exact: true }).click();
}
async function currentJob(page: Page): Promise<Job> {
  return page.evaluate(async () => {
    const r = await window.api.jobs.list();
    if (!r.success || !r.data[0]) throw new Error("Missing import");
    return r.data[0];
  });
}
async function probe(
  path: string,
): Promise<{ codec: string; format: string; width: number; height: number }> {
  const { stdout } = await execute(
    FFPROBE,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
    { windowsHide: true },
  );
  const data = z
    .object({
      streams: z.array(
        z.object({
          codec_type: z.string(),
          codec_name: z.string(),
          width: z.number().optional(),
          height: z.number().optional(),
        }),
      ),
      format: z.object({ format_name: z.string() }),
    })
    .parse(JSON.parse(stdout));
  const video = data.streams.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height) throw new Error("No video");
  return {
    codec: video.codec_name,
    width: video.width,
    height: video.height,
    format: data.format.format_name,
  };
}

test("native directory selection, persisted format/codec/resolution matrix, real transforms, no upscale and cancellation preserve existing files", async ({
  playwright: _p,
}, info) => {
  test.setTimeout(240_000);
  const source = info.outputPath("anonymous.webm");
  await execute(
    FFMPEG,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x182b3e:s=640x480:r=25",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=400:sample_rate=48000:duration=1.5",
      "-t",
      "1.5",
      "-c:v",
      "libvpx-vp9",
      "-deadline",
      "realtime",
      "-cpu-used",
      "8",
      "-c:a",
      "libopus",
      source,
    ],
    { windowsHide: true },
  );
  const target = info.outputPath("选择的 视频 下载目录");
  await mkdir(target, { recursive: true });
  const sentinel = join(target, "source.mp4");
  await writeFile(sentinel, "existing-user-file-never-overwritten");
  const fixture = await downloadFixture(info.outputPath("tools"), source);
  const userData = info.outputPath("user-data");
  let app: ElectronApplication | undefined;
  const results: {
    container: string;
    requestedCodec: string;
    codec: string;
    format: string;
    height: number;
  }[] = [];
  try {
    const first = await launchApp(userData, [], [], {
      APP_E2E_DOWNLOAD_MANIFEST: fixture.manifest,
      APP_E2E_DOWNLOAD_DIRECTORIES: JSON.stringify([sentinel, target]),
    });
    app = first.app;
    const page = first.page;
    await page
      .getByRole("button", { name: "链接导入设置", exact: true })
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
    await expect(page.getByLabel("下载位置", { exact: true })).toHaveValue(
      join(userData, "downloads"),
    );
    // Native picker saves only the directory; other unsaved form choices survive.
    await page.getByLabel("下载视频编码", { exact: true }).selectOption("h265");
    await page
      .getByRole("button", { name: "选择下载位置", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(/目录不存在|无法访问/);
    await expect(page.getByLabel("下载位置", { exact: true })).toHaveValue(
      join(userData, "downloads"),
    );
    expect(await readFile(sentinel, "utf8")).toBe(
      "existing-user-file-never-overwritten",
    );
    await page
      .getByRole("button", { name: "选择下载位置", exact: true })
      .click();
    await expect(page.getByLabel("下载位置", { exact: true })).toHaveValue(
      target,
    );
    await expect(page.getByLabel("下载视频编码", { exact: true })).toHaveValue(
      "h265",
    );
    await page
      .getByRole("button", { name: "选择下载位置", exact: true })
      .click(); // Cancelled picker leaves draft/location intact.
    await expect(page.getByLabel("下载位置", { exact: true })).toHaveValue(
      target,
    );
    await page
      .getByLabel("下载视频编码", { exact: true })
      .selectOption("original");
    for (const quality of [
      "360p",
      "480p",
      "720p",
      "1080p",
      "1440p",
      "2160p",
      "best",
      "1080p",
    ]) {
      await page
        .getByLabel("视频下载清晰度", { exact: true })
        .selectOption(quality);
      await page
        .getByRole("button", { name: "保存下载设置", exact: true })
        .click();
      await expect
        .poll(async () => {
          const r = await page.evaluate(() => window.api.download.status());
          return r.success ? r.data.settings.quality : "error";
        })
        .toBe(quality);
      await expect
        .poll(async () => {
          const r = await page.evaluate(() => window.api.download.status());
          return r.success ? r.data.settings.directory : "error";
        })
        .toBe(target);
    }
    await page
      .getByRole("button", { name: "一键安装下载工具", exact: true })
      .click();
    await expect(
      page.getByText("下载工具已安装并验证，可以导入视频链接。", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    for (const container of ["mp4", "mkv", "original"]) {
      for (const videoCodec of ["original", "h264", "h265"]) {
        await settings(page, container, videoCodec);
        await importUrl(
          page,
          `${fixture.url}/anonymous.webm?case=${container}-${videoCodec}`,
        );
        await expect(
          page.getByRole("dialog", { name: "链接导入视频", exact: true }),
        ).not.toBeVisible({ timeout: 30000 });
        const job = await currentJob(page);
        expect(dirname(dirname(job.inputPath))).toBe(target);
        const actual = await probe(job.inputPath);
        const expectedContainer =
          container === "original" && videoCodec !== "original"
            ? "mkv"
            : container;
        expect(actual.codec).toBe(
          videoCodec === "original"
            ? "vp9"
            : videoCodec === "h264"
              ? "h264"
              : "hevc",
        );
        expect(actual.height).toBe(480);
        expect(actual.width).toBe(640); // No enlargement to configured 1080p.
        if (expectedContainer === "mp4") {
          expect(actual.format).toContain("mp4");
          expect(extname(job.inputPath)).toBe(".mp4");
        } else if (expectedContainer === "mkv") {
          expect(actual.format).toContain("matroska");
          expect(extname(job.inputPath)).toBe(".mkv");
        } else {
          expect(actual.format).toContain("webm");
          expect(extname(job.inputPath)).toBe(".webm");
        }
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          basename(job.inputPath),
        );
        await expect
          .poll(() =>
            page
              .locator("video")
              .evaluate((v: HTMLVideoElement) => v.readyState),
          )
          .toBeGreaterThanOrEqual(2);
        results.push({ container, requestedCodec: videoCodec, ...actual });
      }
    }
    await settings(page, "mp4", "original", "360p");
    await importUrl(
      page,
      `${fixture.url}/anonymous.webm?case=unknown-height-cap`,
    );
    await expect(page.getByRole("alert")).toContainText(/分辨率|上限/);
    expect(
      await page.evaluate(async () => {
        const r = await window.api.jobs.list();
        return r.success ? r.data.length : -1;
      }),
    ).toBe(9);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await settings(page, "mp4", "h264", "360p");
    await importUrl(page, `${fixture.url}/anonymous.webm?case=downscale`);
    await expect(
      page.getByRole("dialog", { name: "链接导入视频", exact: true }),
    ).not.toBeVisible({ timeout: 30000 });
    expect(await probe((await currentJob(page)).inputPath)).toMatchObject({
      codec: "h264",
      width: 480,
      height: 360,
    });
    await settings(page, "mkv", "h265", "best");
    const heavy = info.outputPath("long-anonymous.mp4");
    await execute(
      FFMPEG,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        // Moving frames keep real software conversion active and flush partial bytes.
        // A static color fixture can finish before cancellation observes any output.
        "testsrc2=s=1280x720:r=30",
        "-t",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        heavy,
      ],
      { windowsHide: true },
    );
    fixture.behavior.video = heavy;
    await importUrl(page, `${fixture.url}/long.mp4?case=conversion-cancel`);
    await expect
      .poll(
        async () => {
          for (const name of await readdir(target))
            if (name.startsWith(".partial-")) {
              for (const file of await readdir(join(target, name)))
                if (
                  file !== "source.mp4" &&
                  (await stat(join(target, name, file))).size > 0
                )
                  return true;
            }
          return false;
        },
        { timeout: 15000, intervals: [50, 100, 250] },
      )
      .toBe(true);
    await page.getByRole("button", { name: "取消下载", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("取消");
    expect(
      (await readdir(target)).some((name) => name.startsWith(".partial-")),
    ).toBe(false);
    expect(await readFile(sentinel, "utf8")).toBe(
      "existing-user-file-never-overwritten",
    );
    expect(
      await page.evaluate(async () => {
        const r = await window.api.jobs.list();
        return r.success ? r.data.length : -1;
      }),
    ).toBe(10);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await app.close();
    app = undefined;
    const next = await launchApp(userData, [], [], {
      APP_E2E_DOWNLOAD_MANIFEST: fixture.manifest,
    });
    app = next.app;
    await next.page
      .getByRole("button", { name: "链接导入设置", exact: true })
      .click();
    await expect(next.page.getByLabel("下载位置", { exact: true })).toHaveValue(
      target,
    );
    await expect(
      next.page.getByLabel("下载容器格式", { exact: true }),
    ).toHaveValue("mkv");
    await expect(
      next.page.getByLabel("下载视频编码", { exact: true }),
    ).toHaveValue("h265");
    await expect(
      next.page.getByLabel("视频下载清晰度", { exact: true }),
    ).toHaveValue("best");
    await info.attach("container-codec-results", {
      body: JSON.stringify({
        results,
        nativeDirectoryPickerFixture: true,
        invalidDirectoryPreservesSettings: true,
        anonymousHTTPMedia: true,
        realFFmpeg: true,
        downscale: true,
        noUpscale: true,
        conversionCancel: true,
        sameNameFilePreserved: true,
        settingsRestart: true,
        paidAI: 0,
      }),
      contentType: "application/json",
    });
  } finally {
    await app?.close();
    await fixture.close();
  }
});
