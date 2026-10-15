import { test, expect } from '@playwright/test';
import { importVideo, launchApp, makeVideo } from './helpers';
import { assertResponsesArtifacts, currentResponsesJob, responsesDiagnostics, runResponsesOperation, seedResponses, startReasoningResponses } from './responses-helpers';

test('reasoning-first Responses publish chapters, subtitle assessments and global names through actual Electron', async ({playwright: _}, info) => {
  test.setTimeout(180000);
  const fixture = await startReasoningResponses();
  const input = info.outputPath('synthetic-responses.mp4');
  const userData = info.outputPath('isolated-responses-data');
  await makeVideo(input);
  let {app, page} = await launchApp(userData, [input], []);
  try {
    await importVideo(page);
    await seedResponses(page, {baseUrl: fixture.url, model: 'reasoning-first-fixture', apiKey: 'non-secret-synthetic-key'});
    for (const operation of ['chapters', 'review', 'names'] as const) {
      const diagnostic = await runResponsesOperation(page, operation);
      await assertResponsesArtifacts(page, userData, [diagnostic]);
    }
    const job = await currentResponsesJob(page);
    expect(job.chapterPlan?.state).toBe('current');
    expect(job.chapterPlan?.chapters.length).toBeGreaterThan(0);
    expect(job.reviewReport?.assessments?.filter(item => item.status === 'current')).toHaveLength(2);
    expect(job.nameReport?.state).toBe('current');
    expect(job.nameReport?.candidates).toHaveLength(1);
    expect(job.nameReport?.candidates[0]?.cueCount).toBe(2);
    expect(fixture.counts).toEqual({chapters: 1, review: 1, names: 1, translate: 0, style: 0});
    const before = await responsesDiagnostics(page);
    expect(before).toHaveLength(3);
    await app.close();
    ({app, page} = await launchApp(userData, [], []));
    const restarted = await currentResponsesJob(page);
    expect(restarted.chapterPlan).toEqual(job.chapterPlan);
    expect(restarted.reviewReport).toEqual(job.reviewReport);
    expect(restarted.nameReport).toEqual(job.nameReport);
    await assertResponsesArtifacts(page, userData, await responsesDiagnostics(page));
    expect(fixture.counts).toEqual({chapters: 1, review: 1, names: 1, translate: 0, style: 0});
    await page.screenshot({path: info.outputPath('responses-three-operations-published.png')});
  } finally {
    await app.close();
    await fixture.close();
  }
});
