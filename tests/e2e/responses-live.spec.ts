import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importVideo, launchApp, makeVideo } from './helpers';
import { assertResponsesArtifacts, currentResponsesJob, responsesDiagnostics, runResponsesOperation, seedResponses, startLiveResponsesProxy } from './responses-helpers';
import type { ProviderDiagnostic } from '../../src/shared/provider-diagnostics-contracts';

// Explicitly prevent Playwright from persisting the session-only credential argument.
test.use({trace: 'off', video: 'off', screenshot: 'off'});

test('authorized live Responses chapter planning, subtitle review and global names publish synthetic results', async ({playwright: _}, info) => {
  test.skip(process.env.APP_LIVE_RESPONSES !== '1', 'Requires explicit user authorization and a durable three-request ledger');
  test.setTimeout(1050000);
  const apiKey = process.env.RESPONSES_E2E_API_KEY;
  delete process.env.RESPONSES_E2E_API_KEY;
  const ledgerPath = process.env.RESPONSES_E2E_LEDGER;
  if (!apiKey || !ledgerPath) throw new Error('Live Responses requires an in-memory credential and explicit absolute ledger path');
  const input = info.outputPath('synthetic-live-responses.mp4');
  const userData = info.outputPath('isolated-live-responses-data');
  await makeVideo(input);
  const proxy = await startLiveResponsesProxy({baseUrl: process.env.RESPONSES_E2E_BASE_URL ?? 'https://api.deepseek.com', apiKey, ledgerPath});
  const {app, page} = await launchApp(userData, [input], []).catch(async () => {
    await proxy.close();
    throw new Error('Cannot launch isolated live Responses application');
  });
  const records: ProviderDiagnostic[] = [];
  const failures: string[] = [];
  try {
    await importVideo(page);
    await seedResponses(page, {baseUrl: proxy.url, model: process.env.RESPONSES_E2E_MODEL ?? 'deepseek-flash', apiKey: 'loopback-proxy-session-only'});
    for (const operation of ['chapters', 'review', 'names'] as const) {
      try {
        const record = await runResponsesOperation(page, operation);
        records.push(record);
        if (record.state !== 'published') failures.push(`${operation}: ${record.errorCode ?? record.state}`);
      } catch {
        failures.push(`${operation}: native operation did not reach a terminal diagnostic`);
      }
      proxy.finish(await responsesDiagnostics(page));
      // A protocol/validation failure invalidates the shared live hypothesis.
      // Stop rather than spending the remaining authorized requests on it.
      if (failures.length) break;
    }
    expect(failures, 'Actual upstream outcomes; local fixture coverage is not live-service success').toEqual([]);
    await assertResponsesArtifacts(page, userData, records);
    const job = await currentResponsesJob(page);
    expect(job.chapterPlan?.state).toBe('current');
    expect(job.reviewReport?.assessments?.filter(item => item.status === 'current')).toHaveLength(2);
    expect(job.nameReport?.state).toBe('current');
    expect(records).toHaveLength(3);
  } finally {
    try {proxy.finish(await responsesDiagnostics(page));}
    finally {
      try {await app.close();}
      finally {
        try {await proxy.close();}
        finally {
          // Ledger contains event names/index counts/status only; never attach answer bodies or prompts.
          await info.attach('sanitized-live-request-ledger', {body: await readFile(ledgerPath), contentType: 'application/json'});
        }
      }
    }
  }
});
