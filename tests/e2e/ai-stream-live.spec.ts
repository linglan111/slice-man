import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { importVideo, launchApp, makeVideo, workspaceButton, exportFormat, inspectVideo } from './helpers';
import { assertResponsesArtifacts, currentResponsesJob, responsesDiagnostics, runResponsesOperation, seedResponses, startLiveResponsesProxy } from './responses-helpers';
import type { ProviderDiagnostic } from '../../src/shared/provider-diagnostics-contracts';

// A live provider's thinking and credentials must not enter traces or screenshots.
test.use({trace: 'off', video: 'off', screenshot: 'off'});

test('authorized actual Responses service: thinking popup, ranged/full review, names, chapters, translation, style and exports', async ({playwright: _}, info) => {
  test.skip(process.env.APP_LIVE_STREAM !== '1', 'Requires explicit authorization and isolated in-memory credentials');
  test.setTimeout(1800000);
  const apiKey = process.env.RESPONSES_E2E_API_KEY;
  delete process.env.RESPONSES_E2E_API_KEY;
  const ledgerPath = process.env.RESPONSES_E2E_LEDGER;
  if (!apiKey || !ledgerPath) throw new Error('Missing isolated live credentials or durable request ledger');
  const proxy = await startLiveResponsesProxy({baseUrl: process.env.RESPONSES_E2E_BASE_URL ?? 'https://api.deepseek.com', apiKey, ledgerPath, requestLimit: 12});
  const source = info.outputPath('synthetic-live.mp4');
  const userData = info.outputPath('isolated-live-data');
  const exports = ['srt', 'ass', 'vtt', 'mp4'].map(format => info.outputPath(`live-ai.${format}`));
  await makeVideo(source);
  let {app, page} = await launchApp(userData, [source], exports);
  const completed: ProviderDiagnostic[] = [];
  const evidence: {operation: string; requestId: string; state: string; elapsedMs: number; answerBytes: number}[] = [];
  let thinkingSeen = false;
  let popupSeen = false;
  let cancellationPassed = false;
  async function published(operation: ProviderDiagnostic['operation'], previous: number): Promise<ProviderDiagnostic> {
    await expect.poll(async () => {
      const records = await responsesDiagnostics(page);
      return records.length > previous && records.some(record => record.operation === operation && ['published', 'failed', 'cancelled'].includes(record.state));
    }, {timeout: 330000, intervals: [200, 500, 1000]}).toBe(true);
    // Validation may legitimately require the existing one correction generation.
    await expect(page.getByRole('button', {name: 'AI 检查字幕', exact: true})).toBeEnabled({timeout: 330000});
    const record = (await responsesDiagnostics(page)).find(item => item.operation === operation);
    if (!record) throw new Error('Live operation did not produce a diagnostic');
    proxy.finish(await responsesDiagnostics(page));
    // Keep external thinking out of Playwright's automatic failure DOM context.
    if (record.state !== 'published') {
      const popup = page.getByRole('dialog', {name: 'AI 流式信息', exact: true});
      if (await popup.isVisible()) await popup.getByRole('button', {name: '关闭对话框', exact: true}).click();
    }
    expect(record.state, `${operation}: ${record.errorCode ?? record.state}`).toBe('published');
    completed.push(record);
    evidence.push({operation, requestId: record.id, state: record.state, elapsedMs: record.elapsedMs, answerBytes: record.textBytes});
    await assertResponsesArtifacts(page, userData, [record]);
    return record;
  }
  try {
    await importVideo(page);
    await seedResponses(page, {baseUrl: proxy.url, model: process.env.RESPONSES_E2E_MODEL ?? 'deepseek-flash', apiKey: 'isolated-loopback-session-only'});
    // Observe a genuine upstream reasoning-first stream through the native UI.
    let previous = (await responsesDiagnostics(page)).length;
    await page.getByRole('toolbar', {name: '视频操作'}).getByRole('button', {name: '章节', exact: true}).click();
    await page.getByRole('button', {name: 'AI 切分章节', exact: true}).click();
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.api.diagnostics.live({});
      return result.success && result.data.some(item => item.phase === 'thinking' && item.thinkingText.length > 0 && item.answerBytes === 0);
    }), {timeout: 120000, intervals: [100, 200]}).toBe(true);
    thinkingSeen = true;
    await expect(page.locator('.processing-strip')).toContainText('模型思考中');
    await page.getByRole('button', {name: '查看流式信息', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'AI 流式信息', exact: true});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', {name: '关闭对话框', exact: true})).toHaveCount(1);
    // Assert lengths only: failures should not print external reasoning content.
    await expect.poll(async () => dialog.locator('pre').evaluateAll(nodes => nodes.some(node => (node.textContent?.length ?? 0) > 0))).toBe(true);
    popupSeen = true;
    await dialog.getByRole('button', {name: '关闭对话框', exact: true}).click();
    await page.getByRole('button', {name: '查看流式信息', exact: true}).click();
    await expect(dialog).toBeVisible();
    await published('chapters', previous);
    await dialog.getByRole('button', {name: '关闭对话框', exact: true}).click();

    // Check exactly the second cue. The first remains legitimate neighbouring evidence.
    const original = await currentResponsesJob(page);
    previous = (await responsesDiagnostics(page)).length;
    await page.getByRole('button', {name: '检查范围', exact: true}).click();
    const range = page.getByRole('dialog', {name: 'AI 检查范围', exact: true});
    await range.getByRole('radio', {name: '指定时间范围', exact: true}).check();
    await range.getByLabel('检查开始时间（秒）', {exact: true}).fill('2');
    await range.getByLabel('检查结束时间（秒）', {exact: true}).fill('3.8');
    await range.getByRole('button', {name: '开始检查', exact: true}).click();
    await published('review', previous);
    const ranged = await currentResponsesJob(page);
    expect(ranged.reviewReport?.reviewedSegmentIds).toEqual([original.segments[1]?.id]);
    expect(ranged.segments).toEqual(original.segments);

    for (const operation of ['review', 'names'] as const) {
      const record = await runResponsesOperation(page, operation);
      proxy.finish(await responsesDiagnostics(page));
      expect(record.state, `${operation}: ${record.errorCode ?? record.state}`).toBe('published');
      await assertResponsesArtifacts(page, userData, [record]);
      completed.push(record);
      evidence.push({operation, requestId: record.id, state: record.state, elapsedMs: record.elapsedMs, answerBytes: record.textBytes});
    }
    expect((await currentResponsesJob(page)).reviewReport?.assessments?.filter(item => item.status === 'current')).toHaveLength(2);
    expect((await currentResponsesJob(page)).nameReport?.state).toBe('current');

    // Prepare untranslated cues via public editing APIs, then run default chapter translation.
    await page.evaluate(async () => {
      const listed = await window.api.jobs.list();
      if (!listed.success || !listed.data[0]) throw new Error('Synthetic job absent');
      let job = listed.data[0];
      for (const segment of job.segments) {
        const edited = await window.api.jobs.editSegment({jobId: job.id, revision: job.revision, segment: {...segment, translatedText: ''}});
        if (!edited.success) throw new Error('Cannot prepare synthetic untranslated cue');
        job = edited.data;
      }
      const configured = await window.api.jobs.updateOptions({jobId: job.id, options: {...job.options, styleProfileId: job.options.reviewProfileId}});
      if (!configured.success) throw new Error('Cannot configure isolated style service');
    });
    await page.reload();
    previous = (await responsesDiagnostics(page)).length;
    await (await workspaceButton(page, '翻译全部字幕')).click();
    await published('translate', previous);
    const translated = await currentResponsesJob(page);
    expect(translated.segments.every(item => /[\u3400-\u9fff]/.test(item.translatedText))).toBe(true);

    await workspaceButton(page, '✧ 生成 AI 样式');
    await page.getByLabel('AI 设计描述', {exact: true}).fill('请选择 clean 模板，白色字、黑色描边、底部居中，无动画，不使用任何关键词强调。');
    previous = (await responsesDiagnostics(page)).length;
    await (await workspaceButton(page, '✧ 生成 AI 样式')).click();
    await published('style', previous);
    for (const format of ['srt', 'ass', 'vtt', 'mp4']) await exportFormat(page, format);
    for (const path of exports.slice(0, 3)) expect(/[\u3400-\u9fff]/.test(await readFile(path, 'utf8'))).toBe(true);
    const video = exports[3];
    if (!video) throw new Error('Synthetic video export path absent');
    expect(await inspectVideo(video)).toMatchObject({width: 640, height: 360, codec: 'h264'});
    const saved = await currentResponsesJob(page);
    // Cancel a real upstream reasoning stream and retain the last published report.
    const beforeCancel = (await responsesDiagnostics(page)).length;
    await page.getByRole('button', {name: 'AI 检查字幕', exact: true}).click();
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.api.diagnostics.live({});
      return result.success && result.data.some(item => item.operation === 'review' && item.phase === 'thinking');
    }), {timeout: 120000, intervals: [100, 200]}).toBe(true);
    await page.getByRole('button', {name: '取消当前处理', exact: true}).click();
    await expect.poll(async () => {
      const records = await responsesDiagnostics(page);
      return records.length > beforeCancel && records[0]?.state === 'cancelled';
    }, {timeout: 30000}).toBe(true);
    await expect(page.getByRole('button', {name: 'AI 检查字幕', exact: true})).toBeEnabled();
    expect((await currentResponsesJob(page)).reviewReport).toEqual(saved.reviewReport);
    proxy.finish(await responsesDiagnostics(page));
    cancellationPassed = true;
    await app.close();
    ({app, page} = await launchApp(userData, [], []));
    expect((await currentResponsesJob(page)).segments).toEqual(saved.segments);
    expect((await currentResponsesJob(page)).style).toEqual(saved.style);
    const ephemeral = await page.evaluate(() => window.api.diagnostics.live({}));
    expect(ephemeral).toEqual({success: true, data: []});
    await assertResponsesArtifacts(page, userData, completed);
    expect(thinkingSeen && popupSeen).toBe(true);
    expect(completed).toHaveLength(6);
  } finally {
    const popup = page.getByRole('dialog', {name: 'AI 流式信息', exact: true});
    if (!page.isClosed() && await popup.isVisible()) await popup.getByRole('button', {name: '关闭对话框', exact: true}).click();
    try {proxy.finish(await responsesDiagnostics(page));}
    finally {
      await app.close();
      await proxy.close();
      const report = {thinkingSeen, popupSeen, cancellationPassed, source: 'actual configured provider, unchanged upstream SSE', syntheticSubtitles: true, personalDataWritten: false, trace: false, operations: evidence};
      await writeFile(info.outputPath('live-outcomes.json'), JSON.stringify(report, null, 2));
      await info.attach('sanitized-live-request-ledger', {body: await readFile(ledgerPath), contentType: 'application/json'});
    }
  }
});
