import { jobSetting, closeWorkspaceSettings } from './helpers';
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import type { Job } from '../../src/shared/contracts';
import { addProfile, expandSecondaryControls, importVideo, launchApp, makeVideo, startMockServer } from './helpers';

async function currentJob(page: Page): Promise<Job> {
  return page.evaluate(async () => { const result = await window.api.jobs.list(); if (!result.success || !result.data[0]) throw new Error('Repair fixture missing'); return result.data[0]; });
}
async function controlGeometry(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const node = document.querySelector('.subtitle-list'); const controls = document.querySelector('.repair-loop'); const panel = document.querySelector('.subtitle-panel');
    if (!node || !controls || !panel) throw new Error('Repair geometry missing');
    return { list: node.getBoundingClientRect().toJSON(), controls: controls.getBoundingClientRect().toJSON(), panel: panel.getBoundingClientRect().toJSON(), viewport: innerHeight, body: document.body.scrollHeight };
  });
  expect(geometry.list.height).toBeGreaterThan(70);
  expect(geometry.list.bottom).toBeLessThanOrEqual(geometry.panel.bottom + 1);
  expect(geometry.controls.bottom).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.body).toBeLessThanOrEqual(geometry.viewport + 1);
  await expect(page.getByRole('button', { name: '自动循环修复', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '添加字幕', exact: true })).toBeInViewport();
}

test('fixed-range automatic repair converges, reruns with fresh IDs, caps and cancels in the real workspace', async ({ playwright: _unused }, info) => {
  test.setTimeout(180_000);
  const mock = await startMockServer(); mock.behavior.review = 'graded'; mock.behavior.recognition = 'partial';
  const source = info.outputPath('repair-loop.mp4'); await makeVideo(source);
  const userData = info.outputPath('repair-loop-user-data'); let app: ElectronApplication | undefined;
  try {
    const launched = await launchApp(userData, [source], []); app = launched.app; const page = launched.page;
    await importVideo(page, false);
    await page.evaluate(async () => {
      const result = await window.api.jobs.list(); if (!result.success || !result.data[0]) throw new Error('Imported fixture missing'); let job = result.data[0];
      for (const segment of [{ startMs: 100, endMs: 1800, sourceText: 'MEDIUM: Unclear phrase beside stable chronological dialogue.' }, { startMs: 2000, endMs: 3800, sourceText: 'NONE: Unaffected outside neighbour.' }]) {
        const added = await window.api.jobs.addSegment({ jobId: job.id, revision: job.revision, segment }); if (!added.success) throw new Error(added.error); job = added.data;
      }
    });
    await expect(page.locator('.subtitle-row')).toHaveCount(2);
    await addProfile(page, 'Repair fixture', 'openai', mock.url); await expandSecondaryControls(page);
    await (await jobSetting(page, '识别方式')).selectOption('cloud');
    await (await jobSetting(page, '语音识别服务')).selectOption({ label: 'Repair fixture' });
    await (await jobSetting(page, 'AI 检查服务（可选）')).selectOption({ label: 'Repair fixture' });
    await closeWorkspaceSettings(page);
    await page.getByLabel('自动修复范围', { exact: true }).selectOption('range');
    await page.getByLabel('自动修复开始（秒）', { exact: true }).fill('0.150');
    await page.getByLabel('自动修复结束（秒）', { exact: true }).fill('1.000');
    await controlGeometry(page);
    await page.screenshot({ path: info.outputPath('repair-range-default.png') });
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setSize(1050, 700); });
    await page.getByLabel('编辑字幕 1', { exact: true }).click();
    await controlGeometry(page);
    await page.screenshot({ path: info.outputPath('repair-range-minimum-editing.png') });
    await page.getByRole('button', { name: '自动循环修复', exact: true }).click();
    await expect.poll(async () => (await currentJob(page)).repairRun?.state).toBe('succeeded');
    const converged = await currentJob(page); expect(converged.repairRun?.reason).toBe('no_eligible'); expect(converged.repairRun?.committedRounds).toBe(1); expect(converged.repairRun?.remainingCount).toBe(0);
    expect(converged.repairRun?.scope).toEqual({ mode: 'range', startMs: 150, endMs: 1000 });
    expect(converged.repairRun?.effectiveIntervals).toEqual([{ startMs: 100, endMs: 1800 }]);
    expect(converged.segments[0]?.sourceText).toBe('Repaired source passage.'); expect(converged.segments[1]?.sourceText).toBe('NONE: Unaffected outside neighbour.');
    const firstRepairedId = converged.segments[0]?.id;
    await expect(page.locator('.repair-loop__status')).toContainText('指定范围剩余 0 条');
    await expect(page.locator('.repair-loop__status')).toContainText('00:00.100 → 00:01.800');
    await controlGeometry(page);
    // Re-enter exactly the same interval; only review behaviour changes, not the renderer API.
    mock.behavior.review = 'findings';
    await page.evaluate(async () => { const result = await window.api.jobs.list(); if (!result.success || !result.data[0]?.segments[0]) throw new Error('Fresh cue missing'); const job = result.data[0]; const segment = job.segments[0]; if (!segment) throw new Error('Cue missing'); const edited = await window.api.jobs.editSegment({ jobId: job.id, revision: job.revision, segment: { ...segment, sourceText: 'Fresh suspicious passage to rerun.' } }); if (!edited.success) throw new Error(edited.error); });
    await page.getByLabel('自动修复最大轮数', { exact: true }).fill('1');
    await page.getByRole('button', { name: '自动循环修复', exact: true }).click();
    await expect.poll(async () => (await currentJob(page)).repairRun?.reason).toBe('max_rounds');
    const capped = await currentJob(page); expect(capped.repairRun?.committedRounds).toBe(1); expect(capped.repairRun?.remainingCount).toBe(1); expect(capped.segments[0]?.id).not.toBe(firstRepairedId);
    expect(capped.segments[1]).toEqual(converged.segments[1]); expect(mock.counters.translation).toBe(0);
    await expect(page.locator('.repair-loop__status')).toContainText('达到最大轮数');
    await page.getByLabel('自动修复最大轮数', { exact: true }).fill('21');
    await expect(page.getByRole('button', { name: '自动循环修复', exact: true })).toBeDisabled();
    await page.getByLabel('自动修复最大轮数', { exact: true }).fill('3');
    // Invalidate the grade, then cancel a held analysis response through visible UI.
    mock.behavior.review = 'slow';
    await page.evaluate(async () => { const result = await window.api.jobs.list(); if (!result.success || !result.data[0]?.segments[0]) throw new Error('Cancel cue missing'); const job = result.data[0]; const segment = job.segments[0]; if (!segment) throw new Error('Cue missing'); const edited = await window.api.jobs.editSegment({ jobId: job.id, revision: job.revision, segment: { ...segment, sourceText: 'Changed before cancellation.' } }); if (!edited.success) throw new Error(edited.error); });
    await page.getByRole('button', { name: '自动循环修复', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消自动修复', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '功能导航', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '功能导航', exact: true })).toBeVisible();
    await page.getByLabel('关闭对话框', { exact: true }).click();
    await page.getByRole('button', { name: '取消自动修复', exact: true }).click();
    await expect.poll(async () => (await currentJob(page)).repairRun?.state).toBe('cancelled');
    const cancelled = await currentJob(page); expect(cancelled.repairRun?.committedRounds).toBe(0); expect(cancelled.repairRun?.remainingCount).toBeUndefined();
    await expect(page.locator('.repair-loop__status')).toContainText('剩余疑点未知');
    await page.screenshot({ path: info.outputPath('repair-range-cancelled.png') });
    await app.close(); app = undefined;
    const restarted = await launchApp(userData, [], []); app = restarted.app;
    expect((await currentJob(restarted.page)).repairRun?.state).toBe('cancelled');
    await expect(restarted.page.getByLabel('自动修复范围', { exact: true })).toHaveValue('range');
    await expect(restarted.page.getByLabel('自动修复开始（秒）', { exact: true })).toHaveValue('0.150');
    await expect(restarted.page.getByRole('button', { name: '自动循环修复', exact: true })).toBeEnabled();
    expect(mock.counters.translation).toBe(0);
  } finally { if (app) await app.close(); await mock.close(); }
});
