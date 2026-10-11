import {
  test,
  expect,
  type Page,
  type ElectronApplication,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  addProfile,
  configureCloud,
  expandSecondaryControls,
  importVideo,
  launchApp,
  makeVideo,
  startMockServer,
} from "./helpers";

const evidence = resolve(
  ".trellis/tasks/10-11-subtitle-workspace-layout/evidence",
);
const preferenceKey = "slice-man.layout";

async function assertBrand(
  page: Page,
  app: ElectronApplication,
): Promise<void> {
  await expect(page).toHaveTitle("Slice Man");
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getTitle(),
    ),
  ).toBe("Slice Man");
  await expect(page.locator(".workspace-header .eyebrow")).toHaveText(
    "Slice Man",
  );
}

async function drag(page: Page, label: string, delta: number): Promise<void> {
  const separator = page.getByRole("separator", { name: label, exact: true });
  const bounds = await separator.boundingBox();
  if (!bounds) throw new Error(`Missing separator: ${label}`);
  const vertical =
    (await separator.getAttribute("aria-orientation")) === "vertical";
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(
    x + (vertical ? delta : 0),
    y + (vertical ? 0 : delta),
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.locator("body")).not.toHaveClass(/pane-dragging/);
}

async function assertWorkspace(page: Page): Promise<void> {
  await expect(async () => {
    const sizes = await page.evaluate(() => {
      const bounds = (
        selector: string,
      ): Pick<DOMRect, "x" | "y" | "width" | "height" | "bottom" | "right"> => {
        const node = document.querySelector(selector);
        if (!node) throw new Error(`Missing region ${selector}`);
        const rect = node.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
          right: rect.right,
        };
      };
      const list = document.querySelector(".subtitle-list");
      const editor = document.querySelector(
        ".preview-editor, .reprocessing-panel",
      );
      return {
        width: innerWidth,
        height: innerHeight,
        video: bounds("video"),
        preview: bounds(".preview-panel"),
        previewActions: [
          ...document.querySelectorAll(
            ".preview-tools button, .preview-panel > button",
          ),
        ].map((node) => {
          const rect = node.getBoundingClientRect();
          const target = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          return {
            label: node.textContent,
            x: rect.x,
            y: rect.y,
            right: rect.right,
            bottom: rect.bottom,
            hitTestable: target !== null && node.contains(target),
          };
        }),
        previewHints: [
          ...document.querySelectorAll(
            ".preview-panel > .hint, .preview-panel > .error-message",
          ),
        ]
          .filter((node) => node.getBoundingClientRect().height > 0)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return { bottom: rect.bottom, text: node.textContent };
          }),
        proofreading: bounds(".subtitle-panel"),
        list: bounds(".subtitle-list"),
        editorHeight: editor?.clientHeight,
        listOverflow: list ? list.scrollWidth - list.clientWidth : 0,
        controls: [
          ...document.querySelectorAll(
            ".preview-tools button, .subtitle-panel > .section-heading button, .review-toolbar select, .review-toolbar button, .subtitle-tools button, .subtitle-tools label",
          ),
        ].map((node) => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, right: rect.right, bottom: rect.bottom };
        }),
        bodyHeight: document.body.scrollHeight,
        scrollTop: scrollY,
      };
    });
    expect(sizes.preview.right).toBeLessThan(sizes.proofreading.x);
    expect(sizes.video.height).toBeGreaterThanOrEqual(108);
    expect(sizes.video.bottom).toBeLessThanOrEqual(sizes.preview.bottom);
    for (const action of sizes.previewActions) {
      expect(
        action.x,
        `${action.label} left preview bound`,
      ).toBeGreaterThanOrEqual(sizes.preview.x);
      expect(
        action.y,
        `${action.label} top preview bound`,
      ).toBeGreaterThanOrEqual(sizes.preview.y);
      expect(
        action.right,
        `${action.label} right preview bound`,
      ).toBeLessThanOrEqual(sizes.preview.right + 1);
      expect(
        action.bottom,
        `${action.label} bottom preview bound`,
      ).toBeLessThanOrEqual(sizes.preview.bottom + 1);
      expect(
        action.hitTestable,
        `${action.label} center must receive pointer input`,
      ).toBe(true);
    }
    for (const hint of sizes.previewHints)
      expect(
        hint.bottom,
        `${hint.text} must remain inside preview`,
      ).toBeLessThanOrEqual(sizes.preview.bottom + 1);
    expect(sizes.list.height).toBeGreaterThanOrEqual(75);
    expect(sizes.list.bottom).toBeLessThanOrEqual(
      sizes.proofreading.bottom + 1,
    );
    expect(sizes.listOverflow).toBeLessThanOrEqual(1);
    for (const control of sizes.controls) {
      expect(control.x).toBeGreaterThanOrEqual(0);
      expect(control.right).toBeLessThanOrEqual(sizes.width);
      expect(control.bottom).toBeLessThanOrEqual(sizes.height);
    }
    if (sizes.editorHeight !== undefined)
      expect(sizes.editorHeight).toBeGreaterThanOrEqual(80);
    expect(sizes.bodyHeight).toBeLessThanOrEqual(sizes.height + 1);
    expect(sizes.scrollTop).toBe(0);
  }).toPass({ timeout: 5000 });
}

test("pointer/keyboard pane resizing clamps real geometry, retains translated inline tools, survives restart and resets", async ({
  playwright: _p,
}, info) => {
  test.setTimeout(180_000);
  const source = info.outputPath("字幕布局 resize translated.mp4");
  await makeVideo(source);
  const mock = await startMockServer();
  const userData = info.outputPath("resize-data");
  let app: ElectronApplication | undefined;
  try {
    const first = await launchApp(userData, [source], []);
    app = first.app;
    let page = first.page;
    await expect(page).toHaveTitle("Slice Man");
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.getTitle(),
      ),
    ).toBe("Slice Man");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1050, 700),
    );
    await expect
      .poll(async () => (await page.locator(".sidebar").boundingBox())?.width)
      .toBe(184);
    await drag(page, "调整侧边栏宽度", 25);
    await expect
      .poll(async () => (await page.locator(".sidebar").boundingBox())?.width)
      .toBeGreaterThan(184);
    await page.getByRole("button", { name: "重置布局", exact: true }).click();
    await expect
      .poll(async () => (await page.locator(".sidebar").boundingBox())?.width)
      .toBe(184);
    await mkdir(evidence, { recursive: true });
    await page.screenshot({
      path: join(evidence, "resize-welcome-1050x700-reset.png"),
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 960),
    );
    await expect(page.locator(".workspace-header .eyebrow")).toBeVisible();
    await expect(page.locator(".workspace-header .eyebrow")).toHaveText(
      "Slice Man",
    );
    await addProfile(page, "Resize provider fixture", "openai", mock.url);
    await importVideo(page);
    await assertBrand(page, app);
    await configureCloud(page, "Resize provider fixture");
    await page
      .getByLabel("AI 检查服务（可选）", { exact: true })
      .selectOption({ label: "Resize provider fixture" });
    await page
      .getByRole("button", { name: "一键生成字幕", exact: true })
      .click();
    await expect(page.getByTestId("segment-0")).toContainText("你好，世界。");
    await expect(page.locator(".processing-strip")).not.toBeVisible();
    await page.screenshot({
      path: join(evidence, "resize-default-workspace-brand.png"),
    });
    await page.getByLabel("双语字幕（译文 + 原文）", { exact: true }).click();
    await expect(
      page.getByLabel("双语字幕（译文 + 原文）", { exact: true }),
    ).toBeChecked();
    await page
      .getByRole("button", { name: "AI 检查字幕", exact: true })
      .click();
    await expect(page.locator(".review-summary")).toBeVisible();
    await expect(page.locator(".processing-strip")).not.toBeVisible();
    await page.getByLabel("选择字幕 1", { exact: true }).check();
    const labels = [
      "调整侧边栏宽度",
      "调整预览与校对区宽度",
      "调整预览与设置区高度",
    ];
    for (const size of [
      { width: 1440, height: 960 },
      { width: 1050, height: 700 },
      { width: 1920, height: 1080 },
    ]) {
      await app.evaluate(({ BrowserWindow }, dimensions) => {
        BrowserWindow.getAllWindows()[0]?.setSize(
          dimensions.width,
          dimensions.height,
        );
      }, size);
      await page.getByRole("button", { name: "重置布局", exact: true }).click();
      await expandSecondaryControls(page);
      for (const [index, label] of labels.entries()) {
        const separator = page.getByRole("separator", {
          name: label,
          exact: true,
        });
        const before = Number(await separator.getAttribute("aria-valuenow"));
        await drag(page, label, index === 2 ? -25 : 25);
        await expect
          .poll(async () =>
            Number(await separator.getAttribute("aria-valuenow")),
          )
          .not.toBe(before);
        await assertWorkspace(page);
      }
      await page
        .getByRole("separator", { name: labels[2], exact: true })
        .press("Home");
      await mkdir(evidence, { recursive: true });
      await page.screenshot({
        path: join(
          evidence,
          `resize-${size.width}x${size.height}-secondary-home.png`,
        ),
      });
      await assertWorkspace(page);
      await page
        .locator("video")
        .evaluate((video) => video.dispatchEvent(new Event("error")));
      await expect(
        page.getByRole("button", { name: "重新加载视频预览", exact: true }),
      ).toBeVisible();
      await assertWorkspace(page);
      await page.screenshot({
        path: join(
          evidence,
          `resize-${size.width}x${size.height}-secondary-home-playback-error.png`,
        ),
      });
      await page
        .getByRole("button", { name: "重新加载视频预览", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "重新加载视频预览", exact: true }),
      ).toHaveCount(0);
      await assertWorkspace(page);
      const right = await page.locator(".subtitle-panel").boundingBox();
      await drag(page, labels[2] ?? "", -5000);
      expect(await page.locator(".subtitle-panel").boundingBox()).toEqual(
        right,
      );
      await assertWorkspace(page);
      await drag(page, labels[2] ?? "", 5000);
      await assertWorkspace(page);
      for (const label of labels.slice(0, 2)) {
        await drag(page, label, -5000);
        await assertWorkspace(page);
        await drag(page, label, 5000);
        await assertWorkspace(page);
      }
      await page
        .getByRole("separator", { name: labels[1], exact: true })
        .press("Home");
      await page
        .getByRole("button", { name: "添加画面字幕", exact: true })
        .click();
      await page
        .getByLabel("原文", { exact: true })
        .fill("Long translated edit\n".repeat(80));
      await page
        .getByLabel("译文", { exact: true })
        .fill("长双语校对表单\n".repeat(80));
      const inline = "调整预览与编辑区高度";
      await drag(page, inline, -5000);
      await assertWorkspace(page);
      await drag(page, inline, 5000);
      await assertWorkspace(page);
      await page
        .getByRole("button", { name: "保存字幕", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("button", { name: "保存字幕", exact: true }),
      ).toBeInViewport();
      await assertWorkspace(page);
      await mkdir(evidence, { recursive: true });
      await page.screenshot({
        path: join(
          evidence,
          `resize-${size.width}x${size.height}-translated-inline.png`,
        ),
      });
      await page
        .getByRole("button", { name: "重新识别片段", exact: true })
        .click();
      await expect(page.locator(".reprocessing-panel")).toBeVisible();
      await expect(page.locator(".preview-editor")).not.toBeVisible();
      await expect(
        page.getByRole("separator", { name: inline, exact: true }),
      ).toHaveCount(1);
      await assertWorkspace(page);
      await page.getByLabel("关闭分段处理", { exact: true }).click();
      await expect(page.locator(".preview-editor")).toBeVisible();
      await expect(page.getByLabel("原文", { exact: true })).toHaveValue(
        "Long translated edit\n".repeat(80),
      );
      await expect(page.getByLabel("译文", { exact: true })).toHaveValue(
        "长双语校对表单\n".repeat(80),
      );
      await assertWorkspace(page);
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await page
        .getByRole("button", { name: "重新识别片段", exact: true })
        .click();
      await drag(page, inline, -5000);
      await assertWorkspace(page);
      await drag(page, inline, 5000);
      await assertWorkspace(page);
      await page
        .getByRole("button", { name: "添加画面字幕", exact: true })
        .click();
      await expect(page.locator(".reprocessing-panel")).toHaveCount(0);
      await expect(page.locator(".preview-editor")).toBeVisible();
      await assertWorkspace(page);
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await page
        .getByRole("button", { name: "重新识别片段", exact: true })
        .click();
      await page.getByLabel("关闭分段处理", { exact: true }).click();
      const disclosure = page.getByRole("button", { name: /生成、样式与导出/ });
      await disclosure.click();
      await expect(
        page.getByRole("separator", { name: labels[2], exact: true }),
      ).not.toBeVisible();
      await page
        .getByRole("button", { name: "收起侧边栏", exact: true })
        .click();
      await expect(
        page.getByRole("separator", { name: labels[0], exact: true }),
      ).toHaveCount(0);
      await assertWorkspace(page);
      await page
        .getByRole("button", { name: "展开侧边栏", exact: true })
        .click();
      await disclosure.click();
    }
    const divider = page.getByRole("separator", {
      name: labels[1],
      exact: true,
    });
    await divider.press("Home");
    const low = Number(await divider.getAttribute("aria-valuenow"));
    await divider.press("ArrowRight");
    expect(Number(await divider.getAttribute("aria-valuenow"))).toBeGreaterThan(
      low,
    );
    await divider.press("End");
    await assertWorkspace(page);
    const stored = await page.evaluate(
      (key) => localStorage.getItem(key),
      preferenceKey,
    );
    const beforeCancel = await page.locator(".preview-panel").boundingBox();
    const bounds = await divider.boundingBox();
    if (!bounds) throw new Error("Divider absent");
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(bounds.x - 100, bounds.y + bounds.height / 2, {
      steps: 5,
    });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator("body")).not.toHaveClass(/pane-dragging/);
    await expect
      .poll(() => page.locator(".preview-panel").boundingBox())
      .toEqual(beforeCancel);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), preferenceKey),
    ).toBe(stored);
    await app.close();
    app = undefined;
    const restarted = await launchApp(userData, [], []);
    app = restarted.app;
    page = restarted.page;
    await assertBrand(page, app);
    await expect(
      page.getByRole("separator", { name: labels[1], exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), preferenceKey),
    ).toBe(stored);
    await assertWorkspace(page);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1050, 700),
    );
    await assertWorkspace(page);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), preferenceKey),
    ).toBe(stored);
    await page.getByRole("button", { name: "重置布局", exact: true }).click();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), preferenceKey),
    ).toBeNull();
    await assertWorkspace(page);
    const defaults = await page.locator(".preview-panel").boundingBox();
    const defaultRight = await page.locator(".subtitle-panel").boundingBox();
    expect(
      Math.abs((defaults?.width ?? 0) - (defaultRight?.width ?? 0)),
    ).toBeLessThan(2);
  } finally {
    await app?.close();
    await mock.close();
  }
});
