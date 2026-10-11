import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { addProfile, configureCloud, exportFormat, launchApp, makeVideo, renderInternalReference, startMockServer, importVideo } from './helpers';
import type { Job } from '../../src/shared/contracts';

async function makeRecognitionFixture(): Promise<{ url: string; calls: { recognition: number; translation: number }; behavior: { recognition: 'original' | 'fresh' | 'auth' | 'slow' }; close: () => Promise<void> }> {
  const text = await startMockServer();
  const calls = { recognition: 0, translation: 0 };
  const behavior: { recognition: 'original' | 'fresh' | 'auth' | 'slow' } = { recognition: 'original' };
  const server = createServer((request, response) => {
    async function handle(): Promise<void> {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (request.url?.endsWith('/audio/transcriptions')) {
        calls.recognition++;
        if (behavior.recognition === 'slow') return;
        if (behavior.recognition === 'auth') { response.writeHead(401); response.end('{}'); return; }
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ segments: [{ start: .1, end: 1.8, text: behavior.recognition === 'fresh' ? 'Fresh recognition replaces the old words.' : 'Original first sentence.' }, { start: 2, end: 3.8, text: 'Original second sentence.' }] }));
        return;
      }
      calls.translation++;
      const forwarded = await fetch(`${text.url}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: Buffer.concat(chunks).toString() });
      response.writeHead(forwarded.status, { 'Content-Type': 'application/json' });
      response.end(await forwarded.text());
    }
    void handle().catch(() => { if (!response.headersSent) response.writeHead(500); response.end('{}'); });
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Recognition fixture did not bind.');
  return { url: `http://127.0.0.1:${address.port}/v1`, calls, behavior, close: async () => {
    server.closeAllConnections();
    await new Promise<void>((closed, reject) => server.close((error) => error ? reject(error) : closed()));
    await text.close();
  } };
}

async function currentJob(page: Page): Promise<Job> {
  const result = await page.evaluate(() => window.api.jobs.list());
  if (result.success === false || !result.data[0]) throw new Error('Real IPC job is missing.');
  return result.data[0];
}

test('explicit recognition confirmation preserves old corrections on dismissal, failure and cancellation; success replaces content without automatic translation', async ({ playwright: _playwright }, testInfo) => {
  const fixture = await makeRecognitionFixture();
  const source = testInfo.outputPath('anonymous-recognition-reset.mp4');
  const output = testInfo.outputPath('original-corrected.srt');
  await makeVideo(source);
  const { app, page } = await launchApp(testInfo.outputPath('reset-user-data'), [source], [output]);
  try {
    await addProfile(page, 'Recognition reset fixture', 'openai', fixture.url);
    await importVideo(page);
    await configureCloud(page, 'Recognition reset fixture');
    await page.getByRole('button', { name: '一键生成字幕', exact: true }).click();
    await expect(page.getByTestId('segment-0')).toContainText('你好，世界。');
    await expect(page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeEnabled();
    await page.getByLabel('编辑字幕 1', { exact: true }).click();
    await page.getByLabel('原文', { exact: true }).fill('Manually corrected original.');
    await page.getByLabel('译文', { exact: true }).fill('保留这句人工校对译文。');
    await page.getByRole('button', { name: '保存字幕', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByLabel('选择字幕 1', { exact: true }).check();
    await page.getByLabel('强调关键词', { exact: true }).fill('人工');
    await page.getByRole('button', { name: '为选中字幕设置强调', exact: true }).click();
    await expect(page.getByRole('button', { name: '渲染当前参考画面', exact: true })).toHaveCount(0);
    await renderInternalReference(page, 0);
    await expect(page.getByRole('img', { name: '使用导出渲染器生成的字幕参考画面', exact: true })).toHaveCount(0);
    await exportFormat(page, 'srt');
    const previous = await currentJob(page);
    const oldExport = await readFile(output, 'utf8');
    const sourceHash = createHash('sha256').update(await readFile(source)).digest('hex');
    const confirm = async (): Promise<void> => {
      await page.getByRole('button', { name: '重新识别原片', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '重新识别原片', exact: true })).toContainText('手工校对');
      await page.getByRole('button', { name: '确认重新识别', exact: true }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
    };
    await page.getByRole('button', { name: '重新识别原片', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('服务商可能收取费用');
    await expect(page.getByRole('dialog')).toContainText('逐句关键词强调将清除，整体样式保留');
    await page.getByRole('button', { name: '保留现有字幕', exact: true }).click();
    await expect(page.getByRole('button', { name: '重新识别原片', exact: true })).toBeFocused();
    expect(fixture.calls.recognition).toBe(1);
    expect((await currentJob(page)).segments).toEqual(previous.segments);
    await page.getByRole('button', { name: '重新识别原片', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(fixture.calls.recognition).toBe(1);
    fixture.behavior.recognition = 'auth';
    await confirm();
    await expect(page.getByRole('alert')).toContainText('AUTH_ERROR');
    await expect(page.getByRole('alert')).toContainText('未替换已有字幕和校对结果');
    const failed = await currentJob(page);
    expect(failed.segments).toEqual(previous.segments);
    expect(failed.style).toEqual(previous.style);
    expect(failed.outputs).toEqual(previous.outputs);
    expect(failed.previewUrl).toBe(previous.previewUrl);
    await expect(page.getByRole('img', { name: '使用导出渲染器生成的字幕参考画面', exact: true })).toHaveCount(0);
    fixture.behavior.recognition = 'slow';
    await confirm();
    await expect.poll(() => fixture.calls.recognition).toBe(3);
    await expect(page.getByRole('button', { name: '重新识别原片', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '取消当前处理', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('CANCELLED');
    const cancelled = await currentJob(page);
    expect(cancelled.segments).toEqual(previous.segments);
    expect(cancelled.style).toEqual(previous.style);
    expect(cancelled.outputs).toEqual(previous.outputs);
    expect(cancelled.previewUrl).toBe(previous.previewUrl);
    fixture.behavior.recognition = 'fresh';
    await confirm();
    await expect(page.getByTestId('segment-0')).toContainText('Fresh recognition replaces the old words.');
    await expect(page.getByTestId('segment-0')).toContainText('等待翻译');
    await expect(page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeEnabled();
    const replaced = await currentJob(page);
    expect(replaced.revision).toBeGreaterThan(previous.revision);
    expect(replaced.segments.every((segment) => !segment.translatedText)).toBe(true);
    expect(replaced.style.emphasisBySegment).toEqual([]);
    expect(replaced.style.templateId).toBe(previous.style.templateId);
    expect(replaced.stages.translate.state).toBe('idle');
    expect(replaced.stages.preview.state).toBe('idle');
    expect(replaced.stages.export.state).toBe('idle');
    expect(replaced.previewUrl).toBeUndefined();
    expect(replaced.outputs).toEqual(previous.outputs);
    await expect(page.getByRole('img', { name: '使用导出渲染器生成的字幕参考画面', exact: true })).not.toBeVisible();
    await expect(page.getByLabel('选择字幕 1', { exact: true })).not.toBeChecked();
    expect(await readFile(output, 'utf8')).toBe(oldExport);
    expect(createHash('sha256').update(await readFile(source)).digest('hex')).toBe(sourceHash);
    expect(fixture.calls.recognition).toBe(4);
    expect(fixture.calls.translation).toBe(1);
    await expect(page.getByRole('status')).toContainText('不会自动');
    await page.getByRole('button', { name: '翻译全部字幕', exact: true }).click();
    await expect(page.getByTestId('segment-0')).toContainText('你好，世界。');
    expect(fixture.calls.translation).toBe(2);
    const directory = resolve('.trellis/tasks/10-10-ui-segment-reprocessing/evidence');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'recognition-reset-desktop-result.json'), JSON.stringify({ media: 'Anonymous generated four-second fixture; no user task changed.', provider: 'Deterministic loopback HTTP ASR/text mocks, no paid API.', calls: fixture.calls, assertions: ['button dismissal and Escape send no recognition request; focus restored', 'successful cached job can explicitly recognize again', 'failure retains original/translation/manual corrections/style/output history/reference preview', 'cancel retains existing content and reference preview', 'success clears translation/per-cue emphasis/preview/selection and derived stage status, keeps global style and previous exported file/history', 'source SHA-256 and previous SRT bytes unchanged', 'success does not automatically translate', 'explicit later translation succeeds'] }, null, 2));
  } finally { await app.close(); await fixture.close(); }
});
