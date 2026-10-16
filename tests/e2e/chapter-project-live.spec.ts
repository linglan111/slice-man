import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../src/main/db/store';
import { jobSchema, optionsSchema } from '../../src/shared/contracts';
import { launchApp } from './helpers';
import { currentResponsesJob, responsesDiagnostics, startLiveResponsesProxy } from './responses-helpers';

test.use({trace: 'off', screenshot: 'off', video: 'off'});

test('authorized failing-project copy produces strictly grounded chapters through actual native UI and provider', async ({playwright: _}, info) => {
  test.skip(process.env.APP_LIVE_CHAPTER_PROJECT !== '1', 'Requires explicit authorization, readonly source bridge and isolated credentials');
  test.setTimeout(750000);
  const apiKey = process.env.RESPONSES_E2E_API_KEY;
  delete process.env.RESPONSES_E2E_API_KEY;
  const sourceUrl = process.env.CHAPTER_E2E_SOURCE_URL;
  delete process.env.CHAPTER_E2E_SOURCE_URL;
  const ledgerPath = process.env.RESPONSES_E2E_LEDGER;
  if (!apiKey || !sourceUrl || !ledgerPath) throw new Error('Isolated authorized bridge unavailable');
  const upstream = await fetch(sourceUrl);
  if (!upstream.ok) throw new Error('Readonly project bridge unavailable');
  const source = jobSchema.parse(await upstream.json());
  const allowance = Number(process.env.CHAPTER_E2E_REQUEST_LIMIT ?? 2);
  const proxy = await startLiveResponsesProxy({baseUrl: process.env.RESPONSES_E2E_BASE_URL ?? 'https://api.deepseek.com', apiKey, ledgerPath, requestLimit: allowance, maxOutputTokens: null});
  const userData = info.outputPath('isolated-project-data');
  const store = new Store(join(userData, 'app.db'), {isEncryptionAvailable: () => false, encryptString: () => {throw new Error('No durable credentials');}, decryptString: () => {throw new Error('No durable credentials');}});
  const snapshot = {...source, id: randomUUID(), name: 'Chapter verification copy', options: optionsSchema.parse({...source.options, recognitionProfileId: undefined, translationProfileId: undefined, reviewProfileId: undefined, styleProfileId: undefined, chapterProfileId: undefined}), outputs: [], chapterPlan: undefined, customChapterPlan: undefined, reviewRun: undefined, reviewReport: undefined, repairRun: undefined, nameReport: undefined, nameBatch: undefined, previewUrl: undefined};
  try {store.saveJob(snapshot);} finally {store.close();}
  const {app, page} = await launchApp(userData, [], []);
  let passed = false;
  let requests = 0;
  try {
    await page.evaluate(async config => {
      const saved = await window.api.profiles.save({name: 'Isolated real chapter verification', protocol: 'openai', mode: 'responses', baseUrl: config.url, model: config.model, apiKey: 'loopback-session-only', sessionOnly: true, streaming: 'auto', timeoutMs: 120000, textTimeoutMs: 310000});
      if (!saved.success) throw new Error('Cannot configure isolated chapter service');
      const listed = await window.api.jobs.list();
      if (!listed.success || !listed.data[0]) throw new Error('Isolated project absent');
      const job = listed.data[0];
      const configured = await window.api.jobs.updateOptions({jobId: job.id, options: {...job.options, chapterProfileId: saved.data.id}});
      if (!configured.success) throw new Error('Cannot configure copied project');
    }, {url: proxy.url, model: process.env.RESPONSES_E2E_MODEL ?? 'deepseek-flash'});
    await page.reload();
    await expect(page.getByRole('button', {name: 'AI 检查字幕', exact: true})).toBeVisible();
    await page.getByRole('toolbar', {name: '视频操作'}).getByRole('button', {name: '章节', exact: true}).click();
    await page.getByRole('button', {name: 'AI 切分章节', exact: true}).click();
    async function terminal(count: number): Promise<string | undefined> {
      await expect.poll(async () => {
        const records = await responsesDiagnostics(page);
        return records.length >= count && ['published', 'failed'].includes(records[0]?.state ?? '');
      }, {timeout: 330000, intervals: [500, 1000]}).toBe(true);
      await expect(page.getByRole('button', {name: 'AI 检查字幕', exact: true})).toBeEnabled();
      const records = await responsesDiagnostics(page);
      proxy.finish(records);
      return records[0]?.state;
    }
    let state = await terminal(++requests);
    if (state === 'failed' && allowance > 1) {
      // Exercise the explicitly requested retry once, never an invisible replay.
      await page.getByRole('alert').getByRole('button', {name: '重试本次操作', exact: true}).click();
      state = await terminal(++requests);
    }
    expect(state, 'Actual long-project chapter result; failed records are retained').toBe('published');
    const job = await currentResponsesJob(page);
    const chapters = job.chapterPlan?.chapters ?? [];
    expect(job.chapterPlan?.state).toBe('current');
    expect(chapters.length).toBeGreaterThan(0);
    expect(chapters[0]?.startMs).toBe(0);
    expect(chapters.at(-1)?.endMs).toBe(source.media.durationMs);
    expect(chapters.every((item, index) => item.endMs > item.startMs && item.endMs - item.startMs <= 1200000 && (!index || chapters[index - 1]?.endMs === item.startMs))).toBe(true);
    expect(job.segments).toEqual(source.segments);
    passed = true;
  } finally {
    proxy.finish(await responsesDiagnostics(page));
    const outcomes = (await responsesDiagnostics(page)).map(item => ({id: item.id, state: item.state, errorCode: item.errorCode, targetCount: item.targetCount, elapsedMs: item.elapsedMs, textBytes: item.textBytes}));
    await app.close();
    await proxy.close();
    await writeFile(info.outputPath('project-live-outcomes.json'), JSON.stringify({passed, requests, cueCount: source.segments.length, durationMs: source.media.durationMs, originalProjectWritten: false, copiedProjectOnly: true, videoUploaded: false, outcomes}, null, 2));
    await info.attach('sanitized-project-ledger', {body: await readFile(ledgerPath), contentType: 'application/json'});
  }
});
