import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { addProfile, configureCloud, importVideo, launchApp, makeVideo, startMockServer, workspaceButton, closeWorkspaceSettings, jobSetting } from './helpers';

async function visibleAction(page: Page, action: Locator): Promise<void> {
  await expect(action).toBeVisible();
  const bounds = await action.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const parent = node.closest('.operation-panel, .reprocessing-panel, .preview-editor, dialog');
    if (!parent) throw new Error('Action must belong to a bounded operation');
    const clip = parent.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, clipTop: clip.top, clipBottom: clip.bottom, clipLeft: clip.left, clipRight: clip.right, hit: Boolean(hit && (hit === node || node.contains(hit))), scrollTop: parent.scrollTop };
  });
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(bounds.top).toBeGreaterThanOrEqual(Math.max(0, bounds.clipTop));
  expect(bounds.bottom).toBeLessThanOrEqual(Math.min(viewport.height, bounds.clipBottom) + 1);
  expect(bounds.left).toBeGreaterThanOrEqual(bounds.clipLeft);
  expect(bounds.right).toBeLessThanOrEqual(Math.min(viewport.width, bounds.clipRight) + 1);
  expect(bounds.hit).toBe(true);
  expect(bounds.scrollTop, 'Opening an operation should require no form scrolling').toBe(0);
}

test('each operation has two columns and visible actions at default and minimum native sizes', async ({ playwright: _playwright }, info) => {
  test.setTimeout(120000);
  const mock = await startMockServer();
  const input = info.outputPath('operations.mp4'); await makeVideo(input);
  const { app, page } = await launchApp(info.outputPath('operation-user-data'), [input], []);
  const evidence = resolve('.native-smoke/layout-controls/evidence');
  await mkdir(evidence, { recursive: true });
  try {
    await addProfile(page, 'Operation fixture', 'openai', mock.url);
    await importVideo(page); await configureCloud(page, 'Operation fixture');
    await (await jobSetting(page, 'AI 样式服务（可选）')).selectOption({ label: 'Operation fixture' });
    await (await jobSetting(page, 'AI 检查服务（可选）')).selectOption({ label: 'Operation fixture' });
    await (await workspaceButton(page, '一键生成字幕')).click();
    await expect(page.getByTestId('segment-1')).toBeVisible();
    // A long list proves Standards remains available when the cue scroller is at its bottom.
    await page.evaluate(async () => {
      const saved = await window.api.jobs.list(); if (!saved.success || !saved.data[0]) throw new Error('Job absent');
      let job = saved.data[0];
      for (let index = 0; index < 28; index++) { const result = await window.api.jobs.addSegment({ jobId: job.id, revision: job.revision, segment: { startMs: 2000, endMs: 3000, sourceText: `Long list ${index}`, translatedText: `较长字幕 ${index}` } }); if (!result.success) throw new Error(result.error); job = result.data; }
    });
    // UI reload reads the isolated job rather than mutating renderer state.
    await page.reload(); await expect(page.getByTestId('segment-29')).toBeAttached();
    for (const [width, height] of [[1440, 960], [1050, 700]] as const) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height), { width, height });
      await page.getByRole('button', { name: '重置布局', exact: true }).click();
      const toolbar = page.getByRole('toolbar', { name: '视频操作' });
      expect(await toolbar.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim()))).toEqual(['生成', '重新识别片段', '重新翻译片段', '添加画面字幕', '人名检查', '样式', '导出作品']);
      expect(await toolbar.getByRole('button').evaluateAll((buttons) => buttons.every((button) => button.querySelector('svg[aria-hidden="true"]')))).toBe(true);
      for (const operation of [
        { label: '生成', panel: '.operation-panel', grid: '.operation-panel__grid', primary: '翻译全部字幕', cancel: '取消' },
        { label: '重新识别片段', panel: '.reprocessing-panel', grid: '.reprocessing-panel', primary: '识别并替换片段', cancel: '取消' },
        { label: '重新翻译片段', panel: '.reprocessing-panel', grid: '.reprocessing-panel', primary: '翻译选定片段', cancel: '取消' },
        { label: '添加画面字幕', panel: '.preview-editor', grid: '.segment-editor form', primary: '保存字幕', cancel: '取消' },
        { label: '样式', panel: '.operation-panel', grid: '.operation-panel__grid', primary: '生成 AI 样式', cancel: '取消' },
        { label: '导出作品', panel: '.operation-panel', grid: '.operation-panel__grid', primary: '选择保存位置并导出', cancel: '返回工作区' },
        { label: '人名检查', panel: '.operation-panel', grid: '.person-names__overview', primary: 'AI 检查人名', cancel: '取消人名修改' },
      ]) {
        const counters = { ...mock.counters };
        await page.getByRole('toolbar', { name: '视频操作' }).getByRole('button', { name: operation.label, exact: true }).click();
        const panel = page.locator(operation.panel);
        await expect(panel).toBeVisible();
        if (operation.label === '导出作品') await expect(page.getByLabel('导出格式')).toBeEnabled();
        const grid = operation.grid === operation.panel ? panel : panel.locator(operation.grid);
        const columns = await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);
        expect(columns).toBe(2);
        await visibleAction(page, panel.getByRole('button', { name: operation.primary, exact: true }));
        await visibleAction(page, panel.getByRole('button', { name: operation.cancel, exact: true }));
        if (operation.label === '导出作品') {
          for (const label of ['导出格式', '视频编码', '导出分辨率', '画质']) await visibleAction(page, panel.getByLabel(label, { exact: true }));
        }
        if (operation.label === '添加画面字幕') {
          for (const label of ['开始时间（秒）', '结束时间（秒）', '原文', '译文']) await visibleAction(page, panel.getByLabel(label, { exact: true }));
        }
        if (operation.label === '重新识别片段' || operation.label === '重新翻译片段') {
          for (const label of ['片段开始（秒）', '片段结束（秒）']) await visibleAction(page, panel.getByLabel(label, { exact: true }));
        }
        if (operation.label === '样式') await visibleAction(page, panel.getByLabel('AI 设计描述', { exact: true }));
        expect(mock.counters).toEqual(counters);
        expect(await page.locator('video').evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(100);
        const stagesFit = await page.locator('.preview-panel > .section-heading').evaluate((node) => {
          const title = node.querySelector('h2')?.getBoundingClientRect();
          const clip = node.getBoundingClientRect();
          const stages = [...node.querySelectorAll('.stage-pill')];
          return Boolean(title && stages.length === 3 && stages.every((stage) => {
            const rect = stage.getBoundingClientRect();
            return rect.left >= title.right && rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1 && rect.right <= clip.right + 1;
          }));
        });
        expect(stagesFit, 'All stages stay on the preview title row to its right').toBe(true);
        await expect(page.locator('.preview-media .stage-strip')).toHaveCount(0);
        for (const label of ['功能导航', '重置布局']) {
          const action = page.locator('.sidebar__footer').getByRole('button', { name: label, exact: true });
          await expect(action).toBeVisible();
          expect(await action.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const clip = node.closest('.sidebar')?.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return Boolean(clip && rect.left >= clip.left && rect.right <= clip.right && rect.top >= 0 && rect.bottom <= innerHeight && hit && node.contains(hit));
          }), 'Footer controls stay inside the sidebar and are hit-testable').toBe(true);
        }
        await expect(page.locator('.workspace-header').getByRole('button')).toHaveCount(0);
        expect(await page.locator('.subtitle-list').evaluate((node) => node.clientHeight)).toBeGreaterThanOrEqual(75);
        await page.screenshot({ path: join(evidence, `operation-${width}-${operation.label}.png`) });
        await panel.getByRole('button', { name: operation.cancel, exact: true }).click();
      }
      const list = page.locator('.subtitle-list'); await list.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await page.getByRole('button', { name: '可疑度判断标准', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '可疑度判断标准', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      const placement = await page.evaluate(() => {
        const review = [...document.querySelectorAll('.subtitle-panel .section-heading button')];
        const follow = document.querySelector('.review-toolbar__follow');
        return { heading: review.map((node) => node.textContent?.trim()), standardsAfterFollow: follow?.nextElementSibling?.getAttribute('aria-label') };
      });
      expect(placement.heading).toEqual(['AI 检查字幕', '＋ 添加字幕']);
      expect(placement.standardsAfterFollow).toBe('可疑度判断标准');
      for (const label of ['生成设置', '样式设置']) {
        await page.locator('.sidebar__footer').getByRole('button', { name: label, exact: true }).click();
        const dialog = page.getByRole('dialog', { name: label, exact: true });
        expect(await dialog.locator('.settings-panel, .style-panel').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(2);
        await visibleAction(page, dialog.getByRole('button', { name: '返回工作区', exact: true }));
        for (let index = 0; index < 12; index++) {
          await page.keyboard.press('Tab');
          expect(await dialog.evaluate((node) => node.contains(document.activeElement)), 'Settings focus stays inside the modal').toBe(true);
        }
        await page.screenshot({ path: join(evidence, `settings-${width}-${label}.png`) });
        await closeWorkspaceSettings(page);
        await expect(page.locator('.sidebar__footer').getByRole('button', { name: label, exact: true })).toBeFocused();
      }
      await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
      const help = page.locator('.sidebar__footer').getByRole('button', { name: '功能导航', exact: true });
      await help.click();
      await expect(page.getByRole('dialog', { name: '功能导航', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(help).toBeFocused();
      const reset = page.locator('.sidebar__footer').getByRole('button', { name: '重置布局', exact: true });
      await reset.click();
      expect(await reset.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(rect.width > 0 && rect.height > 0 && rect.bottom <= innerHeight && hit && node.contains(hit));
      })).toBe(true);
      await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
    }
  } finally { await app.close(); await mock.close(); }
});
