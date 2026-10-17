import { test, expect, type Page, type ElectronApplication } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, watch } from 'node:fs';
import { mkdir, copyFile, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type SqliteDatabase from 'better-sqlite3';
import { CPU_ARTIFACT, ENGINE_VERSION, MODELS } from '../../src/main/services/runtime/manifest';
import { importVideo, launchApp, makeVideo } from './helpers';
import { currentResponsesJob, responsesDiagnostics, startLiveResponsesProxy } from './responses-helpers';
import { readBackendReceipt } from './gpu-helpers';

// No Playwright trace may serialize credential arguments or upstream answer bodies.
test.use({trace: 'off', video: 'off', screenshot: 'off'});

async function hash(path: string): Promise<string> {
  const value = createHash('sha256');
  for await (const bytes of createReadStream(path)) value.update(bytes);
  return value.digest('hex');
}

async function seedCpu(userData: string): Promise<void> {
  const cache = resolve('.runtime-cache/whisper');
  for (const [name, artifact] of [['cpu.zip', CPU_ARTIFACT], ['ggml-base.bin', MODELS.base]] as const) {
    const path = join(cache, name);
    if ((await stat(path)).size !== artifact.sizeBytes || await hash(path) !== artifact.sha256) throw new Error(`Pinned native asset verification failed: ${name}`);
  }
  await mkdir(userData, {recursive: true});
  const cpuDirectory = join(userData, 'verified-cpu');
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:LIVE_CPU_ARCHIVE -DestinationPath $env:LIVE_CPU_DESTINATION -Force'], {
    windowsHide: true, env: {...process.env, LIVE_CPU_ARCHIVE: join(cache, 'cpu.zip'), LIVE_CPU_DESTINATION: cpuDirectory},
  });
  const modelPath = join(userData, 'ggml-base.bin');
  await copyFile(join(cache, 'ggml-base.bin'), modelPath);
  await writeFile(join(userData, 'runtime-state.json'), JSON.stringify({version: 1, engineVersion: ENGINE_VERSION, cpuDirectory, gpuReady: false, message: 'Isolated verified CPU runtime and Base model for actual-service validation.', models: {base: {path: modelPath, size: MODELS.base.sizeBytes}}}));
}

function watchNativeReceipts(directory: string): {receipts: Map<string, {backend: string; gpuExecutionVerified: boolean}>; close(): void} {
  const receipts = new Map<string, {backend: string; gpuExecutionVerified: boolean}>();
  const watcher = watch(directory, (_event, filename) => {
    if (!filename || !/^partial-.+-recognition-backend\.json$/.test(filename)) return;
    // Synchronous reads on create/change avoid racing queued asynchronous reads
    // against operation-owned cleanup of these short-lived files.
    try {
      const value = JSON.parse(readFileSync(join(directory, filename), 'utf8')) as {backend: string; gpuExecutionVerified: boolean};
      receipts.set(filename, {backend: value.backend, gpuExecutionVerified: value.gpuExecutionVerified});
    } catch { /* Creation may precede the complete write; change retries it. */ }
  });
  return {receipts, close: () => watcher.close()};
}

async function subdivideSingleNativeCue(page: Page): Promise<{nativeCueCount: number; contextCueCount: number; manualSubdivision: boolean}> {
  return page.evaluate(async () => {
    const listed = await window.api.jobs.list();
    if (!listed.success || !listed.data[0]) throw new Error('Native context absent');
    let job = listed.data[0]; const nativeCueCount = job.segments.length;
    if (nativeCueCount === 1) {
      const cue = job.segments[0]; if (!cue) throw new Error('Native cue absent');
      const words = cue.sourceText.trim().split(/\s+/);
      const middle = Math.floor(words.length / 2);
      if (middle < 2 || cue.endMs - cue.startMs < 2000) throw new Error('Public fixture cannot be subdivided');
      const boundary = Math.round((cue.startMs + cue.endMs) / 2);
      const edited = await window.api.jobs.editSegment({jobId: job.id, revision: job.revision, segment: {...cue, endMs: boundary - 10, sourceText: words.slice(0, middle).join(' ')}});
      if (!edited.success) throw new Error(edited.code); job = edited.data;
      const added = await window.api.jobs.addSegment({jobId: job.id, revision: job.revision, segment: {startMs: boundary + 10, endMs: cue.endMs, sourceText: words.slice(middle).join(' '), translatedText: ''}});
      if (!added.success) throw new Error(added.code); job = added.data;
      if (job.segments.map(segment => segment.sourceText).join(' ') !== words.join(' ')) throw new Error('Native transcript content was not preserved');
    }
    return {nativeCueCount, contextCueCount: job.segments.length, manualSubdivision: nativeCueCount === 1};
  });
}

test('actual local partial ASR precheck observes fresh temporary CPU receipts without AI', async ({playwright: _}, info) => {
  test.skip(process.env.APP_LIVE_NATIVE_PRECHECK !== '1', 'Opt-in real CPU receipt-observer verification, no paid provider calls');
  test.setTimeout(180000);
  const input = info.outputPath('public-native-precheck.mp4');
  // whisper.cpp uses narrow Windows file APIs; keep temporary partial-ASR
  // paths below MAX_PATH after both native UUID filename prefixes are added.
  const userData = resolve('.native-smoke', `cai-native-${Date.now()}`);
  await makeVideo(input, true); await seedCpu(userData);
  const {app, page} = await launchApp(userData, [input], []);
  try {
    await importVideo(page, false);
    await page.evaluate(async () => {
      const listed = await window.api.jobs.list();
      if (!listed.success || !listed.data[0]) throw new Error('Native precheck job absent');
      const job = listed.data[0];
      const options = await window.api.jobs.updateOptions({jobId: job.id, options: {...job.options, recognition: 'local', modelId: 'base', preferGpu: false, sourceLanguage: 'en'}});
      if (!options.success) throw new Error(options.code);
      const result = await window.api.jobs.recognize(job.id);
      if (!result.success) throw new Error(result.code);
      return result.data;
    });
    const subdivision = await subdivideSingleNativeCue(page);
    const recognized = await currentResponsesJob(page);
    const observer = watchNativeReceipts(join(userData, 'jobs', recognized.id));
    try {
      const outcome = await page.evaluate(async job => window.api.jobs.recognizePartial({jobId: job.id, revision: job.revision, target: {mode: 'selection', segmentIds: job.segments.map(cue => cue.id)}, translate: false}), recognized);
      expect(outcome.success ? {success: true} : {success: false, code: outcome.code, error: outcome.error}).toEqual({success: true});
      expect(observer.receipts.size).toBeGreaterThan(0);
      expect([...observer.receipts.values()].every(value => value.backend === 'cpu' && !value.gpuExecutionVerified)).toBe(true);
      const diagnostics = await responsesDiagnostics(page);
      expect(diagnostics).toHaveLength(0);
      await writeFile(info.outputPath('native-precheck-evidence.json'), JSON.stringify({actualBackend: 'cpu', subdivision, timingCaveat: 'A single native cue is manually split in half with a 20ms gap to exercise two independent fresh ASR intervals; original transcript preserved, manual boundaries are not acoustic alignment evidence.', freshReceiptCount: observer.receipts.size, receipts: [...observer.receipts.values()], aiRequests: diagnostics.length}, null, 2));
    } finally {observer.close();}
  } finally {await app.close();}
});

async function configure(page: Page, baseUrl: string, model: string, language: string): Promise<void> {
  await page.evaluate(async ({baseUrl, model, language}) => {
    const profiles = await window.api.profiles.list();
    const existing = profiles.success ? profiles.data[0] : undefined;
    const saved = await window.api.profiles.save({id: existing?.id, name: 'Authorized isolated chapter verification', protocol: 'openai', mode: 'responses', baseUrl, model, apiKey: 'nonsecret-loopback-session', sessionOnly: true, streaming: 'auto', textConcurrency: 2, timeoutMs: 120000, textTimeoutMs: 300000});
    if (!saved.success) throw new Error(`Live profile: ${saved.code}`);
    const listed = await window.api.jobs.list();
    const job = listed.success ? listed.data[0] : undefined;
    if (!job) throw new Error('Live fixture absent');
    const configured = await window.api.jobs.updateOptions({jobId: job.id, options: {...job.options, recognition: 'local', modelId: 'base', preferGpu: false, sourceLanguage: language, targetLanguage: 'zh-CN', reviewProfileId: saved.data.id, chapterProfileId: saved.data.id, translationProfileId: saved.data.id, styleProfileId: saved.data.id}});
    if (!configured.success) throw new Error(`Live options: ${configured.code}`);
  }, {baseUrl, model, language});
}

test('authorized actual chapter AI and native JFK repair preserve persisted current grades', async ({playwright: _}, info) => {
  test.skip(process.env.APP_LIVE_CHAPTER_AI !== '1', 'Requires explicit paid-service authorization and durable cumulative ledger');
  test.setTimeout(2400000);
  const apiKey = process.env.RESPONSES_E2E_API_KEY;
  delete process.env.RESPONSES_E2E_API_KEY;
  const ledgerPath = process.env.RESPONSES_E2E_LEDGER;
  if (!apiKey || !ledgerPath) throw new Error('Memory-only key and durable ledger required');
  const evidenceDirectory = resolve('.trellis/tasks/10-16-chapter-ai-repair/evidence');
  await mkdir(evidenceDirectory, {recursive: true});
  const proxy = await startLiveResponsesProxy({baseUrl: process.env.RESPONSES_E2E_BASE_URL ?? 'https://api.deepseek.com', apiKey, ledgerPath, requestLimit: 30, maxOutputTokens: null});
  const namesInput = info.outputPath('synthetic-names.mp4');
  const input = info.outputPath('public-jfk.mp4');
  const userData = resolve('.native-smoke', `cai-actual-${Date.now()}`);
  await makeVideo(namesInput); await makeVideo(input, true); await seedCpu(userData);
  let app: ElectronApplication | undefined;
  const evidence: Record<string, unknown> = {paid: 'Actual configured Responses service; synthetic public names only, no original private subtitles uploaded', acoustic: 'Actual local CPU Whisper Base on public JFK fixture; pinned runtime/model hashes verified', seededSuspicion: 'Explicit test-only medium grades injected into isolated SQLite to guarantee a complete repair; not a model detection claim'};
  try {
    const verifiedNamesFile = process.env.APP_LIVE_VERIFIED_NAMES_FILE;
    let launched = await launchApp(userData, verifiedNamesFile ? [input] : [namesInput, input], []); app = launched.app; let page = launched.page;
    if (verifiedNamesFile) {
      evidence.names = JSON.parse(await readFile(verifiedNamesFile, 'utf8')) as unknown;
    } else {
    await importVideo(page); await configure(page, proxy.url, process.env.RESPONSES_E2E_MODEL ?? 'deepseek-flash', 'ja');
    await page.evaluate(async () => {
      const listed = await window.api.jobs.list(); if (!listed.success || !listed.data[0]) throw new Error('Names job absent');
      let job = listed.data[0];
      for (const cue of [
        {startMs: 100, endMs: 1700, sourceText: 'アレックスSmithが今日駅に来た。', translatedText: '今天Alex到了车站。'},
        {startMs: 2000, endMs: 3800, sourceText: 'アレックスSmithは私の弟です。彼が駅から電話した。', translatedText: '我的弟弟Alex从车站给我打了电话。'},
      ]) {
        const added = await window.api.jobs.addSegment({jobId: job.id, revision: job.revision, segment: cue});
        if (!added.success) throw new Error(added.code); job = added.data;
      }
      const names = await window.api.jobs.analyzeNames({jobId: job.id, revision: job.revision});
      if (!names.success) throw new Error(`Actual names failed: ${names.code}`);
    });
    const names = await currentResponsesJob(page);
    expect(names.chapterPlan).toBeUndefined();
    expect(names.nameReport?.state).toBe('current');
    expect(names.nameReport?.candidates).toHaveLength(1);
    expect(names.nameReport?.candidates[0]?.sourceAliases).toContain('アレックスSmith');
    expect(names.nameReport?.candidates[0]?.translatedAliases).toContain('Alex');
    evidence.names = {candidates: names.nameReport?.candidates.length, chapterPlanAbsent: !names.chapterPlan};
    proxy.finish(await responsesDiagnostics(page));
    await writeFile(join(evidenceDirectory, 'actual-names-result.json'), JSON.stringify(evidence.names, null, 2));
    }
    await importVideo(page); await configure(page, proxy.url, process.env.RESPONSES_E2E_MODEL ?? 'deepseek-flash', 'en');
    const recognizedAt = Date.now();
    await page.evaluate(async () => {
      const listed = await window.api.jobs.list(); if (!listed.success || !listed.data[0]) throw new Error('JFK job absent');
      const recognized = await window.api.jobs.recognize(listed.data[0].id);
      if (!recognized.success) throw new Error(`Actual native recognition: ${recognized.code}`);
    });
    const subdivision = await subdivideSingleNativeCue(page);
    await page.evaluate(async () => {
      const listed = await window.api.jobs.list(); if (!listed.success || !listed.data[0]) throw new Error('Native context absent');
      const recognized = listed.data[0];
      const planned = await window.api.jobs.planChapters({jobId: recognized.id, revision: recognized.revision, kind: 'normal'});
      if (!planned.success || !planned.data.chapterPlan) throw new Error(`Actual chapter planning: ${!planned.success ? planned.code : 'NO_PLAN'}`);
      const job = planned.data; const plan = planned.data.chapterPlan;
      const ordered = [...job.segments].sort((a, b) => a.startMs - b.startMs);
      const middle = ordered[Math.floor(ordered.length / 2)];
      if (ordered.length < 2 || !middle) throw new Error('Actual speech fixture needs at least two cues for concurrency');
      const updated = await window.api.jobs.updateChapters({jobId: job.id, revision: job.revision, planId: plan.id, planRevision: plan.revision, chapters: [
        {id: 'actual-first', title: 'JFK first chapter', summary: '', startMs: 0, endMs: middle.startMs},
        {id: 'actual-second', title: 'JFK second chapter', summary: '', startMs: middle.startMs, endMs: job.media.durationMs},
      ]});
      if (!updated.success) throw new Error(`Actual chapter boundary edit: ${updated.code}`);
    });
    const recognized = await currentResponsesJob(page);
    const receipt = await readBackendReceipt(userData, recognized.id);
    expect(receipt.backend).toBe('cpu'); expect(receipt.gpuExecutionVerified).toBe(false);
    expect(recognized.segments.length).toBeGreaterThanOrEqual(2);
    expect(recognized.segments.some(cue => /country|fellow/i.test(cue.sourceText))).toBe(true);
    evidence.recognition = {segments: recognized.segments.length, subdivision, timingCaveat: 'Concurrency fixture may manually subdivide a single native cue at its midpoint with a 20ms gap. Original recognized transcript is preserved; those boundaries are not claimed as native or independently aligned.', backend: receipt.backend, wallTimeMs: Date.now() - recognizedAt};
    for (const operation of ['translate', 'review', 'style'] as const) {
      const previous = new Set((await responsesDiagnostics(page)).map(record => record.id));
      const outcome = await page.evaluate(async operation => {
        const listed = await window.api.jobs.list(); if (!listed.success || !listed.data[0]) throw new Error('JFK job absent'); const job = listed.data[0];
        const result = operation === 'translate' ? await window.api.jobs.translate({jobId: job.id}) : operation === 'review' ? await window.api.jobs.reviewSubtitles({jobId: job.id, revision: job.revision}) : await window.api.jobs.designStyle({jobId: job.id, prompt: 'Use a readable clean consistent style. Emphasize only exact meaningful words, otherwise leave emphasis empty.'});
        return result.success ? {success: true} : {success: false, code: result.code};
      }, operation);
      expect(outcome, `Actual ${operation} must validate and publish`).toEqual({success: true});
      const published = (await responsesDiagnostics(page)).filter(record => !previous.has(record.id) && record.state === 'published');
      expect(published).toHaveLength(2);
      expect(new Set(published.map(record => record.chapterId))).toEqual(new Set(['actual-first', 'actual-second']));
      proxy.finish(await responsesDiagnostics(page));
    }
    const checked = await currentResponsesJob(page);
    expect(checked.chapterPlan?.id).toBe(recognized.chapterPlan?.id);
    expect(checked.chapterPlan?.revision).toBe(recognized.chapterPlan?.revision);
    expect(checked.segments.every(cue => cue.translatedText.trim())).toBe(true);
    expect(checked.reviewReport?.assessments?.every(assessment => assessment.status === 'current')).toBe(true);
    const seeded = structuredClone(checked); const report = seeded.reviewReport;
    if (!report?.assessments || !report.contextGroups) throw new Error('Actual graded report missing');
    report.findings = report.assessments.map((assessment, i) => ({id: `live-seed-${i}`, segmentId: assessment.segmentId, category: 'source' as const, reason: 'TEST SEEDED medium suspicion to exercise native repair; not an actual model detection.', status: 'pending' as const, riskLevel: 'medium' as const, ruleId: 'source.meaning_problem', evidenceIds: [assessment.segmentId], contextGroupId: assessment.contextGroupId}));
    report.assessments = report.assessments.map((assessment, i) => ({...assessment, riskLevel: 'medium', status: 'current', findingIds: [`live-seed-${i}`]}));
    await app.evaluate((_electron, fixture) => {
      const load = process.getBuiltinModule('module').createRequire(fixture.modulePath);
      const Database = load('better-sqlite3') as typeof SqliteDatabase;
      const db = new Database(fixture.databasePath);
      try {db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(fixture.job), fixture.job.id);} finally {db.close();}
    }, {databasePath: join(userData, 'app.db'), modulePath: resolve('package.json'), job: seeded});
    await app.close(); app = undefined;
    launched = await launchApp(userData, [], []); app = launched.app; page = launched.page;
    await configure(page, proxy.url, process.env.RESPONSES_E2E_MODEL ?? 'deepseek-flash', 'en');
    const repairStartedAt = Date.now();
    // Partial ASR uses temporary prefixed receipts and removes them after
    // drafting. Observe these real native receipts while the repair runs;
    // the original full-recognition receipt must not masquerade as fresh ASR.
    const nativeWatcher = watchNativeReceipts(join(userData, 'jobs', seeded.id));
    const nativeReceipts = nativeWatcher.receipts;
    let outcome: {success: boolean; code?: string};
    try { outcome = await page.evaluate(async () => {
      const listed = await window.api.jobs.list(); if (!listed.success || !listed.data[0]) throw new Error('Seeded job absent'); const job = listed.data[0];
      const result = await window.api.jobs.repairLoop({jobId: job.id, revision: job.revision, threshold: 'medium', maxRounds: 1, scope: {mode: 'all'}});
      return result.success ? {success: true} : {success: false, code: result.code};
    }); } finally {nativeWatcher.close();}
    proxy.finish(await responsesDiagnostics(page));
    expect(outcome, 'Actual repair must perform fresh native ASR, real translations and audit').toEqual({success: true});
    const repaired = await currentResponsesJob(page);
    expect(repaired.repairRun?.state).toBe('succeeded'); expect(repaired.repairRun?.committedRounds).toBe(1);
    const assessments = repaired.reviewReport?.assessments;
    expect(assessments).toHaveLength(repaired.segments.length);
    for (const cue of repaired.segments) expect(assessments?.find(item => item.segmentId === cue.id)?.status).toBe('current');
    expect(repaired.reviewReport?.findings.some(finding => finding.id.startsWith('live-seed-'))).toBe(false);
    evidence.repair = {run: repaired.repairRun, wallTimeMs: Date.now() - repairStartedAt, segments: repaired.segments.length, grades: assessments?.map(item => ({status: item.status, riskLevel: item.riskLevel}))};
    expect(nativeReceipts.size, 'Fresh partial-recognition native receipts were observed during this repair').toBeGreaterThan(0);
    expect([...nativeReceipts.values()].every(value => value.backend === 'cpu' && value.gpuExecutionVerified === false)).toBe(true);
    evidence.freshRepairRecognition = {count: nativeReceipts.size, receipts: [...nativeReceipts.values()]};
    await page.reload();
    await expect(page.getByText('正在读取本地项目与引擎状态…')).not.toBeVisible();
    await expect(page.getByLabel(/^可疑度：[无低中高]$/)).toHaveCount(repaired.segments.length);
    await page.screenshot({path: join(evidenceDirectory, 'actual-repair-final.png')});
    await app.close(); app = undefined;
    const exportPath = info.outputPath('actual-repaired.srt');
    launched = await launchApp(userData, [], [exportPath]); app = launched.app; page = launched.page;
    const restored = await currentResponsesJob(page);
    expect(restored.reviewReport).toEqual(repaired.reviewReport); expect(restored.repairRun).toEqual(repaired.repairRun);
    expect(await page.getByLabel('待重新检查', {exact: true}).count()).toBe(0);
    expect(await page.getByLabel(/^可疑度：[无低中高]$/).count()).toBe(restored.segments.length);
    const records = await responsesDiagnostics(page);
    expect(records.every(record => record.state === 'published' || (record.state === 'failed' && records.some(other => other.runId === record.runId && other.state === 'published')))).toBe(true);
    for (const record of records) expect(await readdir(join(userData, 'ai-responses', record.id))).toEqual(['answer.complete.txt']);
    evidence.requests = records.map(record => ({operation: record.operation, chapterId: record.chapterId, state: record.state, model: record.model, targetCount: record.targetCount, streamActual: record.streamActual}));
    proxy.finish(records);
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as {calls: {activeAtStart?: number}[]};
    const peak = Math.max(...ledger.calls.map(call => call.activeAtStart ?? 0));
    expect(peak).toBe(2);
    evidence.observedConcurrentUpstreamRequests = peak;
    evidence.restartCurrentGradeCount = restored.reviewReport?.assessments?.filter(item => item.status === 'current').length;
    const exported = await page.evaluate(jobId => window.api.jobs.export({jobId, format: 'srt'}), restored.id);
    expect(exported.success).toBe(true);
    const subtitles = await readFile(exportPath, 'utf8');
    expect(subtitles).toContain('-->');
    expect(subtitles).toContain(restored.segments[0]?.translatedText ?? 'MISSING_TRANSLATION');
    evidence.repairedSubtitleExport = {bytes: Buffer.byteLength(subtitles), format: 'srt'};
    await writeFile(join(evidenceDirectory, 'actual-services-result.json'), JSON.stringify(evidence, null, 2));
  } finally {
    try {if (app) {proxy.finish(await responsesDiagnostics(await app.firstWindow())); await app.close();}}
    finally {await proxy.close(); await info.attach('sanitized-cumulative-ledger', {body: await readFile(ledgerPath), contentType: 'application/json'});}
  }
});

type RepairCheckpoint = {userData: string; jobId: string; revision: number; proxyPort: number; profileId: string; model: string; segmentsFingerprint: string; reviewFingerprint: string; chapterFingerprint: string};
const contentHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function restoreRepairCheckpoint(page: Page, checkpoint: RepairCheckpoint, proxyUrl: string): Promise<void> {
  expect(proxyUrl).toBe(`http://127.0.0.1:${checkpoint.proxyPort}/v1`);
  const before = await currentResponsesJob(page);
  expect(before.id).toBe(checkpoint.jobId); expect(before.revision).toBe(checkpoint.revision);
  expect(before.repairRun).toMatchObject({state: 'failed', committedRounds: 0, errorCode: 'TRUNCATED'});
  await configure(page, proxyUrl, checkpoint.model, 'en');
  const restored = await currentResponsesJob(page);
  expect(restored.revision).toBe(checkpoint.revision);
  expect(contentHash(restored.segments)).toBe(checkpoint.segmentsFingerprint);
  expect(contentHash(restored.reviewReport)).toBe(checkpoint.reviewFingerprint);
  expect(contentHash(restored.chapterPlan)).toBe(checkpoint.chapterFingerprint);
  const profiles = await page.evaluate(() => window.api.profiles.list());
  expect(profiles.success && profiles.data.find(profile => profile.id === checkpoint.profileId)).toMatchObject({baseUrl: proxyUrl, model: checkpoint.model});
}

test('actual repair checkpoint identity preflight without AI', async ({playwright: _}, info) => {
  test.skip(process.env.APP_LIVE_REPAIR_PREFLIGHT !== '1', 'Opt-in no-AI persisted failed-repair identity verification');
  const checkpoint = JSON.parse(await readFile(process.env.APP_LIVE_REPAIR_RESUME_FILE ?? '', 'utf8')) as RepairCheckpoint;
  const {app, page} = await launchApp(checkpoint.userData, [], []);
  try {
    const records = await responsesDiagnostics(page);
    await restoreRepairCheckpoint(page, checkpoint, `http://127.0.0.1:${checkpoint.proxyPort}/v1`);
    expect(await responsesDiagnostics(page)).toEqual(records);
    await writeFile(info.outputPath('resume-identity-preflight.json'), JSON.stringify({sameJob: true, sameRevision: true, sameSegments: true, sameReview: true, sameChapterPlan: true, sameProfileAndLoopback: true, newAiRequests: 0}, null, 2));
  } finally {await app.close();}
});

test('authorized actual repair continuation retains failed attempt and persists current grades', async ({playwright: _}, info) => {
  test.skip(process.env.APP_LIVE_CHAPTER_AI !== '1' || !process.env.APP_LIVE_REPAIR_RESUME_FILE, 'Requires authorized cumulative ledger and independently verified failed-repair checkpoint');
  test.setTimeout(1200000);
  const apiKey = process.env.RESPONSES_E2E_API_KEY; delete process.env.RESPONSES_E2E_API_KEY;
  const ledgerPath = process.env.RESPONSES_E2E_LEDGER;
  if (!apiKey || !ledgerPath) throw new Error('Memory-only credential and durable ledger required');
  const checkpoint = JSON.parse(await readFile(process.env.APP_LIVE_REPAIR_RESUME_FILE ?? '', 'utf8')) as RepairCheckpoint;
  const proxy = await startLiveResponsesProxy({baseUrl: process.env.RESPONSES_E2E_BASE_URL ?? 'https://api.deepseek.com', apiKey, ledgerPath, requestLimit: 30, maxOutputTokens: null, listenPort: checkpoint.proxyPort});
  let app: ElectronApplication | undefined;
  const evidenceDirectory = resolve('.trellis/tasks/10-16-chapter-ai-repair/evidence');
  try {
    let launched = await launchApp(checkpoint.userData, [], []); app = launched.app; let page = launched.page;
    await restoreRepairCheckpoint(page, checkpoint, proxy.url);
    const previous = await responsesDiagnostics(page); const oldIds = new Set(previous.map(record => record.id));
    const native = watchNativeReceipts(join(checkpoint.userData, 'jobs', checkpoint.jobId));
    const startedAt = Date.now();
    let outcome: {success: boolean; code?: string};
    try {outcome = await page.evaluate(async jobId => {
      const listed = await window.api.jobs.list(); const job = listed.success ? listed.data.find(job => job.id === jobId) : undefined;
      if (!job) throw new Error('Repair checkpoint job absent');
      const result = await window.api.jobs.repairLoop({jobId: job.id, revision: job.revision, threshold: 'medium', maxRounds: 1, scope: {mode: 'all'}});
      return result.success ? {success: true} : {success: false, code: result.code};
    }, checkpoint.jobId);} finally {native.close();}
    const records = await responsesDiagnostics(page); proxy.finish(records);
    expect(outcome).toEqual({success: true});
    const repaired = await currentResponsesJob(page);
    expect(repaired.repairRun).toMatchObject({state: 'succeeded', committedRounds: 1});
    expect(native.receipts.size).toBeGreaterThan(0);
    expect([...native.receipts.values()].every(receipt => receipt.backend === 'cpu' && receipt.gpuExecutionVerified === false)).toBe(true);
    const grades = repaired.reviewReport?.assessments;
    expect(grades).toHaveLength(repaired.segments.length);
    for (const cue of repaired.segments) expect(grades?.find(grade => grade.segmentId === cue.id)?.status).toBe('current');
    expect(repaired.reviewReport?.findings.some(finding => finding.id.startsWith('live-seed-'))).toBe(false);
    for (const old of previous) expect(records.find(record => record.id === old.id)).toEqual(old);
    const freshRecords = records.filter(record => !oldIds.has(record.id));
    expect(freshRecords.length).toBeGreaterThanOrEqual(6);
    expect(freshRecords.every(record => record.state === 'published')).toBe(true);
    expect(freshRecords.filter(record => record.operation === 'translate')).toHaveLength(2);
    for (const record of freshRecords) expect(await readdir(join(checkpoint.userData, 'ai-responses', record.id))).toEqual(['answer.complete.txt']);
    await page.reload();
    await expect(page.getByText('正在读取本地项目与引擎状态…')).not.toBeVisible();
    await expect(page.getByLabel(/^可疑度：[无低中高]$/)).toHaveCount(repaired.segments.length);
    await page.screenshot({path: join(evidenceDirectory, 'actual-repair-final.png')});
    await app.close(); app = undefined;
    const exportPath = info.outputPath('actual-repaired.srt');
    launched = await launchApp(checkpoint.userData, [], [exportPath]); app = launched.app; page = launched.page;
    const restored = await currentResponsesJob(page);
    expect(restored.reviewReport).toEqual(repaired.reviewReport); expect(restored.repairRun).toEqual(repaired.repairRun);
    expect(await page.getByLabel('待重新检查', {exact: true}).count()).toBe(0);
    expect(await page.getByLabel(/^可疑度：[无低中高]$/).count()).toBe(restored.segments.length);
    const exported = await page.evaluate(jobId => window.api.jobs.export({jobId, format: 'srt'}), restored.id);
    expect(exported.success).toBe(true);
    const subtitles = await readFile(exportPath, 'utf8'); expect(subtitles).toContain('-->');
    expect(subtitles).toContain(restored.segments[0]?.translatedText ?? 'MISSING_TRANSLATION');
    proxy.finish(await responsesDiagnostics(page));
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as {limit: number; calls: {activeAtStart?: number}[]};
    expect(Math.max(...ledger.calls.map(call => call.activeAtStart ?? 0))).toBe(2);
    await writeFile(join(evidenceDirectory, 'actual-repair-result.json'), JSON.stringify({model: checkpoint.model, priorFailedAttemptPreserved: true, priorSeedCaveat: 'Manual medium test grades guarantee repair execution; original native single cue manually divided into two. Neither is a claim of model detection or native word alignment.', maxOutputTokenOverride: null, repair: repaired.repairRun, wallTimeMs: Date.now() - startedAt, grades: grades?.map(grade => ({status: grade.status, riskLevel: grade.riskLevel})), freshNativeReceipts: [...native.receipts.values()], requests: freshRecords.map(record => ({operation: record.operation, chapterId: record.chapterId, state: record.state, model: record.model, targetCount: record.targetCount})), cumulativeCalls: ledger.calls.length, cumulativeLimit: ledger.limit, observedConcurrentUpstreamRequests: 2, restartCurrentGradeCount: grades?.length, srtExportBytes: Buffer.byteLength(subtitles)}, null, 2));
  } finally {
    try {if (app) {proxy.finish(await responsesDiagnostics(await app.firstWindow())); await app.close();}}
    finally {await proxy.close(); await info.attach('sanitized-cumulative-ledger', {body: await readFile(ledgerPath), contentType: 'application/json'});}
  }
});
