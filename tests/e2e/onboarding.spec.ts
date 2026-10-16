import { jobSetting, workspaceButton } from './helpers';
import { test, expect, type ElectronApplication, type Page, type Locator } from '@playwright/test';
import { join } from 'node:path';
import { ONBOARDING_STORAGE_KEY } from '../../src/renderer/src/lib/onboarding-preferences';
import { addProfile, importVideo, launchApp, makeVideo, startMockServer } from './helpers';

function guide(page: Page): Locator {
  return page.getByRole('dialog', { name: '功能导航', exact: true });
}

async function assertGuideFits(page: Page): Promise<void> {
  const dimensions = await guide(page).evaluate((dialog) => {
    const bounds = dialog.getBoundingClientRect();
    const footer = dialog.querySelector('footer')?.getBoundingClientRect();
    return {
      top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right,
      width: innerWidth, height: innerHeight, scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth,
      footerBottom: footer?.bottom, footerTop: footer?.top,
    };
  });
  expect(dimensions.top).toBeGreaterThanOrEqual(0);
  expect(dimensions.left).toBeGreaterThanOrEqual(0);
  expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.height);
  expect(dimensions.right).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.footerTop).toBeGreaterThan(dimensions.top);
  expect(dimensions.footerBottom).toBeLessThanOrEqual(dimensions.height);
}

test('fresh empty workspace has six readable steps, native keyboard containment and repeatable help', async ({ playwright: _playwright }, testInfo) => {
  const userData = testInfo.outputPath('fresh-empty');
  let app: ElectronApplication | undefined;
  try {
    const launched = await launchApp(userData, [], [], {}, { preserveGuide: true });
    app = launched.app;
    const page = launched.page;
    await expect(guide(page)).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), ONBOARDING_STORAGE_KEY)).toBeNull();
    expect(await page.evaluate(async () => {
      const result = await window.api.jobs.list();
      if (!result.success) throw new Error(result.error);
      return result.data.length;
    })).toBe(0);
    for (const size of [[1920, 1080], [1440, 960], [1050, 700]]) {
      const [width, height] = size;
      if (width === undefined || height === undefined) throw new Error('Missing fixture dimensions');
      await app.evaluate(({ BrowserWindow }, bounds) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) throw new Error('Missing native window');
        window.setSize(bounds.width, bounds.height);
      }, { width, height });
      for (let step = 1; step <= 6; step++) {
        await expect(guide(page).getByRole('status')).toContainText(`第 ${step} / 6 步`);
        await assertGuideFits(page);
        if (step === 5) await page.screenshot({ path: testInfo.outputPath(`guide-loop-${width}x${height}.png`) });
        if (step < 6) await guide(page).getByRole('button', { name: '下一步', exact: true }).click();
      }
      for (let step = 6; step > 1; step--) await guide(page).getByRole('button', { name: '上一步', exact: true }).click();
    }
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let index = 0; index < 12; index++) {
        await page.keyboard.press(key);
        expect(await guide(page).evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
      }
    }
    await page.keyboard.press('Escape');
    await expect(guide(page)).not.toBeVisible();
    for (const [width, height] of [[1920, 1080], [1440, 960], [1050, 700]] as const) {
      await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0]?.setSize(bounds.width, bounds.height), { width, height });
      for (const collapsed of [false, true]) {
        if (collapsed) await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
        const utilities = page.getByRole('navigation', { name: '工作区快捷操作' });
        await expect(utilities.getByRole('button')).toHaveCount(3);
        for (const label of ['功能导航', '重置布局', collapsed ? '展开侧边栏' : '收起侧边栏']) {
          const action = utilities.getByRole('button', { name: label, exact: true });
          expect(await action.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const sidebar = node.closest('.sidebar')?.getBoundingClientRect();
            const firstImport = document.querySelector('.sidebar__import')?.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return Boolean(sidebar && firstImport && rect.width >= 28 && rect.height >= 28 && rect.left >= sidebar.left && rect.right <= sidebar.right && rect.top >= 0 && rect.bottom <= firstImport.top && hit && node.contains(hit) && node.querySelector('svg[aria-hidden="true"]'));
          }), `${label} is an accessible icon control in the upper-left cluster at ${width}×${height}`).toBe(true);
          await action.focus();
          await expect(action).toBeFocused();
        }
        await expect(page.locator('.sidebar__footer').getByRole('button', { name: /功能导航|重置布局/ })).toHaveCount(0);
        if (collapsed) await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
      }
      await page.screenshot({ path: testInfo.outputPath(`sidebar-utilities-${width}x${height}.png`) });
    }
    await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
    const help = page.getByRole('button', { name: '功能导航', exact: true });
    await help.click();
    await expect(guide(page).getByRole('status')).toContainText('第 1 / 6 步');
    await guide(page).getByRole('button', { name: '下一步', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(help).toBeFocused();
    await help.click();
    await expect(guide(page).getByRole('status')).toContainText('第 1 / 6 步');
    await guide(page).getByRole('button', { name: '稍后再看', exact: true }).click();
  } finally { await app?.close(); }
});

for (const dismissal of ['close', 'escape', 'later', 'finish'] as const) {
  test(`first-run ${dismissal} dismissal persists through native restart`, async ({ playwright: _playwright }, testInfo) => {
    const userData = testInfo.outputPath(`remember-${dismissal}`);
    let app: ElectronApplication | undefined;
    try {
      let launched = await launchApp(userData, [], [], {}, { preserveGuide: true });
      app = launched.app;
      const page = launched.page;
      await expect(guide(page)).toBeVisible();
      if (dismissal === 'escape') await page.keyboard.press('Escape');
      else if (dismissal === 'finish') {
        for (let index = 0; index < 5; index++) await guide(page).getByRole('button', { name: '下一步', exact: true }).click();
        await guide(page).getByRole('button', { name: '完成', exact: true }).click();
      } else await guide(page).getByRole('button', { name: dismissal === 'close' ? '关闭对话框' : '稍后再看', exact: true }).click();
      await expect(guide(page)).not.toBeVisible();
      expect(await page.evaluate((key) => localStorage.getItem(key), ONBOARDING_STORAGE_KEY)).toBe('seen');
      await app.close();
      app = undefined;
      launched = await launchApp(userData, [], [], {}, { preserveGuide: true });
      app = launched.app;
      await expect(launched.page.locator('[data-onboarding-state]')).toHaveAttribute('data-onboarding-state', 'settled');
      await expect(guide(launched.page)).not.toBeVisible();
      await launched.page.getByRole('button', { name: '功能导航', exact: true }).click();
      await expect(guide(launched.page).getByRole('status')).toContainText('第 1 / 6 步');
    } finally { await app?.close(); }
  });
}

test('saved-project first-run and manual help preserve content and an active AI review', async ({ playwright: _playwright }, testInfo) => {
  const userData = testInfo.outputPath('saved-project');
  const video = join(testInfo.outputPath(), 'anonymous-guide.mp4');
  await makeVideo(video);
  const mock = await startMockServer();
  let app: ElectronApplication | undefined;
  try {
    let launched = await launchApp(userData, [video], []);
    app = launched.app;
    await importVideo(launched.page, false);
    await launched.page.evaluate(async () => {
      const listed = await window.api.jobs.list();
      if (!listed.success || !listed.data[0]) throw new Error('Missing isolated project');
      const job = listed.data[0];
      const added = await window.api.jobs.addSegment({ jobId: job.id, revision: job.revision,
        segment: { startMs: 100, endMs: 1800, sourceText: 'Guide preserves this source text.' } });
      if (!added.success) throw new Error(added.error);
    });
    await addProfile(launched.page, 'Guide fixture', 'openai', mock.url);
    await (await jobSetting(launched.page, 'AI 检查服务（可选）')).selectOption({ label: 'Guide fixture' });
    const before = await launched.page.evaluate(async (key) => {
      // Simulate an existing project upgrading from a version without the guide preference.
      localStorage.removeItem(key);
      const listed = await window.api.jobs.list();
      if (!listed.success || !listed.data[0]) throw new Error('Missing isolated project');
      return listed.data[0];
    }, ONBOARDING_STORAGE_KEY);
    await app.close();
    app = undefined;
    launched = await launchApp(userData, [], [], {}, { preserveGuide: true });
    app = launched.app;
    const page = launched.page;
    await expect(guide(page)).toBeVisible();
    await guide(page).getByRole('button', { name: '稍后再看', exact: true }).click();
    const after = await page.evaluate(async () => {
      const result = await window.api.jobs.list();
      if (!result.success || !result.data[0]) throw new Error('Missing saved project');
      return result.data[0];
    });
    expect(after).toEqual(before);
    await expect(page.locator('.subtitle-row')).toHaveCount(1);
    mock.behavior.review = 'slow';
    await (await workspaceButton(page, 'AI 检查字幕')).click();
    await page.getByRole('dialog', { name: 'AI 检查范围', exact: true }).getByRole('button', { name: '开始检查', exact: true }).click();
    await expect.poll(() => mock.counters.review).toBe(1);
    const calls = { ...mock.counters };
    await page.getByRole('button', { name: '功能导航', exact: true }).click();
    await expect(guide(page)).toBeVisible();
    await guide(page).getByRole('button', { name: '下一步', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect((await workspaceButton(page, 'AI 检查字幕'))).toBeDisabled();
    expect(mock.counters).toEqual(calls);
    const during = await page.evaluate(async () => {
      const result = await window.api.jobs.list();
      if (!result.success || !result.data[0]) throw new Error('Missing active project');
      return result.data[0];
    });
    expect(during.segments).toEqual(before.segments);
    expect(during.options).toEqual(before.options);
    await page.getByRole('button', { name: '取消当前处理', exact: true }).click();
    await expect((await workspaceButton(page, 'AI 检查字幕'))).toBeEnabled();
  } finally { await app?.close(); await mock.close(); }
});
