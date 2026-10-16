import { startSubtitleReview } from './helpers';
import { selectReviewFilters } from './helpers';
import { jobSetting, workspaceButton, closeWorkspaceSettings } from './helpers';
import {
  test,
  expect,
  type Page,
  type ElectronApplication,
} from "@playwright/test";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import type { Job } from "../../src/shared/contracts";
import {
  addProfile,
  assertReferenceParity,
  exportFormat,
  FFMPEG,
  frameDifference,
  importVideo,
  inspectVideo,
  launchApp,
  makeVideo,
  renderInternalReference,
  startMockServer,
} from "./helpers";
import { downloadFixture } from "./download-helpers";

const evidence = resolve(
  ".trellis/tasks/10-11-subtitle-workspace-layout/evidence",
);
const execute = promisify(execFile);

async function job(page: Page): Promise<Job> {
  return page.evaluate(async () => {
    const result = await window.api.jobs.list();
    if (!result.success || !result.data[0])
      throw new Error("Isolated fixture job missing");
    return result.data[0];
  });
}

async function setCloud(page: Page, profile: string): Promise<void> {
  await (await jobSetting(page, '识别方式')).selectOption("cloud");
  await (await jobSetting(page, '语音识别服务'))
    .selectOption({ label: profile });
}

async function seek(page: Page, seconds: number): Promise<void> {
  await page.locator("video").evaluate((video: HTMLVideoElement, value) => {
    video.pause();
    video.currentTime = value;
  }, seconds);
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeCloseTo(seconds, 2);
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.seeking),
    )
    .toBe(false);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, name) });
}

async function fixedWorkspace(page: Page): Promise<void> {
  const preview = await page.locator("video").boundingBox();
  const action = await (await workspaceButton(page, '添加画面字幕'))
    .boundingBox();
  const list = await page.locator(".subtitle-list").boundingBox();
  const height = await page.evaluate(() => innerHeight);
  if (!preview || !action || !list)
    throw new Error("Workspace elements missing");
  expect(preview.height, "Usable video preview").toBeGreaterThan(100);
  expect(action.y + action.height).toBeLessThanOrEqual(height);
  expect(list.height, "Usable proofreading region").toBeGreaterThan(70);
  expect(list.y + list.height).toBeLessThanOrEqual(height + 1);
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector(".subtitle-panel");
    const previewPanel = document.querySelector(".preview-panel");
    if (!panel || !previewPanel) throw new Error("Workspace panels absent");
    const right = panel.getBoundingClientRect();
    const left = previewPanel.getBoundingClientRect();
    return {
      left: left.right,
      right: right.left,
      top: right.top,
      bottom: right.bottom,
      width: innerWidth,
      controls: [
        ...panel.querySelectorAll(
          ".section-heading button, .review-toolbar select, .review-toolbar button, .subtitle-tools button, .subtitle-tools label",
        ),
      ].map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          x: rect.left,
          right: rect.right,
          y: rect.top,
          bottom: rect.bottom,
        };
      }),
      listWidth: panel.querySelector(".subtitle-list")?.clientWidth,
      listScrollWidth: panel.querySelector(".subtitle-list")?.scrollWidth,
    };
  });
  expect(geometry.left).toBeLessThan(geometry.right);
  for (const control of geometry.controls) {
    expect(control.x).toBeGreaterThanOrEqual(geometry.right);
    expect(control.right).toBeLessThanOrEqual(geometry.width);
    expect(control.y).toBeGreaterThanOrEqual(geometry.top);
    expect(control.bottom).toBeLessThanOrEqual(geometry.bottom);
  }
  expect(geometry.listScrollWidth).toBeLessThanOrEqual(
    (geometry.listWidth ?? 0) + 1,
  );
  if (await page.locator(".preview-editor").count()) {
    const editor = await page.locator(".preview-editor").boundingBox();
    expect(
      editor?.height ?? 0,
      "Inline editing must provide room for a readable text field",
    ).toBeGreaterThanOrEqual(60);
    const inner = await page
      .locator(".preview-editor")
      .evaluate((node) => node.clientHeight);
    expect(inner, "Readable inner editor viewport").toBeGreaterThanOrEqual(80);
  }
  if (await page.locator(".reprocessing-panel").count()) {
    const panel = await page.locator(".reprocessing-panel").boundingBox();
    expect(
      panel?.height ?? 0,
      "Partial processing needs a usable local viewport",
    ).toBeGreaterThanOrEqual(60);
  }
  const scroll = await page.evaluate(() => ({
    body: document.body.scrollHeight,
    viewport: innerHeight,
    top: window.scrollY,
  }));
  expect(scroll.body).toBeLessThanOrEqual(scroll.viewport + 1);
  expect(scroll.top).toBe(0);
}

test("source-only creation, cue/time partial repairs, AI text review, restart and exports use real IPC without translation requests", async ({
  playwright: _p,
}, info) => {
  test.setTimeout(180_000);
  const mock = await startMockServer();
  const source = info.outputPath("anonymous-source-only.mp4");
  await makeVideo(source);
  const sourceHash = createHash("sha256")
    .update(await readFile(source))
    .digest("hex");
  const formats = ["srt", "ass", "vtt", "mp4", "mkv"];
  const outputs = formats.map((format) =>
    info.outputPath(`source-only.${format}`),
  );
  const userData = info.outputPath("original-user-data");
  let app: ElectronApplication | undefined;
  try {
    const launched = await launchApp(userData, [source], outputs);
    app = launched.app;
    const page = launched.page;
    await addProfile(
      page,
      "Recognition and review fixture",
      "openai",
      mock.url,
    );
    // Dismissed import does not consume the native picker or create a project.
    await (await workspaceButton(page, '导入视频')).click();
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(async () => {
        const r = await window.api.jobs.list();
        return r.success ? r.data.length : -1;
      }),
    ).toBe(0);
    await importVideo(page, false);
    expect((await job(page)).options.translationEnabled).toBe(false);
    await setCloud(page, "Recognition and review fixture");
    await expect((await jobSetting(page, '翻译服务'))).toHaveCount(0);
    await expect(
      (await workspaceButton(page, '重新翻译片段')),
    ).toHaveCount(0);
    await (await workspaceButton(page, '一键生成字幕'))
      .click();
    await expect(page.getByTestId("segment-0")).toContainText("Hello world.");
    await expect(page.getByTestId("segment-1")).toContainText(
      "A second sentence.",
    );
    expect(mock.counters.translation).toBe(0);
    await (await workspaceButton(page, '重新识别原片'))
      .click();
    await page
      .getByRole("button", { name: "确认重新识别", exact: true })
      .click();
    await expect(
      (await workspaceButton(page, '重新识别原片')),
    ).toBeEnabled();
    expect(mock.counters.recognition).toBe(2);
    expect(mock.counters.translation).toBe(0);
    const original = await job(page);
    const untouched = original.segments[1];
    if (!untouched) throw new Error("Second fixture cue absent");
    await seek(page, 0.6);
    await expect(page.getByTestId("live-captions")).toHaveText("Hello world.");
    await page.locator("video").evaluate(async (video: HTMLVideoElement) => {
      await video.requestFullscreen();
    });
    await expect
      .poll(() =>
        page.locator("video").evaluate((video: HTMLVideoElement) => {
          const cue = video.textTracks[0]?.activeCues?.[0];
          return cue instanceof VTTCue ? cue.text : "";
        }),
      )
      .toContain("Hello world.");
    await page.evaluate(async () => {
      await document.exitFullscreen();
    });
    mock.behavior.recognition = "partial";
    await page.getByLabel("选择字幕 1", { exact: true }).check();
    await (await workspaceButton(page, '重新识别片段'))
      .click();
    await expect(page.getByLabel("同时翻译", { exact: true })).toHaveCount(0);
    await expect(page.locator(".reprocessing-panel__scope")).toContainText("1");
    await page
      .getByRole("button", { name: "识别并替换片段", exact: true })
      .click();
    await expect(page.getByTestId("segment-0")).toContainText(
      "Repaired source passage.",
    );
    const repaired = await job(page);
    expect(repaired.segments[0]).toMatchObject({ startMs: 100, endMs: 200 });
    expect(repaired.segments[0]?.id).not.toBe(original.segments[0]?.id);
    expect(repaired.segments.find((cue) => cue.id === untouched.id)).toEqual(
      untouched,
    );
    // An explicit interval intersects the second cue; replacement expands to 2–3.8s.
    await (await workspaceButton(page, '重新识别片段'))
      .click();
    await page.getByRole("button", { name: "起止时间", exact: true }).click();
    await page.getByLabel("片段开始（秒）", { exact: true }).fill("2.4");
    await page.getByLabel("片段结束（秒）", { exact: true }).fill("2.8");
    await expect(page.locator(".reprocessing-panel__scope")).toContainText(
      "00:02",
    );
    await expect(page.locator(".reprocessing-panel__scope")).toContainText(
      "00:03",
    );
    await page
      .getByRole("button", { name: "识别并替换片段", exact: true })
      .click();
    await expect
      .poll(async () => (await job(page)).segments[1]?.startMs)
      .toBe(2000);
    expect((await job(page)).segments[0]).toEqual(repaired.segments[0]);
    await (await jobSetting(page, 'AI 检查服务（可选）'))
      .selectOption({ label: "Recognition and review fixture" });
    const recognitionBeforeReview = mock.counters.recognition;
    await startSubtitleReview(page);
    await expect
      .poll(async () => (await job(page)).reviewReport?.findings.length)
      .toBe(2);
    expect(mock.counters.review).toBe(1);
    expect(mock.counters.recognition).toBe(recognitionBeforeReview);
    expect(mock.counters.translation).toBe(0);
    await selectReviewFilters(page, "medium");
    await page.getByRole("button", { name: "全选", exact: true }).click();
    await expect(page.getByLabel("选择字幕 1", { exact: true })).toBeChecked();
    await expect(page.getByLabel("选择字幕 2", { exact: true })).toBeChecked();
    await page
      .getByRole("button", { name: "重新识别选中", exact: true })
      .click();
    await expect(page.locator(".reprocessing-panel__scope")).toContainText(
      "2 条已有字幕",
    );
    await page
      .getByRole("button", { name: "识别并替换片段", exact: true })
      .click();
    await expect
      .poll(() => mock.counters.recognition)
      .toBe(recognitionBeforeReview + 2);
    await selectReviewFilters(page, "unchecked");
    await expect(page.locator(".review-finding--recheck")).toHaveCount(2);
    await startSubtitleReview(page);
    await expect.poll(() => mock.counters.review).toBe(2);
    await selectReviewFilters(page, "medium");
    await expect(page.locator(".review-finding--pending")).toHaveCount(2);
    const firstIssue = page.getByTestId("segment-0");
    await firstIssue
      .getByRole("button", { name: "定位播放", exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.currentTime),
      )
      .toBeGreaterThanOrEqual(0.1);
    await firstIssue.getByRole("button", { name: "忽略", exact: true }).click();
    await expect(page.locator(".subtitle-row")).toHaveCount(2);
    expect((await job(page)).reviewReport?.findings[0]?.status).toBe("ignored");
    await screenshot(page, "original-review-pending.png");
    await page
      .getByTestId("segment-1")
      .getByRole("button", { name: "重新识别", exact: true })
      .click();
    await expect(page.locator(".reprocessing-panel__scope")).toBeVisible();
    await page
      .getByRole("button", { name: "识别并替换片段", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await job(page)).reviewReport?.findings.some(
          (finding) => finding.status === "recheck",
        ),
      )
      .toBe(true);
    await selectReviewFilters(page, "unchecked");
    await expect(page.getByTestId("segment-1")).toContainText("需复查");
    await page
      .getByTestId("segment-1")
      .getByRole("button", { name: "复查", exact: true })
      .click();
    await selectReviewFilters(page, "medium");
    await expect(
      page.locator(".subtitle-row .review-finding--pending"),
    ).toHaveCount(1);
    await page
      .getByTestId("segment-1")
      .getByRole("button", { name: "忽略", exact: true })
      .click();
    await selectReviewFilters(page, "all");
    // Stored translations are preserved but cannot leak into source-mode display/export.
    await page.evaluate(async () => {
      const listed = await window.api.jobs.list();
      if (!listed.success || !listed.data[0]?.segments[0])
        throw new Error("Fixture cue absent");
      const current = listed.data[0];
      const cue = current.segments[0];
      if (!cue) throw new Error("Fixture cue absent");
      const result = await window.api.jobs.editSegment({
        jobId: current.id,
        revision: current.revision,
        segment: {
          ...cue,
          endMs: 1800,
          translatedText: "STORED TRANSLATION MUST STAY HIDDEN",
        },
      });
      if (!result.success) throw new Error(result.error);
    });
    await startSubtitleReview(page);
    await expect(page.locator(".review-finding--pending")).toHaveCount(2);
    await page
      .getByTestId("segment-0")
      .getByRole("button", { name: "忽略", exact: true })
      .click();
    await seek(page, 0.15);
    await expect(page.getByTestId("live-captions")).toHaveText(
      "Repaired source passage.",
    );
    await renderInternalReference(page, 800);
    const artifactDirectory = join(userData, "jobs", (await job(page)).id);
    const previewName = (await readdir(artifactDirectory)).find(
      (name) => name.startsWith("preview-") && name.endsWith(".png"),
    );
    if (!previewName) throw new Error("Actual libass reference image missing");
    const referencePath = join(artifactDirectory, previewName);
    for (const format of formats) await exportFormat(page, format);
    for (const output of outputs.slice(0, 3)) {
      const text = await readFile(output, "utf8");
      expect(text).toContain("Repaired source passage.");
      expect(text).not.toContain("STORED TRANSLATION");
    }
    for (const output of outputs.slice(3)) {
      expect((await inspectVideo(output)).subtitles).toBe(0);
      expect(await frameDifference(source, output)).toBeGreaterThan(0.1);
      await assertReferenceParity(referencePath, output);
    }
    expect(mock.counters.translation).toBe(0);
    expect(
      createHash("sha256")
        .update(await readFile(source))
        .digest("hex"),
    ).toBe(sourceHash);
    await expect(page.locator('.secondary-controls')).toHaveCount(0);
    await page.getByRole("button", { name: "收起侧边栏", exact: true }).click();
    await app.close();
    app = undefined;
    const next = await launchApp(userData, [], []);
    app = next.app;
    await expect(
      next.page.getByRole("button", { name: "展开侧边栏", exact: true }),
    ).toBeVisible();
    await expect(
      next.page.getByRole("button", { name: /生成、样式与导出/ }),
    ).toHaveCount(0);
    await expect(
      next.page.getByRole("button", { name: "添加字幕", exact: true }),
    ).toBeVisible();
    const persisted = await job(next.page);
    expect(persisted.options.translationEnabled).toBe(false);
    expect(
      persisted.reviewReport?.findings.some(
        (finding) => finding.status === "ignored",
      ),
    ).toBe(true);
    expect(persisted.segments[0]?.translatedText).toBe(
      "STORED TRANSLATION MUST STAY HIDDEN",
    );
    await mkdir(evidence, { recursive: true });
    const mediaEvidence = join(evidence, "source-only-proof");
    await mkdir(mediaEvidence, { recursive: true });
    const preservedOutputs = outputs.map((output) =>
      join(mediaEvidence, basename(output)),
    );
    await Promise.all(
      outputs.map((output, index) => {
        const destination = preservedOutputs[index];
        if (!destination)
          throw new Error("Output evidence destination missing");
        return copyFile(output, destination);
      }),
    );
    await copyFile(source, join(mediaEvidence, "anonymous-source.mp4"));
    await copyFile(referencePath, join(mediaEvidence, "libass-reference.png"));
    await writeFile(
      join(evidence, "source-only-workflow.json"),
      JSON.stringify(
        {
          provider:
            "Deterministic loopback HTTP ASR/text responses; real Electron IPC and FFmpeg crop, no paid API",
          counters: mock.counters,
          originalSourceHash: sourceHash,
          sourceUnchanged: true,
          outputs: preservedOutputs,
          assertions: [
            "cancelled import creates no job",
            "explicit source mode requires no translation profile",
            "windowed and native fullscreen source captions",
            "selected and expanded time-range replacement retains other cues",
            "AI review makes no ASR/translation calls",
            "ignore persists and filters pending list",
            "stored translations hidden from source-mode text exports",
            "sidebar preference survives process restart",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await app?.close();
    await mock.close();
  }
});

for (const orientation of ["portrait", "landscape"] as const) {
  test(`fixed preview/proofreading workspace survives default/minimum/large native windows, ${orientation} media, banners and long inline forms`, async ({
    playwright: _p,
  }, info) => {
    test.setTimeout(240_000);
    const mock = await startMockServer();
    const portrait = info.outputPath(
      `${"Long title 字幕工作区 ".repeat(5)}${orientation}.mp4`,
    );
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
        `color=c=0x294060:s=${orientation === "portrait" ? "360x640" : "640x360"}:r=25`,
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=500:sample_rate=16000:duration=4",
        "-t",
        "4",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        portrait,
      ],
      { windowsHide: true },
    );
    const { app, page } = await launchApp(
      info.outputPath("layout-data"),
      [portrait],
      [],
    );
    try {
      await importVideo(page, false);
      await page.evaluate(async () => {
        const listed = await window.api.jobs.list();
        if (!listed.success || !listed.data[0])
          throw new Error("Fixture absent");
        let current = listed.data[0];
        for (let index = 0; index < 25; index++) {
          const result = await window.api.jobs.addSegment({
            jobId: current.id,
            revision: current.revision,
            segment: {
              startMs: index * 140,
              endMs: index * 140 + 100,
              sourceText: `Anonymous long subtitle ${index + 1}: ${"校对文本 ".repeat(10)}`,
            },
          });
          if (!result.success) throw new Error(result.error);
          current = result.data;
        }
      });
      await expect(page.locator(".subtitle-row")).toHaveCount(25);
      await addProfile(page, "Layout review fixture", "openai", mock.url);
      await setCloud(page, "Layout review fixture");
      await (await jobSetting(page, 'AI 检查服务（可选）'))
        .selectOption({ label: "Layout review fixture" });
      mock.behavior.review = "graded";
      await startSubtitleReview(page);
      await expect(page.locator(".review-summary")).toBeVisible();
      await expect(page.locator(".processing-strip")).not.toBeVisible();
      mock.behavior.review = "slow";
      await startSubtitleReview(page);
      await expect.poll(() => mock.counters.review).toBe(2);
      await page
        .getByRole("button", { name: "取消当前处理", exact: true })
        .click();
      await expect(page.locator(".banner--error")).toContainText("CANCELLED");
      expect((await job(page)).segments).toHaveLength(25);
      expect((await job(page)).reviewReport).toBeDefined();
      await expect(page.locator(".review-summary")).toBeVisible();
      await page.getByLabel("选择字幕 1", { exact: true }).check();
      for (const dimensions of [
        { width: 1440, height: 960 },
        { width: 1050, height: 700 },
        { width: 1920, height: 1080 },
      ]) {
        await app.evaluate(({ BrowserWindow }, size) => {
          const window = BrowserWindow.getAllWindows()[0];
          if (!window) throw new Error("Native window absent");
          window.setSize(size.width, size.height);
        }, dimensions);
        for (const collapsed of [false, true]) {
          const toggleName = collapsed ? "收起侧边栏" : "展开侧边栏";
          const toggle = page.getByRole("button", {
            name: toggleName,
            exact: true,
          });
          if (await toggle.count()) await toggle.click();
          {
            const proofreadingBounds = await page
              .locator(".subtitle-panel")
              .boundingBox();
            await page.locator('.sidebar__footer').getByRole('button', { name: '生成设置', exact: true }).click();
            await expect(page.getByRole('dialog', { name: '生成设置', exact: true })).toBeVisible();
            await closeWorkspaceSettings(page);
            await expect(page.locator('.secondary-controls')).toHaveCount(0);
            expect(await page.locator(".subtitle-panel").boundingBox()).toEqual(
              proofreadingBounds,
            );
            await fixedWorkspace(page);
            const before = await page.locator("video").boundingBox();
            await page.locator(".subtitle-list").hover();
            await page.mouse.wheel(0, 800);
            await expect
              .poll(() =>
                page
                  .locator(".subtitle-list")
                  .evaluate((node) => node.scrollTop),
              )
              .toBeGreaterThan(100);
            expect(await page.locator("video").boundingBox()).toEqual(before);
            expect(await page.evaluate(() => window.scrollY)).toBe(0);
            await (await workspaceButton(page, '添加画面字幕'))
              .click();
            await page
              .getByLabel("原文", { exact: true })
              .fill("Long inline editor\n".repeat(100));
            await page
              .getByLabel("结束时间（秒）", { exact: true })
              .fill("4.001");
            await page
              .getByRole("button", { name: "保存字幕", exact: true })
              .click();
            await expect(
              page.locator(".segment-editor").getByRole("alert"),
            ).toBeVisible();
            await fixedWorkspace(page);
            await screenshot(
              page,
              `layout-${dimensions.width}x${dimensions.height}-${collapsed ? "collapsed" : "expanded"}-${orientation}-inline.png`,
            );
            await page.getByLabel("原文", { exact: true }).focus();
            await page.keyboard.press("Control+A");
            await page.keyboard.press("Control+C");
            await page.keyboard.press("End");
            await page.keyboard.press("Control+V");
            await expect(page.getByLabel("原文", { exact: true })).toHaveValue(
              "Long inline editor\n".repeat(200),
            );
            await page
              .getByRole("button", { name: "取消", exact: true })
              .click();
            await (await workspaceButton(page, '重新识别片段'))
              .click();
            await page
              .getByRole("button", { name: "起止时间", exact: true })
              .click();
            await page
              .getByLabel("片段开始（秒）", { exact: true })
              .fill("3.85");
            await page
              .getByLabel("片段结束（秒）", { exact: true })
              .fill("3.95");
            const plan = page.locator(".reprocessing-panel__scope");
            await expect(plan).toContainText("0 条已有字幕");
            await plan.scrollIntoViewIfNeeded();
            await fixedWorkspace(page);
            const executeButton = page.getByRole("button", {
              name: "识别并替换片段",
              exact: true,
            });
            await expect(executeButton).toBeEnabled();
            await executeButton.scrollIntoViewIfNeeded();
            const actionBounds = await executeButton.boundingBox();
            const panelBounds = await page
              .locator(".reprocessing-panel")
              .boundingBox();
            if (!actionBounds || !panelBounds)
              throw new Error("Partial action or local panel missing");
            expect(actionBounds.y).toBeGreaterThanOrEqual(panelBounds.y);
            expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(
              panelBounds.y + panelBounds.height + 1,
            );
            expect(await page.evaluate(() => window.scrollY)).toBe(0);
            await screenshot(
              page,
              `layout-${dimensions.width}x${dimensions.height}-${collapsed ? "collapsed" : "expanded"}-${orientation}-reprocess.png`,
            );
            await page.getByLabel("关闭分段处理", { exact: true }).click();
            await page.locator(".subtitle-list").evaluate((node) => {
              node.scrollTop = 0;
            });
          }
        }
      }
      await page.keyboard.press("Alt");
      expect(
        await app.evaluate(({ Menu, BrowserWindow }) => ({
          application: Menu.getApplicationMenu() === null,
          hidden:
            BrowserWindow.getAllWindows()[0]?.isMenuBarVisible() === false,
        })),
      ).toEqual({ application: true, hidden: true });
      await writeFile(
        join(evidence, `layout-and-native-menu-${orientation}.json`),
        JSON.stringify(
          {
            actualNativeWindowSizes: ["1440x960", "1050x700", "1920x1080"],
            bothSecondaryStates: true,
            orientation,
            longTitle: true,
            bothSidebarStates: true,
            fixedDocument: true,
            independentListScroll: true,
            longInlineForm: true,
            nativeMenuAbsentAfterAlt: true,
            standardSelectCopyPaste: true,
          },
          null,
          2,
        ),
      );
    } finally {
      await app.close();
      await mock.close();
    }
  });
}

test("local and URL import persist explicit translation choices and translation-enabled partial processing remains opt-in", async ({
  playwright: _p,
}, info) => {
  test.setTimeout(180_000);
  const source = info.outputPath("anonymous-imports.mp4");
  await makeVideo(source);
  const mock = await startMockServer();
  const downloads = await downloadFixture(
    info.outputPath("download-fixtures"),
    source,
  );
  const { app, page } = await launchApp(
    info.outputPath("import-modes-data"),
    [source],
    [],
    { APP_E2E_DOWNLOAD_MANIFEST: downloads.manifest },
  );
  try {
    await addProfile(page, "Translation fixture", "openai", mock.url);
    await importVideo(page, true);
    expect((await job(page)).options.translationEnabled).toBe(true);
    await setCloud(page, "Translation fixture");
    await (await jobSetting(page, '翻译服务'))
      .selectOption({ label: "Translation fixture" });
    await (await workspaceButton(page, '一键生成字幕'))
      .click();
    await expect(page.getByTestId("segment-0")).toContainText("你好，世界。");
    const before = await job(page);
    await page.getByLabel("选择字幕 1", { exact: true }).check();
    await (await workspaceButton(page, '重新翻译片段'))
      .click();
    await page
      .getByRole("button", { name: "翻译选定片段", exact: true })
      .click();
    await expect(page.getByTestId("segment-0")).toContainText("已重译");
    const translated = await job(page);
    expect(translated.segments[0]).toMatchObject({
      id: before.segments[0]?.id,
      startMs: before.segments[0]?.startMs,
      endMs: before.segments[0]?.endMs,
      sourceText: before.segments[0]?.sourceText,
    });
    expect(translated.segments[1]).toEqual(before.segments[1]);
    mock.behavior.recognition = "partial";
    await (await workspaceButton(page, '重新识别片段'))
      .click();
    await page.getByLabel("同时翻译", { exact: true }).check();
    await page
      .getByRole("button", { name: "识别并替换片段", exact: true })
      .click();
    await expect(page.getByTestId("segment-0")).toContainText(
      "已重译：Repaired source passage.",
    );
    expect(mock.counters.translation).toBe(3);
    await (await jobSetting(page, "翻译字幕")).click();
    await expect(
      (await jobSetting(page, "翻译字幕")),
    ).not.toBeChecked();
    await expect(page.getByTestId("segment-0")).not.toContainText("已重译");
    expect((await job(page)).segments[0]?.translatedText).toContain("已重译");
    expect(mock.counters.translation).toBe(3);
    await closeWorkspaceSettings(page);
    await page
      .getByRole("button", { name: "链接导入设置", exact: true })
      .click();
    await page
      .getByRole("button", { name: "一键安装下载工具", exact: true })
      .click();
    await expect(
      page.getByText("下载工具已安装并验证，可以导入视频链接。", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    for (const enabled of [false, true]) {
      await (await workspaceButton(page, '链接导入')).click();
      const dialog = page.getByRole("dialog", {
        name: "链接导入视频",
        exact: true,
      });
      await dialog.getByLabel("翻译字幕", { exact: true }).setChecked(enabled);
      await dialog
        .getByLabel("视频链接", { exact: true })
        .fill(`${downloads.url}/anonymous-${enabled}.mp4`);
      await dialog
        .getByRole("button", { name: "下载并导入", exact: true })
        .click();
      await expect(dialog).not.toBeVisible({ timeout: 30000 });
      expect((await job(page)).options.translationEnabled).toBe(enabled);
    }
    await mkdir(evidence, { recursive: true });
    await writeFile(
      join(evidence, "import-and-translation-modes.json"),
      JSON.stringify(
        {
          realNativeDownloader: true,
          loopbackProviders: true,
          paidRequests: 0,
          localImportTranslation: true,
          URLImportBothModes: true,
          selectedTranslationPreservesSourceTimingAndOtherCues: true,
          simultaneousTranslationOptIn: true,
          toggleRetainsTranslations: true,
          counters: mock.counters,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
    await downloads.close();
    await mock.close();
  }
});
