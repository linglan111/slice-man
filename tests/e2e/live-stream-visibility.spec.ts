import { expect, test, type Page } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderLiveSnapshot } from '../../src/shared/provider-diagnostics-contracts';
import { importVideo, launchApp, makeVideo } from './helpers';
import { assertResponsesArtifacts, currentResponsesJob, REASONING_MARKER, responsesDiagnostics, seedResponses, startReasoningResponses } from './responses-helpers';

async function live(page: Page): Promise<ProviderLiveSnapshot[]> {
  return page.evaluate(async () => {
    const result = await window.api.diagnostics.live({});
    if (!result.success) throw new Error(result.error);
    return result.data;
  });
}

test('thinking is visible before any answer, live popup survives close/reopen, and thinking never survives restart', async ({playwright: _}, info) => {
  test.setTimeout(150000);
  let releaseThinking: (() => void) | undefined;
  const pause = new Promise<void>(resolve => { releaseThinking = resolve; });
  const fixture = await startReasoningResponses({afterThinking: () => pause});
  const source = info.outputPath('stream-state.mp4');
  const userData = info.outputPath('stream-user-data');
  await makeVideo(source);
  let {app, page} = await launchApp(userData, [source], []);
  try {
    await importVideo(page);
    await seedResponses(page, {baseUrl: fixture.url, model: 'native-stream-state', apiKey: 'non-secret-native-fixture'});
    await page.getByRole('button', {name: 'AI 检查字幕', exact: true}).click();
    await expect.poll(async () => (await live(page))[0]?.phase).toBe('thinking');
    const snapshot = (await live(page))[0];
    expect(snapshot).toMatchObject({answerBytes: 0, answerText: '', thinkingText: REASONING_MARKER});
    expect(snapshot?.wireBytes).toBeGreaterThan(0);
    expect((await responsesDiagnostics(page))[0]?.textBytes).toBe(0);
    await expect(page.locator('.processing-strip')).toContainText('模型思考中');
    await page.getByRole('button', {name: '查看流式信息', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'AI 流式信息', exact: true});
    await expect(dialog).toContainText(REASONING_MARKER);
    await expect(dialog.getByRole('button', {name: '关闭对话框', exact: true})).toHaveCount(1);
    for (const [width, height] of [[1050, 700], [1440, 960], [1920, 1080]] as const) {
      await app.evaluate(({BrowserWindow}, size) => BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height), {width, height});
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
      })).toBe(true);
      await page.screenshot({path: info.outputPath(`thinking-popup-${width}.png`)});
    }
    await dialog.getByRole('button', {name: '关闭对话框', exact: true}).click();
    expect(fixture.counts.review).toBe(1);
    expect((await live(page))[0]?.phase).toBe('thinking');
    await page.getByRole('button', {name: '查看流式信息', exact: true}).click();
    await expect(dialog).toContainText(REASONING_MARKER);
    releaseThinking?.();
    await expect.poll(async () => (await responsesDiagnostics(page))[0]?.state).toBe('published');
    await expect.poll(async () => (await live(page))[0]?.answerBytes ?? 0).toBeGreaterThan(0);
    await expect(dialog).toContainText('回答内容');
    expect(fixture.counts.review).toBe(1);
    await assertResponsesArtifacts(page, userData, await responsesDiagnostics(page));
    expect(JSON.stringify(await currentResponsesJob(page))).not.toContain(REASONING_MARKER);
    await page.screenshot({path: info.outputPath('stream-answer-published.png')});
    await app.close();
    for (const file of await readdir(userData)) {
      if (/^app\.db(?:-wal|-shm)?$/.test(file)) {
        expect((await readFile(join(userData, file))).includes(Buffer.from(REASONING_MARKER))).toBe(false);
      }
    }
    ({app, page} = await launchApp(userData, [], []));
    expect(await live(page)).toEqual([]);
    await assertResponsesArtifacts(page, userData, await responsesDiagnostics(page));
    expect(fixture.counts.review).toBe(1);
  } finally {
    releaseThinking?.();
    await app.close();
    await fixture.close();
  }
});

test('review range validates the actual dialog and grades only intersecting cues while preserving outside context', async ({playwright: _}, info) => {
  test.setTimeout(150000);
  const fixture = await startReasoningResponses();
  const source = info.outputPath('review-range.mp4');
  await makeVideo(source);
  const {app, page} = await launchApp(info.outputPath('range-user-data'), [source], []);
  try {
    await importVideo(page);
    await seedResponses(page, {baseUrl: fixture.url, model: 'native-review-range', apiKey: 'non-secret-native-fixture'});
    const initial = await currentResponsesJob(page);
    await page.getByRole('button', {name: '检查范围', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'AI 检查范围', exact: true});
    await expect(dialog.getByRole('radio', {name: '全部字幕', exact: true})).toBeChecked();
    await dialog.getByRole('radio', {name: '已选字幕', exact: true}).check();
    await expect(dialog.getByRole('button', {name: '开始检查', exact: true})).toBeDisabled();
    await expect(dialog.getByRole('alert')).toContainText('请先在右侧字幕列表勾选字幕');
    await dialog.getByRole('radio', {name: '指定时间范围', exact: true}).check();
    const start = dialog.getByLabel('检查开始时间（秒）', {exact: true});
    const end = dialog.getByLabel('检查结束时间（秒）', {exact: true});
    const submit = dialog.getByRole('button', {name: '开始检查', exact: true});
    for (const [begin, finish] of [['', '3.8'], ['3', '2'], ['0', '4.1'], ['1.8', '2']]) {
      await start.fill(begin ?? '');
      await end.fill(finish ?? '');
      if (await submit.isEnabled()) await submit.click();
      await expect(dialog).toBeVisible();
      expect(fixture.counts.review).toBe(0);
      expect(await responsesDiagnostics(page)).toEqual([]);
    }
    await start.fill('2');
    await end.fill('3.8');
    for (const [width, height] of [[1050, 700], [1440, 960]] as const) {
      await app.evaluate(({BrowserWindow}, size) => BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height), {width, height});
      expect(await submit.evaluate(node => {const r = node.getBoundingClientRect(); return r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;})).toBe(true);
      for (const radio of await dialog.getByRole('radio').all()) {
        // A shared form-label grid once squeezed each Chinese label into a vertical character stack.
        expect(await radio.evaluate(node => node.closest('label')?.getBoundingClientRect().height ?? Infinity)).toBeLessThanOrEqual(44);
      }
      await page.screenshot({path: info.outputPath(`review-range-${width}.png`)});
    }
    await submit.click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(async () => (await responsesDiagnostics(page))[0]?.state).toBe('published');
    expect(fixture.counts.review).toBe(1);
    const reviewed = await currentResponsesJob(page);
    const assessments = reviewed.reviewReport?.assessments?.filter(item => item.status === 'current');
    expect(assessments?.map(item => item.segmentId)).toEqual([initial.segments[1]?.id]);
    expect(reviewed.segments).toEqual(initial.segments);
    const prompt = JSON.parse(fixture.reviewPrompts[0]?.split('\n').find(line => line.startsWith('{"cues"')) ?? '{}') as {cues: {n: number}[]; groups: {targets: number[]; context: number[]}[]};
    expect(prompt.groups.flatMap(group => group.targets)).toEqual([1]);
    expect(prompt.cues.map(cue => cue.n)).toContain(0);
    expect(prompt.groups[0]?.context).toContain(0);
  } finally {
    await app.close();
    await fixture.close();
  }
});
