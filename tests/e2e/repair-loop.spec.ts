import { jobSetting, closeWorkspaceSettings } from './helpers';
import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import type { Job } from '../../src/shared/contracts';
import type SqliteDatabase from 'better-sqlite3';
import { join, resolve } from 'node:path';
import { addProfile, importVideo, launchApp, makeVideo, startMockServer } from './helpers';

async function currentJob(page: Page): Promise<Job> {
  return page.evaluate(async () => { const result = await window.api.jobs.list(); if (!result.success || !result.data[0]) throw new Error('Repair fixture missing'); return result.data[0]; });
}
async function controlGeometry(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const node = document.querySelector('.subtitle-list'); const controls = document.querySelector('dialog .repair-loop'); const panel = document.querySelector('.subtitle-panel'); const dialog = controls?.closest('dialog');
    if (!node || !controls || !panel || !dialog) throw new Error('Repair geometry missing');
    const clip = dialog.getBoundingClientRect();
    const fieldsFit = [...controls.querySelectorAll('input, select, button')].every((field) => {
      const rect = field.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.left >= clip.left && rect.right <= clip.right && rect.top >= clip.top && rect.bottom <= clip.bottom && Boolean(hit && field.contains(hit));
    });
    return { list: node.getBoundingClientRect().toJSON(), controls: controls.getBoundingClientRect().toJSON(), panel: panel.getBoundingClientRect().toJSON(), viewport: innerHeight, body: document.body.scrollHeight, fieldsFit, scrollTop: dialog.scrollTop };
  });
  expect(geometry.list.height).toBeGreaterThan(70);
  expect(geometry.list.bottom).toBeLessThanOrEqual(geometry.panel.bottom + 1);
  expect(geometry.controls.bottom).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.body).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.fieldsFit, 'Every repair field/action fits the dialog and receives pointer input').toBe(true);
  expect(geometry.scrollTop).toBe(0);
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
    await addProfile(page, 'Repair fixture', 'openai', mock.url);
    await (await jobSetting(page, '识别方式')).selectOption('cloud');
    await (await jobSetting(page, '语音识别服务')).selectOption({ label: 'Repair fixture' });
    await (await jobSetting(page, 'AI 检查服务（可选）')).selectOption({ label: 'Repair fixture' });
    await closeWorkspaceSettings(page);
    await expect(page.locator('.subtitle-panel > .repair-loop')).toHaveCount(0);
    await page.getByRole('button', { name: '字幕自动修复', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '字幕自动修复', exact: true })).toBeVisible();
    await page.getByLabel('自动修复范围', { exact: true }).selectOption('range');
    await page.getByLabel('自动修复开始（秒）', { exact: true }).fill('0.150');
    await page.getByLabel('自动修复结束（秒）', { exact: true }).fill('1.000');
    await controlGeometry(page);
    await page.screenshot({ path: info.outputPath('repair-range-default.png') });
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setSize(1050, 700); });
    await controlGeometry(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '字幕自动修复', exact: true })).toBeFocused();
    await page.getByLabel('编辑字幕 1', { exact: true }).click();
    await page.getByRole('button', { name: '字幕自动修复', exact: true }).click();
    await expect(page.getByLabel('自动修复开始（秒）', { exact: true })).toHaveValue('0.150');
    await expect(page.getByLabel('自动修复结束（秒）', { exact: true })).toHaveValue('1.000');
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
    expect(mock.counters.audit).toBe(2);
    const audit = JSON.parse(mock.auditPrompts[0]?.split('\n').at(-1) ?? '{}') as { oldChapter: { sourceText: string }[]; targets: { suspicion: unknown[] }[] };
    expect(audit.oldChapter).toHaveLength(2); expect(audit.targets[0]?.suspicion.length).toBeGreaterThan(0);
    expect(capped.reviewReport?.assessments?.every(assessment => assessment.status === 'current')).toBe(true);
    await expect(page.locator('.repair-loop__status')).toContainText('达到最大轮数');
    await page.getByLabel('自动修复最大轮数', { exact: true }).fill('21');
    await expect(page.getByRole('button', { name: '自动循环修复', exact: true })).toBeDisabled();
    await page.getByLabel('自动修复最大轮数', { exact: true }).fill('3');
    // Invalidate the grade, then cancel a held analysis response through visible UI.
    mock.behavior.review = 'slow';
    await page.evaluate(async () => { const result = await window.api.jobs.list(); if (!result.success || !result.data[0]?.segments[0]) throw new Error('Cancel cue missing'); const job = result.data[0]; const segment = job.segments[0]; if (!segment) throw new Error('Cue missing'); const edited = await window.api.jobs.editSegment({ jobId: job.id, revision: job.revision, segment: { ...segment, sourceText: 'Changed before cancellation.' } }); if (!edited.success) throw new Error(edited.error); });
    await page.getByRole('button', { name: '自动循环修复', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消自动修复', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await currentJob(page)).repairRun?.state).toBe('running');
    await page.getByRole('button', { name: '功能导航', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '功能导航', exact: true })).toBeVisible();
    await page.getByLabel('关闭对话框', { exact: true }).click();
    await page.getByRole('button', { name: '字幕自动修复', exact: true }).click();
    await page.getByRole('button', { name: '取消自动修复', exact: true }).click();
    await expect.poll(async () => (await currentJob(page)).repairRun?.state).toBe('cancelled');
    const cancelled = await currentJob(page); expect(cancelled.repairRun?.committedRounds).toBe(0); expect(cancelled.repairRun?.remainingCount).toBeUndefined();
    await expect(page.locator('.repair-loop__status')).toContainText('剩余疑点未知');
    await page.screenshot({ path: info.outputPath('repair-range-cancelled.png') });
    await app.close(); app = undefined;
    const restarted = await launchApp(userData, [], []); app = restarted.app;
    expect((await currentJob(restarted.page)).repairRun?.state).toBe('cancelled');
    await restarted.page.getByRole('button', { name: '字幕自动修复', exact: true }).click();
    await expect(restarted.page.getByLabel('自动修复范围', { exact: true })).toHaveValue('range');
    await expect(restarted.page.getByLabel('自动修复开始（秒）', { exact: true })).toHaveValue('0.150');
    await expect(restarted.page.getByRole('button', { name: '自动循环修复', exact: true })).toBeEnabled();
    expect(mock.counters.translation).toBe(0);
  } finally { if (app) await app.close(); await mock.close(); }
});


test('two chapters retain unchanged adjudications over capped rounds, persist grades and cancel all concurrent audits', async ({ playwright: _unused }, info) => {
  test.setTimeout(180_000);
  const mock = await startMockServer(); mock.behavior.review = 'graded'; mock.behavior.recognition = 'partial'; mock.behavior.audit = 'unchanged';
  const source = info.outputPath('chapter-repair.mp4'); await makeVideo(source);
  const userData = info.outputPath('chapter-repair-data'); let app: ElectronApplication | undefined;
  try {
    const launched = await launchApp(userData, [source], []); app = launched.app; let page = launched.page;
    await importVideo(page, true); await addProfile(page, 'Chapter repair fixture', 'openai', mock.url);
    await page.evaluate(async () => {
      const listed = await window.api.jobs.list(); const profiles = await window.api.profiles.list();
      if (!listed.success || !listed.data[0] || !profiles.success || !profiles.data[0]) throw new Error('Fixture missing');
      let job = listed.data[0]; const profile = profiles.data[0];
      const configured = await window.api.jobs.updateOptions({ jobId: job.id, options: { ...job.options, recognition: 'cloud', recognitionProfileId: profile.id, translationProfileId: profile.id, reviewProfileId: profile.id } });
      if (!configured.success) throw new Error(configured.error); job = configured.data;
      for (const cue of [
        { startMs: 100, endMs: 900, sourceText: 'MEDIUM: First suspicious statement.', translatedText: '第一句话。' },
        { startMs: 1000, endMs: 1500, sourceText: 'NONE: Stable chapter context.', translatedText: '稳定上下文。' },
        { startMs: 2200, endMs: 3800, sourceText: 'MEDIUM: Second suspicious statement.', translatedText: '第二句话。' },
      ]) {
        const added = await window.api.jobs.addSegment({ jobId: job.id, revision: job.revision, segment: cue }); if (!added.success) throw new Error(added.error); job = added.data;
      }
      // Applicable AI operations bootstrap short normal plans without a planning request.
      const planned = await window.api.jobs.reviewSubtitles({ jobId: job.id, revision: job.revision });
      if (!planned.success || !planned.data.chapterPlan) throw new Error('Plan missing'); job = planned.data;
      const plan = job.chapterPlan; if (!plan) throw new Error('Plan missing');
      const updated = await window.api.jobs.updateChapters({ jobId: job.id, revision: job.revision, planId: plan.id, planRevision: plan.revision, chapters: [
        { id: 'first', title: 'First', summary: '', startMs: 0, endMs: 2000 },
        { id: 'second', title: 'Second', summary: '', startMs: 2000, endMs: job.media.durationMs },
      ] }); if (!updated.success) throw new Error(updated.error);
    });
    const before = await currentJob(page);
    await page.getByRole('button', { name: '字幕自动修复', exact: true }).click();
    await page.getByLabel('自动修复最大轮数', { exact: true }).fill('2');
    await page.getByRole('button', { name: '自动循环修复', exact: true }).click();
    await expect.poll(async () => (await currentJob(page)).repairRun?.state).toBe('succeeded');
    const capped = await currentJob(page);
    expect(capped.repairRun).toMatchObject({ reason: 'max_rounds', committedRounds: 2, remainingCount: 2 });
    expect(capped.segments).toEqual(before.segments); expect(capped.chapterPlan?.chapters).toEqual(before.chapterPlan?.chapters);
    expect(mock.counters.audit).toBe(4); expect(mock.counters.translation).toBe(4); expect(mock.counters.chapters).toBe(0);
    const contexts = mock.auditPrompts.map(prompt => JSON.parse(prompt.split('\n').at(-1) ?? '{}') as { chapter: { id: string }; oldChapter: Job['segments']; newChapter: Job['segments']; targets: { id: string; suspicion: unknown[] }[] });
    // Requests within each round are concurrent; assert chapter ownership and
    // complete context rather than relying on HTTP arrival order.
    expect(new Set(contexts.map(payload => payload.chapter.id))).toEqual(new Set(['first', 'second']));
    for (const chapterId of ['first', 'second']) {
      const chapterRequests = contexts.filter(payload => payload.chapter.id === chapterId);
      const expectedContext = before.segments.filter(cue => chapterId === 'first' ? cue.startMs < 2000 : cue.startMs >= 2000);
      const expectedTargets = expectedContext.filter(cue => cue.sourceText.startsWith('MEDIUM:')).map(cue => cue.id);
      expect(chapterRequests).toHaveLength(2);
      for (const payload of chapterRequests) {
        expect(payload.oldChapter).toEqual(expectedContext);
        expect(payload.targets.map(target => target.id)).toEqual(expectedTargets);
        expect(payload.newChapter.some(cue => cue.startMs >= (chapterId === 'first' ? 0 : 2000) && cue.endMs <= (chapterId === 'first' ? 2000 : before.media.durationMs))).toBe(true);
        for (const contextOnly of expectedContext.filter(cue => !expectedTargets.includes(cue.id))) expect(payload.newChapter).toContainEqual(contextOnly);
      }
    }
    expect(contexts.every(payload => payload.newChapter.length && payload.targets.every(target => target.suspicion.length))).toBe(true);
    expect(capped.reviewReport?.assessments).toHaveLength(3);
    expect(capped.reviewReport?.assessments?.every(assessment => assessment.status === 'current')).toBe(true);
    await app.close(); app = undefined;
    const restarted = await launchApp(userData, [], []); app = restarted.app; page = restarted.page;
    const restored = await currentJob(page); expect(restored.repairRun).toEqual(capped.repairRun); expect(restored.reviewReport).toEqual(capped.reviewReport);
    expect(mock.counters.audit).toBe(4);
    // Hold both chapter audits to inspect actual concurrent requests, then cancel via UI.
    mock.behavior.audit = 'slow';
    await page.getByRole('button', { name: '字幕自动修复', exact: true }).click();
    await page.getByRole('button', { name: '自动循环修复', exact: true }).click();
    await expect.poll(() => mock.counters.audit).toBe(6);
    await expect.poll(async () => (await currentJob(page)).repairRun?.phase).toBe('adjudication');
    await page.screenshot({ path: info.outputPath('concurrent-audit-progress.png') });
    await page.getByRole('button', { name: '取消自动修复', exact: true }).click();
    await expect.poll(async () => (await currentJob(page)).repairRun?.state).toBe('cancelled');
    const cancelled = await currentJob(page); expect(cancelled.repairRun?.committedRounds).toBe(0); expect(cancelled.segments).toEqual(before.segments);
    await info.attach('chapter-repair-evidence', { body: JSON.stringify({ cappedRun: capped.repairRun, auditContextSizes: contexts.map(payload => [payload.oldChapter.length, payload.newChapter.length]), cancelledRun: cancelled.repairRun }), contentType: 'application/json' });
  } finally { if (app) await app.close(); await mock.close(); }
});

for (const outcome of ['success', 'failure', 'cancel'] as const) test(`final assessment-only check ${outcome} preserves persisted grades and UI badges after restart`, async ({ playwright: _unused }, info) => {
  test.setTimeout(120_000);
  const mock = await startMockServer(); mock.behavior.review = 'graded'; mock.behavior.recognition = 'partial';
  const source = info.outputPath('final-consistency.mp4'); await makeVideo(source);
  const userData = info.outputPath('final-consistency-data'); let app: ElectronApplication | undefined;
  try {
    const launched = await launchApp(userData, [source], []); app = launched.app; let page = launched.page;
    await importVideo(page, false); await addProfile(page, 'Final check fixture', 'openai', mock.url);
    await page.evaluate(async () => {
      const listed = await window.api.jobs.list(); const profiles = await window.api.profiles.list();
      if (!listed.success || !listed.data[0] || !profiles.success || !profiles.data[0]) throw new Error('Fixture missing');
      let job = listed.data[0]; const profile = profiles.data[0];
      const configured = await window.api.jobs.updateOptions({ jobId: job.id, options: { ...job.options, recognition: 'cloud', recognitionProfileId: profile.id, reviewProfileId: profile.id } });
      if (!configured.success) throw new Error(configured.error); job = configured.data;
      for (const segment of [
        { startMs: 100, endMs: 1800, sourceText: 'MEDIUM: Suspicious phrase needing repair.' },
        { startMs: 2200, endMs: 3800, sourceText: 'NONE: Stable context must retain its explicit grade.' },
      ]) {
        const added = await window.api.jobs.addSegment({ jobId: job.id, revision: job.revision, segment }); if (!added.success) throw new Error(added.error); job = added.data;
      }
      const reviewed = await window.api.jobs.reviewSubtitles({ jobId: job.id, revision: job.revision }); if (!reviewed.success) throw new Error(reviewed.error);
    });
    const before = await currentJob(page);
    // Fault injection is confined to this isolated SQLite fixture. It marks a
    // surviving dependency pending AFTER the last reassessment, exactly once.
    // No production hook or provider response bypass participates in the run.
    await app.evaluate((_electron, fixture) => {
      const load = process.getBuiltinModule('module').createRequire(fixture.modulePath);
      const Database = load('better-sqlite3') as typeof SqliteDatabase;
      const db = new Database(fixture.databasePath);
      try {
        db.exec(`CREATE TABLE e2e_final_check_injection (injected INTEGER PRIMARY KEY);
          CREATE TRIGGER e2e_final_check_pending AFTER UPDATE OF payload ON jobs
          WHEN json_extract(NEW.payload, '$.repairRun.phase') = 'final_consistency'
            AND NOT EXISTS (SELECT 1 FROM e2e_final_check_injection)
          BEGIN
            INSERT INTO e2e_final_check_injection VALUES (1);
            UPDATE jobs SET payload = json_set(NEW.payload,
              '$.reviewReport.assessments[' || (SELECT key FROM json_each(NEW.payload, '$.reviewReport.assessments')
                WHERE json_extract(value, '$.segmentId') = json_extract(NEW.payload, '$.segments[1].id')) || '].status', 'recheck')
              WHERE id = NEW.id;
          END;`);
      } finally { db.close(); }
    }, { modulePath: resolve('package.json'), databasePath: join(userData, 'app.db') });
    mock.behavior.reviewDelayAt = 3; mock.behavior.reviewDelayMs = 1800;
    if (outcome === 'failure') mock.behavior.reviewErrorAt = 3;
    if (outcome === 'cancel') mock.behavior.reviewHoldAt = 3;
    await page.getByRole('button', { name: '字幕自动修复', exact: true }).click();
    await page.getByLabel('自动修复最大轮数', { exact: true }).fill('1');
    await page.getByRole('button', { name: '自动循环修复', exact: true }).click();
    await expect.poll(() => mock.counters.review).toBe(3);
    await expect.poll(async () => (await currentJob(page)).repairRun?.phase).toBe('final_consistency');
    await expect(page.getByLabel('当前处理进度')).toContainText('结束前一致性补查');
    await expect(page.getByLabel('当前处理进度')).toContainText('第 1 / 1 轮');
    await page.screenshot({ path: info.outputPath('final-check-running.png') });
    if (outcome === 'cancel') await page.getByRole('button', { name: '取消自动修复', exact: true }).click();
    await expect.poll(async () => (await currentJob(page)).repairRun?.state).toBe(outcome === 'success' ? 'succeeded' : outcome === 'failure' ? 'failed' : 'cancelled');
    const completed = await currentJob(page);
    expect(completed.repairRun?.committedRounds).toBe(1); expect(completed.repairRun?.round).toBe(1);
    expect(completed.revision).toBe(before.revision + 1);
    expect(completed.segments[0]?.sourceText).toBe('Repaired source passage.');
    expect(completed.segments[1]).toEqual(before.segments[1]);
    const outsideId = before.segments[1]?.id;
    expect(completed.reviewReport?.assessments?.find(a => a.segmentId === outsideId)).toMatchObject({ status: outcome === 'success' ? 'current' : 'recheck', riskLevel: 'none' });
    expect(mock.counters.audit).toBe(1); expect(mock.counters.translation).toBe(0);
    const finalPrompt = mock.reviewPrompts[2];
    expect(finalPrompt).toContain('Stable context must retain its explicit grade.');
    const wire = JSON.parse(finalPrompt?.split('\n').find(line => line.startsWith('{"cues"')) ?? '{}') as { groups: { targets: number[] }[]; cues: unknown[] };
    expect(wire.groups.flatMap(group => group.targets)).toHaveLength(1); expect(wire.cues).toHaveLength(2);
    await page.keyboard.press('Escape');
    if (outcome === 'success') {
      await expect(page.getByTestId('segment-1').getByLabel('可疑度：无', { exact: true })).toBeVisible();
      expect(completed.reviewReport?.assessments?.every(a => a.status === 'current')).toBe(true);
    } else {
      expect(completed.repairRun?.remainingCount).toBeUndefined();
      expect(completed.repairRun?.errorMessage).toContain('最终状态检查');
      await expect(page.getByTestId('segment-1').getByLabel('上次可疑度：无，需复查', { exact: true })).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath('final-check-badges.png') });
    await app.close(); app = undefined;
    const restarted = await launchApp(userData, [], []); app = restarted.app; page = restarted.page;
    const persisted = await currentJob(page);
    expect(persisted.reviewReport).toEqual(completed.reviewReport); expect(persisted.repairRun).toEqual(completed.repairRun);
    await expect(page.getByTestId('segment-1').getByLabel(outcome === 'success' ? '可疑度：无' : '上次可疑度：无，需复查', { exact: true })).toBeVisible();
    expect(mock.counters.review).toBe(3); expect(mock.counters.audit).toBe(1);
    await info.attach('final-check-persisted-evidence', { body: JSON.stringify({ outcome, run: persisted.repairRun, grades: persisted.reviewReport?.assessments, finalTargets: wire.groups.flatMap(group => group.targets), fullContextCues: wire.cues.length }), contentType: 'application/json' });
  } finally { if (app) await app.close(); await mock.close(); }
});
