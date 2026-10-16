import { expect, test } from '@playwright/test';
import { importVideo, launchApp, makeVideo, startMockServer } from './helpers';
import { currentResponsesJob, seedResponses } from './responses-helpers';

test('single review entry confirms scope, explicit retry retains range, and history retry never silently checks all', async ({playwright: _}, info) => {
  const mock = await startMockServer();
  mock.behavior.review = 'evidence-invalid';
  const source = info.outputPath('review-retry.mp4');
  await makeVideo(source);
  const {app, page} = await launchApp(info.outputPath('review-data'), [source], []);
  try {
    await importVideo(page);
    await seedResponses(page, {baseUrl: mock.url, model: 'retry-fixture', apiKey: 'synthetic-session-only'});
    const before = await currentResponsesJob(page);
    await expect(page.getByRole('button', {name: '检查范围', exact: true})).toHaveCount(0);
    await page.getByRole('button', {name: 'AI 检查字幕', exact: true}).click();
    const scope = page.getByRole('dialog', {name: 'AI 检查范围', exact: true});
    await expect(scope).toBeVisible();
    expect(mock.counters.review).toBe(0);
    await scope.getByRole('radio', {name: '指定时间范围', exact: true}).check();
    await scope.getByLabel('检查开始时间（秒）', {exact: true}).fill('2');
    await scope.getByLabel('检查结束时间（秒）', {exact: true}).fill('3.8');
    await scope.getByRole('button', {name: '开始检查', exact: true}).click();
    const retry = page.locator('.banner--error').getByRole('button', {name: '重试本次操作', exact: true});
    await expect(retry).toBeVisible();
    expect(mock.counters.review).toBe(2);
    expect((await currentResponsesJob(page)).segments).toEqual(before.segments);
    mock.behavior.review = 'empty';
    await retry.click();
    await expect(page.locator('.banner--error')).toHaveCount(0);
    await expect.poll(async () => (await currentResponsesJob(page)).reviewReport?.reviewedSegmentIds).toEqual([before.segments[1]?.id]);
    expect(mock.counters.review).toBe(3);
    expect(mock.counters.recognition).toBe(0);
    const prompt = JSON.parse(mock.reviewPrompts.at(-1)?.split('\n').find(line => line.startsWith('{"cues"')) ?? '{}') as {groups: {targets: number[]}[]};
    expect(prompt.groups.flatMap(item => item.targets)).toEqual([1]);
    await page.getByRole('button', {name: 'AI 请求日志', exact: true}).click();
    const logs = page.getByRole('dialog', {name: 'AI 请求日志', exact: true});
    await logs.getByRole('button').filter({hasText: '字幕检查 · 失败'}).first().click();
    await logs.getByRole('button', {name: '重新设置并重试', exact: true}).click();
    await expect(scope).toBeVisible();
    expect(mock.counters.review).toBe(3);
    await scope.getByRole('button', {name: '取消', exact: true}).click();
    expect(mock.counters.review).toBe(3);
    await page.screenshot({path: info.outputPath('single-review-entry-after-retry.png')});
  } finally {await app.close(); await mock.close();}
});

test('chapter validation failure offers an explicit same-operation retry and clears old panel errors on success', async ({playwright: _}, info) => {
  const mock = await startMockServer();
  mock.behavior.chapters = 'invalid';
  const source = info.outputPath('chapter-retry.mp4');
  await makeVideo(source);
  const {app, page} = await launchApp(info.outputPath('chapter-data'), [source], []);
  try {
    await importVideo(page);
    await seedResponses(page, {baseUrl: mock.url, model: 'chapter-retry-fixture', apiKey: 'synthetic-session-only'});
    const before = await currentResponsesJob(page);
    await page.getByRole('toolbar', {name: '视频操作'}).getByRole('button', {name: '章节', exact: true}).click();
    await page.getByRole('button', {name: 'AI 切分章节', exact: true}).click();
    const error = page.locator('.banner--error');
    await expect(error).toContainText('相邻章节须共用边界');
    expect(mock.counters.chapters).toBe(1);
    expect((await currentResponsesJob(page)).chapterPlan).toEqual(before.chapterPlan);
    mock.behavior.chapters = 'ok';
    await error.getByRole('button', {name: '重试本次操作', exact: true}).click();
    await expect.poll(async () => (await currentResponsesJob(page)).chapterPlan?.state).toBe('current');
    expect(mock.counters.chapters).toBe(2);
    expect(mock.counters.recognition).toBe(0);
    await expect(error).toHaveCount(0);
    await expect(page.locator('.chapter-panel').getByRole('alert')).toHaveCount(0);
    await page.screenshot({path: info.outputPath('chapter-retry-published.png')});
  } finally {await app.close(); await mock.close();}
});
