import { workspaceButton } from './helpers';
import { test, expect } from '@playwright/test';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { addProfile, configureCloud, launchApp, startMockServer, importVideo } from './helpers';
import { assertDecodedSeek, installSeekTelemetry, makeSeekVideo, rangeProbe, type SeekObservation } from './seeking-helpers';

test('long video seeks beyond buffered data, backwards and through subtitle time buttons decode the actual target frame', async ({ playwright: _playwright }, testInfo) => {
  test.setTimeout(180000);
  const source = testInfo.outputPath('anonymous-75-seconds.mp4');
  await makeSeekVideo(source);
  const mock = await startMockServer();
  const { app, page } = await launchApp(testInfo.outputPath('seek-user-data'), [source], []);
  const observations: SeekObservation[] = [];
  const directory = resolve('.trellis/tasks/10-11-subtitle-workspace-layout/evidence');
  await mkdir(directory, { recursive: true });
  try {
    await importVideo(page);
    const video = page.locator('video');
    await expect(video).toBeVisible({ timeout: 90000 });
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState), { timeout: 90000 }).toBeGreaterThanOrEqual(2);
    const duration = await video.evaluate((element: HTMLVideoElement) => element.duration);
    expect(duration).toBeCloseTo(75, 0);
    const url = await video.getAttribute('src');
    if (!url) throw new Error('Real playback token URL is absent.');
    const transport = await rangeProbe(app, url);
    await testInfo.attach('range-response', { body: JSON.stringify(transport), contentType: 'application/json' });
    await installSeekTelemetry(page);
    await testInfo.attach('before-seek-buffer', { body: JSON.stringify(await video.evaluate((element: HTMLVideoElement) => ({ buffered: Array.from({ length: element.buffered.length }, (_, index) => [element.buffered.start(index), element.buffered.end(index)]), seekable: Array.from({ length: element.seekable.length }, (_, index) => [element.seekable.start(index), element.seekable.end(index)]) }))), contentType: 'application/json' });
    for (const target of [38, 72, 18, 2]) observations.push(await assertDecodedSeek(page, target, join(directory, `decoded-${target}.png`)));
    // This assertion also rejects the former fileURL handler if a fast machine buffered the whole fixture.
    expect(transport.status, 'Playback transport must honor a bounded byte range.').toBe(206);
    expect(transport.contentRange).toMatch(/^bytes 0-31\/\d+$/);
    expect(transport.acceptRanges).toBe('bytes');
    expect(transport.receivedBytes).toBe(32);
    expect(observations.some((observation) => observation.targetSeconds > 30 && !observation.targetWasBuffered), 'At least one actual forward seek must reach media outside the previously buffered ranges.').toBe(true);
    await addProfile(page, 'Seek fixture mock', 'openai', mock.url);
    await configureCloud(page, 'Seek fixture mock');
    await (await workspaceButton(page, '一键生成字幕')).click();
    await expect(page.getByTestId('segment-0')).toContainText('你好，世界。');
    await expect((await workspaceButton(page, '翻译全部字幕'))).toBeEnabled();
    await page.getByLabel('编辑字幕 1', { exact: true }).click();
    await page.getByLabel('开始时间（秒）', { exact: true }).fill('68');
    await page.getByLabel('结束时间（秒）', { exact: true }).fill('70');
    await page.getByRole('button', { name: '保存字幕', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    observations.push(await assertDecodedSeek(page, 68, join(directory, 'subtitle-jump-68.png'), () => page.getByTestId('segment-1').locator('.time-button').click()));
    observations.push(await assertDecodedSeek(page, 2, join(directory, 'subtitle-jump-back-2.png'), () => page.getByTestId('segment-0').locator('.time-button').click()));
    await video.evaluate(async (element: HTMLVideoElement) => { await element.play(); });
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(2.4);
    await video.evaluate((element: HTMLVideoElement) => element.pause());
    const evidence = { source: 'Anonymous generated testsrc2/time-band-color fixture, no user media or user data.', durationSeconds: duration, sourceBytes: (await stat(source)).size, transport, observations, playbackAdvancedAfterSubtitleJump: true, provider: 'Loopback mocked recognition and translation, no native inference or paid API.' };
    await writeFile(join(directory, 'seek-desktop-result.json'), JSON.stringify(evidence, null, 2));
    await testInfo.attach('decoded-seek-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  } finally { await app.close(); await mock.close(); }
});
