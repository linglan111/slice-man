import { jobSetting, workspaceButton, closeWorkspaceSettings } from './helpers';
import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { addProfile, exportFormat, launchApp, makeVideo, startMockServer, importVideo } from './helpers';
import type { Job } from '../../src/shared/contracts';

async function currentJob(page: Page): Promise<Job> {
  return page.evaluate(async () => { const result = await window.api.jobs.list(); if (!result.success || !result.data[0]) throw new Error('Fixture absent'); return result.data[0]; });
}
async function seek(page: Page, seconds: number): Promise<void> {
  await page.locator('video').evaluate((video: HTMLVideoElement, value) => { video.pause(); video.currentTime = value; }, seconds);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.seeking)).toBe(false);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(seconds, 2);
}
async function fillCue(page: Page, start: string, end: string, source: string, target: string): Promise<void> {
  await page.getByLabel('开始时间（秒）', { exact: true }).fill(start);
  await page.getByLabel('结束时间（秒）', { exact: true }).fill(end);
  await page.getByLabel('原文', { exact: true }).fill(source);
  await page.getByLabel('译文', { exact: true }).fill(target);
}
async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: '保存字幕', exact: true }).click();
  await expect(page.locator('.segment-editor')).toHaveCount(0);
}

test('inline timeline CRUD from preview and list preserves drafts, exact cue targeting and corrected exports without AI', async ({ playwright: _playwright }, testInfo) => {
  const mock = await startMockServer();
  const input = testInfo.outputPath('anonymous-inline.mp4'); await makeVideo(input);
  const originalHash = createHash('sha256').update(await readFile(input)).digest('hex');
  const output = testInfo.outputPath('corrected.srt');
  const finalOutput = testInfo.outputPath('after-deletion.srt');
  const { app, page } = await launchApp(testInfo.outputPath('isolated-user-data'), [input, input], [output, finalOutput]);
  try {
    await importVideo(page);
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole('button', { name: '渲染当前参考画面', exact: true })).toHaveCount(0);
    await expect(page.locator('.reference-preview')).toHaveCount(0);
    await expect(page.locator('.stage-pill')).toHaveCount(3);
    // Empty timeline can be created from proofreading, with validation and cancel.
    await page.getByRole('button', { name: '添加字幕', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '保存字幕', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('请填写新字幕');
    await fillCue(page, '0.200', '1.500', 'List source', 'List target');
    await save(page);
    const first = (await currentJob(page)).segments[0]; if (!first) throw new Error('First cue absent');
    expect(first.id).not.toBe('new-draft');
    await seek(page, 1.8); await expect(page.getByTestId('live-captions')).toBeEmpty();
    // Preview insertion uses actual currentTime in a gap, not the rounded label.
    await (await workspaceButton(page, '添加画面字幕')).click();
    await expect(page.getByLabel('开始时间（秒）', { exact: true })).toHaveValue('1.800');
    await fillCue(page, '1.800', '2.800', 'Preview source', 'Preview target'); await save(page);
    await expect(page.getByTestId('segment-1')).toContainText('Preview target');
    await expect(page.getByTestId('live-captions')).toHaveText('Preview target');
    // Click a currently playing cue, pause and edit all four fields inline.
    await seek(page, .4); await page.locator('video').evaluate(async (video: HTMLVideoElement) => { await video.play(); });
    await page.getByRole('button', { name: '校对画面字幕：List target', exact: true }).click();
    expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
    await expect(page.locator('.preview-panel .segment-editor')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByLabel('原文', { exact: true }).fill('Preview cancelled draft');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    expect((await currentJob(page)).segments[0]?.sourceText).toBe('List source');
    await page.getByRole('button', { name: '校对画面字幕：List target', exact: true }).click();
    await fillCue(page, '0.123', '1.600', 'Edited list source', 'Edited list target'); await save(page);
    await expect(page.getByTestId('segment-0')).toContainText('Edited list target');
    expect((await currentJob(page)).segments[0]).toMatchObject({ id: first.id, startMs: 123, endMs: 1600, sourceText: 'Edited list source', translatedText: 'Edited list target' });
    await page.getByLabel('编辑字幕 2', { exact: true }).click();
    await expect(page.getByTestId('segment-1').locator('.segment-editor')).toBeVisible();
    await fillCue(page, '1.700', '2.900', 'Edited preview source', 'Edited preview target'); await save(page);
    // Cancel does not mutate; invalid bounds preserve the draft and prior result.
    await page.getByLabel('编辑字幕 1', { exact: true }).click();
    await page.getByLabel('原文', { exact: true }).fill('Unsaved draft');
    await page.keyboard.press('Escape'); await expect(page.locator('.segment-editor')).toHaveCount(0);
    expect((await currentJob(page)).segments[0]?.sourceText).toBe('Edited list source');
    await page.getByLabel('编辑字幕 1', { exact: true }).click();
    await fillCue(page, '0.123', '4.001', 'Invalid timing draft', 'Draft target');
    await page.getByRole('button', { name: '保存字幕', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('视频时长');
    await expect(page.getByLabel('原文', { exact: true })).toHaveValue('Invalid timing draft');
    // Real main-process revision change rejects save AND delete of the stale draft.
    await page.evaluate(async () => {
      const list = await window.api.jobs.list(); if (!list.success || !list.data[0]?.segments[0]) throw new Error('Fixture absent');
      const job = list.data[0]; const cue = job.segments[0]; if (!cue) throw new Error('Cue absent');
      const result = await window.api.jobs.editSegment({ jobId: job.id, revision: job.revision, segment: { ...cue, sourceText: 'External persisted source' } });
      if (!result.success) throw new Error(result.error);
    });
    await page.getByLabel('结束时间（秒）', { exact: true }).fill('1.600');
    await page.getByRole('button', { name: '保存字幕', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/REVISION_CONFLICT|已更新/);
    await expect(page.getByLabel('原文', { exact: true })).toHaveValue('Invalid timing draft');
    await page.getByRole('button', { name: '删除此字幕', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/REVISION_CONFLICT|已更新/);
    expect((await currentJob(page)).segments).toHaveLength(2);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    // Overlap creates two literal buttons; bilingual lines address one exact cue.
    await seek(page, 1); await page.getByRole('button', { name: '添加字幕', exact: true }).click();
    await fillCue(page, '0.900', '1.400', 'Overlap source', 'Overlap target'); await save(page);
    await (await jobSetting(page, '双语字幕（译文 + 原文）')).click();
    await expect((await jobSetting(page, '双语字幕（译文 + 原文）'))).toBeChecked();
    await closeWorkspaceSettings(page);
    await expect(page.getByTestId('live-captions').locator('button')).toHaveCount(2);
    // Measure a shrink synchronously, before ResizeObserver can deliver a new
    // object-fit rectangle: edit targets must never invade native controls.
    const immediateShrink = await page.locator('.live-video-player').evaluate((player: HTMLElement) => {
      const oldHeight = player.style.height;
      try {
        player.style.height = `${Math.max(130, player.getBoundingClientRect().height - 40)}px`;
        const video = player.querySelector('video');
        const cues = [...player.querySelectorAll('.live-captions__cue')];
        if (!video || cues.length !== 2) throw new Error('Bilingual shrink fixture missing');
        return { videoBottom: video.getBoundingClientRect().bottom, cueBottom: Math.max(...cues.map((cue) => cue.getBoundingClientRect().bottom)) };
      } finally { player.style.height = oldHeight; }
    });
    expect(immediateShrink.cueBottom, 'Pre-observer shrink keeps both clickable captions clear of native controls').toBeLessThanOrEqual(immediateShrink.videoBottom - 63);
    const controlsBounds = await page.locator('video').boundingBox(); if (!controlsBounds) throw new Error('Video bounds absent');
    const lowestCue = await page.getByTestId('live-captions').locator('button').evaluateAll((cues) => Math.max(...cues.map((cue) => cue.getBoundingClientRect().bottom)));
    expect(lowestCue, 'Every clickable overlap cue stays above the native control row').toBeLessThanOrEqual(controlsBounds.y + controlsBounds.height - 63);
    const nativeTimelinePosition = { x: controlsBounds.width * .55, y: controlsBounds.height - 23 };
    // Clickable bilingual captions may cover the center; reveal controls where the actual timeline click occurs.
    await page.locator('video').hover({ position: nativeTimelinePosition });
    await page.locator('video').click({ position: nativeTimelinePosition });
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(1.8);
    await expect(page.locator('.segment-editor')).toHaveCount(0);
    await seek(page, 1);
    await page.getByRole('button', { name: '校对画面字幕：Overlap target', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('原文', { exact: true })).toHaveValue('Overlap source');
    const evidenceDirectory = resolve('.trellis/tasks/10-11-subtitle-workspace-layout/evidence'); await mkdir(evidenceDirectory, { recursive: true });
    await page.locator('.preview-panel').screenshot({ path: join(evidenceDirectory, 'inline-cue-editor-anonymous.png') });
    await fillCue(page, '.900', '1.400', 'Overlap edited', 'Overlap corrected'); await save(page);
    await expect(page.getByTestId('live-captions')).toContainText('Overlap correctedOverlap edited');
    await exportFormat(page, 'srt');
    const srt = await readFile(output, 'utf8');
    expect(srt).toContain('00:00:00,123 --> 00:00:01,600');
    expect(srt).toContain('Edited list target'); expect(srt).toContain('External persisted source');
    expect(srt).toContain('00:00:01,700 --> 00:00:02,900'); expect(srt).toContain('Edited preview target');
    expect(srt).toContain('Overlap corrected');
    // Preview deletion clears only clicked cue and its emphasis; history stays.
    await page.getByLabel('选择字幕 2', { exact: true }).check();
    await (await jobSetting(page, '强调关键词')).fill('Overlap');
    await page.getByRole('button', { name: '为选中字幕设置强调', exact: true }).click();
    await closeWorkspaceSettings(page);
    await page.getByRole('button', { name: '校对画面字幕：Overlap corrected', exact: true }).click();
    await page.getByRole('button', { name: '删除此字幕', exact: true }).click(); await expect(page.locator('.segment-editor')).toHaveCount(0);
    const afterDelete = await currentJob(page);
    expect(afterDelete.segments.map((cue) => cue.id)).toContain(first.id);
    expect(afterDelete.style.emphasisBySegment).toHaveLength(0); expect(afterDelete.outputs).toContain(output);
    await expect(page.getByRole('button', { name: /^重译选中/ })).toHaveCount(0);
    await expect(page.getByTestId('live-captions')).not.toContainText('Overlap corrected');
    // Delete all through list, then re-add from preview near the final media ms.
    await page.getByLabel('删除字幕 1', { exact: true }).click(); await expect(page.locator('.subtitle-row')).toHaveCount(1);
    await page.getByLabel('删除字幕 1', { exact: true }).click(); await expect(page.locator('.subtitle-row')).toHaveCount(0);
    await expect(page.getByTestId('live-captions')).toBeEmpty();
    await seek(page, 3.999); await (await workspaceButton(page, '添加画面字幕')).click();
    await expect(page.getByLabel('开始时间（秒）', { exact: true })).toHaveValue('3.999');
    await expect(page.getByLabel('结束时间（秒）', { exact: true })).toHaveValue('4.000');
    await page.getByLabel('原文', { exact: true }).fill('Last millisecond'); await save(page);
    await expect(page.getByTestId('segment-0')).toContainText('Last millisecond');
    await exportFormat(page, 'srt');
    const finalSrt = await readFile(finalOutput, 'utf8');
    expect(finalSrt).toContain('00:00:03,999 --> 00:00:04,000'); expect(finalSrt).toContain('Last millisecond');
    expect(finalSrt).not.toContain('Overlap corrected'); expect(finalSrt).not.toContain('Edited list target');
    // Switching projects discards an unsaved target rather than carrying it over.
    await page.getByLabel('编辑字幕 1', { exact: true }).click(); await page.getByLabel('原文', { exact: true }).fill('Switch draft');
    await importVideo(page);
    await expect(page.locator('.segment-editor')).toHaveCount(0); await expect(page.getByTestId('live-captions')).toBeEmpty();
    expect(mock.counters.recognition).toBe(0); expect(mock.counters.translation).toBe(0);
    expect(createHash('sha256').update(await readFile(input)).digest('hex')).toBe(originalHash);
    const directory = resolve('.trellis/tasks/10-11-subtitle-workspace-layout/evidence'); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'inline-subtitles-result.json'), JSON.stringify({ isolated: true, generatedAnonymousMedia: true, noAIRequests: true, assertions: ['preview/list four-field inline save', 'playback click pauses', 'no edit modal/reference UI', 'gap insertion and final-ms bounds', 'empty/all-delete/re-add', 'overlap bilingual exact target', 'cancel/invalid/stale save and delete drafts', 'selected/emphasis cleanup', 'corrected SRT text and boundaries', 'job-switch draft clearing', 'source hash unchanged'] }, null, 2));
  } finally { await app.close(); await mock.close(); }
});

test('lyric highlighting and confined auto-follow respect seeks, overlap, gaps, toggle, manual browsing and inline typing; busy edits stay disabled', async ({ playwright: _playwright }, testInfo) => {
  const mock = await startMockServer();
  const input = testInfo.outputPath('anonymous-lyrics.mp4'); await makeVideo(input);
  const { app, page } = await launchApp(testInfo.outputPath('isolated-lyrics-data'), [input], []);
  try {
    await addProfile(page, 'Manual translator', 'openai', mock.url);
    await importVideo(page);
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
    // Dense anonymous cues are fixture setup, not a substitute for UI CRUD above.
    await page.evaluate(async () => {
      const listed = await window.api.jobs.list(); if (!listed.success || !listed.data[0]) throw new Error('Fixture absent'); let job = listed.data[0];
      for (let index = 0; index < 30; index++) {
        const result = await window.api.jobs.addSegment({ jobId: job.id, revision: job.revision, segment: { startMs: index * 100, endMs: index * 100 + 90, sourceText: `Anonymous cue ${index + 1}` } });
        if (!result.success) throw new Error(result.error); job = result.data;
      }
      const overlap = await window.api.jobs.addSegment({ jobId: job.id, revision: job.revision, segment: { startMs: 2850, endMs: 2890, sourceText: 'Anonymous overlap' } }); if (!overlap.success) throw new Error(overlap.error);
    });
    await expect(page.locator('.subtitle-row')).toHaveCount(31);
    const list = page.locator('.subtitle-list'); const follow = page.getByLabel('跟随播放', { exact: true });
    const documentBefore = await page.evaluate(() => document.querySelector('.main-workspace')?.scrollTop ?? 0);
    await seek(page, 2.86);
    await expect(page.locator('.subtitle-row--active')).toHaveCount(2);
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.querySelector('.main-workspace')?.scrollTop ?? 0)).toBe(documentBefore);
    await seek(page, 3.2); await expect(page.locator('.subtitle-row--active')).toHaveCount(0);
    await seek(page, .02); await expect(page.getByTestId('segment-0')).toHaveAttribute('aria-current', 'true');
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeLessThan(10);
    await follow.uncheck(); await seek(page, 2.72);
    await expect(page.getByTestId('segment-27')).toHaveAttribute('aria-current', 'true');
    expect(await list.evaluate((element) => element.scrollTop)).toBeLessThan(10);
    await follow.check(); await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    await list.focus(); await page.keyboard.press('PageUp'); await expect(follow).not.toBeChecked();
    await follow.check();
    await list.hover(); await page.mouse.wheel(0, -700);
    await expect(follow).not.toBeChecked();
    const manualPosition = await list.evaluate((element) => element.scrollTop);
    await seek(page, .02); await expect(page.getByTestId('segment-0')).toHaveAttribute('aria-current', 'true');
    expect(await list.evaluate((element) => element.scrollTop)).toBeCloseTo(manualPosition, 0);
    await follow.check(); await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeLessThan(10);
    await page.getByLabel('编辑字幕 1', { exact: true }).click();
    await page.getByLabel('原文', { exact: true }).fill('Typing must stay here');
    const editingPosition = await list.evaluate((element) => element.scrollTop);
    await seek(page, 2.72); await expect(page.getByTestId('segment-27')).toHaveAttribute('aria-current', 'true');
    expect(await list.evaluate((element) => element.scrollTop)).toBeCloseTo(editingPosition, 0);
    await expect(page.getByLabel('原文', { exact: true })).toHaveValue('Typing must stay here');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    // A manual timeline translates without local model availability and never ASR.
    await (await jobSetting(page, '翻译服务')).selectOption({ label: 'Manual translator' });
    await expect((await workspaceButton(page, '翻译全部字幕'))).toBeEnabled();
    await seek(page, 2.72); mock.behavior.translation = 'slow';
    await page.getByTestId('live-captions').locator('button').click();
    await page.getByLabel('原文', { exact: true }).fill('Busy retained draft');
    await (await workspaceButton(page, '翻译全部字幕')).click();
    await expect.poll(() => mock.counters.translation).toBe(1);
    // The single operation panel temporarily hides the retained preview draft.
    // Closing the generation panel restores that same draft during processing.
    await page.getByRole('button', { name: '关闭操作面板', exact: true }).click();
    await expect(page.getByTestId('live-captions').locator('button')).toBeDisabled();
    await expect((await workspaceButton(page, '添加画面字幕'))).toBeDisabled();
    await expect(page.getByRole('button', { name: '添加字幕', exact: true })).toBeDisabled();
    await expect(page.getByLabel('删除字幕 1', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('原文', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '保存字幕', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '取消当前处理', exact: true }).click();
    await expect(page.getByRole('button', { name: '添加字幕', exact: true })).toBeEnabled();
    await expect(page.getByLabel('原文', { exact: true })).toHaveValue('Busy retained draft');
    expect(mock.counters.recognition).toBe(0);
  } finally { await app.close(); await mock.close(); }
});
