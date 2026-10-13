import {
  test,
  expect,
  type Page,
  type ElectronApplication,
  type Locator,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Job } from "../../src/shared/contracts";
import {
  addProfile,
  importVideo,
  launchApp,
  makeVideo,
  startMockServer,
} from "./helpers";

async function currentJob(page: Page): Promise<Job> {
  return page.evaluate(async () => {
    const listed = await window.api.jobs.list();
    if (!listed.success || !listed.data[0])
      throw new Error("Isolated names fixture absent");
    return listed.data[0];
  });
}

async function seedNames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const listed = await window.api.jobs.list();
    if (!listed.success || !listed.data[0])
      throw new Error("Isolated names fixture absent");
    let job = listed.data[0];
    for (const cue of [
      {
        startMs: 100,
        endMs: 1000,
        sourceText: "Ann arrives.",
        translatedText: "安娜来了。",
      },
      {
        startMs: 1200,
        endMs: 2200,
        sourceText: "Hello, Ann.",
        translatedText: "你好，安娜。",
      },
      {
        startMs: 2500,
        endMs: 3500,
        sourceText: "Anna is another person.",
        translatedText: "另一位角色。",
      },
    ]) {
      const added = await window.api.jobs.addSegment({
        jobId: job.id,
        revision: job.revision,
        segment: cue,
      });
      if (!added.success) throw new Error(added.error);
      job = added.data;
    }
  });
  await expect(page.locator(".subtitle-row")).toHaveCount(3);
}

async function openNames(page: Page): Promise<Locator> {
  await page
    .getByRole("toolbar", { name: "视频操作" })
    .getByRole("button", { name: "人名检查", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "人名检查操作面板",
    exact: true,
  });
  await expect(panel).toBeVisible();
  return panel;
}

async function visibleWithoutScrolling(
  page: Page,
  action: Locator,
): Promise<void> {
  const geometry = await action.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const panel = node.closest(".operation-panel");
    if (!panel) throw new Error("Name action not in operation panel");
    const p = panel.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return {
      top: r.top,
      bottom: r.bottom,
      right: r.right,
      height: innerHeight,
      width: innerWidth,
      panelBottom: p.bottom,
      scrollTop: panel.scrollTop,
      hit: Boolean(hit && (hit === node || node.contains(hit))),
    };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(
    Math.min(geometry.height, geometry.panelBottom) + 1,
  );
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.scrollTop).toBe(0);
  expect(geometry.hit).toBe(true);
}

async function editCue(
  page: Page,
  index: number,
  source: string,
): Promise<void> {
  await page.getByLabel(`编辑字幕 ${index}`, { exact: true }).click();
  const editor = page.getByRole("region", { name: "校对字幕", exact: true });
  await editor.getByLabel("原文", { exact: true }).fill(source);
  await editor.getByRole("button", { name: "保存字幕", exact: true }).click();
  await expect(editor).not.toBeVisible();
}

test("names explicit service setup, recommendations, no-op/cancel, atomic edited apply, corrected export and restart-safe conflict undo", async ({
  playwright: _playwright,
}, info) => {
  test.setTimeout(180000);
  const mock = await startMockServer();
  const source = info.outputPath("names.mp4");
  const exported = info.outputPath("corrected-names.srt");
  const userData = info.outputPath("names-user-data");
  await makeVideo(source);
  let app: ElectronApplication | undefined;
  try {
    const launched = await launchApp(userData, [source], [exported]);
    app = launched.app;
    const page = launched.page;
    await importVideo(page);
    await seedNames(page);
    await addProfile(page, "Names fixture", "openai", mock.url);
    const original = await currentJob(page);
    let panel = await openNames(page);
    await panel
      .getByRole("button", { name: "AI 检查人名", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "选择 AI 检查服务",
      exact: true,
    });
    await expect(picker).toBeVisible();
    await expect(
      picker.getByRole("button", { name: "保存并检查人名", exact: true }),
    ).toBeDisabled();
    expect(mock.counters.names).toBe(0);
    await picker
      .getByLabel("AI 检查服务", { exact: true })
      .selectOption({ label: "Names fixture" });
    await picker
      .getByRole("button", { name: "保存并检查人名", exact: true })
      .click();
    await expect(panel.getByLabel("Anne 替换原名")).toHaveValue("Anne");
    await expect(panel.getByLabel("Anne 替换译名")).toHaveValue("安妮");
    expect(mock.counters.names).toBe(1);
    const analyzed = await currentJob(page);
    expect(analyzed.segments).toEqual(original.segments);
    expect(analyzed.nameReport?.candidates[0]?.cueCount).toBe(2);
    expect(analyzed.nameReport?.candidates[0]?.sourceCount).toBe(2);
    expect(analyzed.nameReport?.candidates[0]?.translatedCount).toBe(2);
    await panel.getByLabel("Anne 替换原名").fill("Unapplied draft");
    await panel
      .getByRole("button", { name: "取消人名修改", exact: true })
      .click();
    expect((await currentJob(page)).segments).toEqual(original.segments);
    panel = await openNames(page);
    // A deliberate no-op keeps the current content revision and does not create undo history.
    await panel.getByLabel("Anne 替换原名").fill("Ann");
    await panel.getByLabel("Anne 替换译名").fill("安娜");
    await panel
      .getByRole("button", { name: "应用选中人名", exact: true })
      .click();
    await expect
      .poll(async () => (await currentJob(page)).revision)
      .toBe(analyzed.revision);
    expect((await currentJob(page)).nameBatch).toBeUndefined();
    await expect(
      panel.getByRole("button", { name: "应用选中人名", exact: true }),
    ).toBeEnabled();
    await panel.getByLabel("Anne 替换原名").fill("Annie");
    await panel.getByLabel("Anne 替换译名").fill("安妮娅");
    for (const [width, height] of [
      [1440, 960],
      [1050, 700],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height),
        { width, height },
      );
      await page.getByRole("button", { name: "重置布局", exact: true }).click();
      await visibleWithoutScrolling(
        page,
        panel.getByRole("button", { name: "应用选中人名", exact: true }),
      );
      await visibleWithoutScrolling(
        page,
        panel.getByRole("button", { name: "取消人名修改", exact: true }),
      );
      await page.screenshot({
        path: info.outputPath(`names-ready-${width}.png`),
      });
    }
    await panel
      .getByRole("button", { name: "应用选中人名", exact: true })
      .click();
    await expect
      .poll(async () => (await currentJob(page)).nameBatch?.state)
      .toBe("available");
    const applied = await currentJob(page);
    expect(applied.revision).toBe(analyzed.revision + 1);
    expect(applied.segments.map((cue) => cue.sourceText)).toEqual([
      "Annie arrives.",
      "Hello, Annie.",
      original.segments[2]?.sourceText,
    ]);
    expect(applied.segments.map((cue) => cue.translatedText)).toEqual([
      "安妮娅来了。",
      "你好，安妮娅。",
      original.segments[2]?.translatedText,
    ]);
    expect(applied.style).toEqual(original.style);
    expect(
      applied.segments.map((cue) => [cue.id, cue.startMs, cue.endMs]),
    ).toEqual(original.segments.map((cue) => [cue.id, cue.startMs, cue.endMs]));
    expect(applied.segments[0]?.translationStale).toBe(true);
    await page
      .getByRole("toolbar", { name: "视频操作" })
      .getByRole("button", { name: "导出作品", exact: true })
      .click();
    await page.getByLabel("导出格式", { exact: true }).selectOption("srt");
    await page
      .getByRole("button", { name: "选择保存位置并导出", exact: true })
      .click();
    await expect
      .poll(async () => {
        try {
          return await readFile(exported, "utf8");
        } catch {
          return "";
        }
      })
      .toContain("安妮娅");
    await editCue(page, 3, "Later unrelated manual edit.");
    await editCue(page, 1, "Annie with later manual correction.");
    await app.close();
    app = undefined;
    const restarted = await launchApp(userData, [], []);
    app = restarted.app;
    panel = await openNames(restarted.page);
    await panel
      .getByRole("button", { name: "撤销上次人名修改", exact: true })
      .click();
    await expect
      .poll(async () => (await currentJob(restarted.page)).nameBatch?.state)
      .toBe("consumed");
    const undone = await currentJob(restarted.page);
    expect(undone.segments.map((cue) => cue.sourceText)).toEqual([
      "Annie with later manual correction.",
      "Hello, Ann.",
      "Later unrelated manual edit.",
    ]);
    expect(undone.segments.map((cue) => cue.translatedText)).toEqual(
      original.segments.map((cue) => cue.translatedText),
    );
    expect(undone.nameBatch?.undo?.restoredFields).toBe(3);
    expect(undone.nameBatch?.undo?.skippedFields).toBe(1);
    await expect(panel).toContainText("保留 1 个发生后续修改");
    await panel.getByText("查看未回退条目（1）", { exact: true }).click();
    await expect(panel).toContainText("后续已修改，保留当前值");
    await expect(
      panel.getByRole("button", { name: "撤销上次人名修改", exact: true }),
    ).toHaveCount(0);
    await restarted.page.screenshot({
      path: info.outputPath("names-restart-conflict-undo.png"),
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1050, 700));
    await restarted.page.getByRole('button', { name: '重置布局', exact: true }).click();
    await visibleWithoutScrolling(restarted.page, panel.getByRole('button', { name: '取消人名修改', exact: true }));
    await visibleWithoutScrolling(restarted.page, panel.getByRole('button', { name: '应用选中人名', exact: true }));
    await restarted.page.screenshot({ path: info.outputPath('names-restart-conflict-undo-minimum.png') });
    await panel.getByText('查看上次人名检查结果', { exact: true }).click();
    await visibleWithoutScrolling(restarted.page, panel.getByRole('button', { name: '取消人名修改', exact: true }));
    await visibleWithoutScrolling(restarted.page, panel.getByRole('button', { name: '应用选中人名', exact: true }));
    await restarted.page.screenshot({ path: info.outputPath('names-restart-conflict-undo-history-minimum.png') });
    expect(mock.counters.names).toBe(1);
    expect(mock.counters.recognition).toBe(0);
    expect(mock.counters.translation).toBe(0);
  } finally {
    if (app) await app.close();
    await mock.close();
  }
});

test("source-only names omit stored translations and cancel held analysis without replacing the previous report", async ({
  playwright: _playwright,
}, info) => {
  const mock = await startMockServer();
  const source = info.outputPath("source-only-names.mp4");
  await makeVideo(source);
  const { app, page } = await launchApp(
    info.outputPath("source-only-names-data"),
    [source],
    [],
  );
  try {
    await importVideo(page, false);
    await seedNames(page);
    await addProfile(page, "Source names fixture", "openai", mock.url);
    const original = await currentJob(page);
    const panel = await openNames(page);
    await panel
      .getByRole("button", { name: "AI 检查人名", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "选择 AI 检查服务",
      exact: true,
    });
    await picker
      .getByLabel("AI 检查服务", { exact: true })
      .selectOption({ label: "Source names fixture" });
    await picker
      .getByRole("button", { name: "保存并检查人名", exact: true })
      .click();
    await expect(panel.getByLabel("Anne 替换原名")).toHaveValue("Anne");
    await expect(panel.getByLabel("Anne 替换译名")).toHaveCount(0);
    expect(mock.namePrompts[0]).not.toContain("安娜");
    expect(mock.namePrompts[0]).not.toContain("translatedText");
    await panel
      .getByRole("button", { name: "应用选中人名", exact: true })
      .click();
    await expect
      .poll(async () => (await currentJob(page)).nameBatch?.state)
      .toBe("available");
    expect(
      (await currentJob(page)).segments.map((cue) => cue.translatedText),
    ).toEqual(original.segments.map((cue) => cue.translatedText));
    // Hold a real HTTP request and cancel through the rendered operation control.
    const previousReport = (await currentJob(page)).nameReport;
    mock.behavior.names = "slow";
    await panel
      .getByRole("button", { name: "重新检查人名", exact: true })
      .click();
    await expect.poll(() => mock.counters.names).toBe(2);
    await panel
      .getByRole("button", { name: "取消人名检查", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "重新检查人名", exact: true }),
    ).toBeEnabled();
    expect((await currentJob(page)).nameReport).toEqual(previousReport);
    await panel
      .getByRole("button", { name: "撤销上次人名修改", exact: true })
      .click();
    await expect
      .poll(async () => (await currentJob(page)).nameBatch?.state)
      .toBe("consumed");
    expect(
      (await currentJob(page)).segments.map((cue) => cue.sourceText),
    ).toEqual(original.segments.map((cue) => cue.sourceText));
    expect(mock.counters.translation).toBe(0);
    expect(mock.counters.recognition).toBe(0);
  } finally {
    await app.close();
    await mock.close();
  }
});
