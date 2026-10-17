import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../../../src/main/db/store';
import { JobService } from '../../../src/main/services/jobs/lib/job-service';
import type { MediaService } from '../../../src/main/services/media/lib/media-service';
import * as providers from '../../../src/main/services/providers/lib/text-provider';
import { AppError } from '../../../src/main/lib/errors';
import { draftNameApply, groundNames, nameTimelineFingerprint } from '../../../src/main/services/jobs/lib/person-names';
import type { Job, ApplyNamesInput } from '../../../src/shared/contracts';
import { newCoveragePlan } from '../../../src/main/services/jobs/lib/chapters';
import { createPersonNameRequest } from '../../../src/main/services/jobs/lib/person-name-request';

const fixtures: { root: string; store: Store }[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) { f.store.close(); await rm(f.root, { recursive: true, force: true }); } });
const proposed = { candidates: [{ sourceAliases: ['Ann'], translatedAliases: ['安娜'], sourceName: 'Anne', translatedName: '艾妮', reason: '两句中相同人物，建议统一' }] };
const secrets = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };
async function fixture(): Promise<{ root: string; store: Store; service: JobService; job: Job; generate: MockInstance<typeof providers.generateText>; transcribe: MockInstance<typeof providers.transcribe>; translate: MockInstance<typeof providers.translateBatch> }> {
  const root = await mkdtemp(join(tmpdir(), 'slice-names-')); const input = join(root, 'anonymous.mp4'); await writeFile(input, 'anonymous fixture');
  const store = new Store(join(root, 'isolated.db'), secrets); fixtures.push({ root, store });
  const profile = store.saveProfile({ name: 'names fixture', protocol: 'openai', baseUrl: 'http://fixture.invalid/v1', model: 'fixture', apiKey: 'anonymous-mock' });
  const media = { probe: vi.fn(async () => ({ durationMs: 5000, width: 640, height: 360, hasAudio: true, audioOffsetMs: 0, rotation: 0, sampleAspectRatio: '1:1' })) };
  const service = new JobService(store, media as unknown as MediaService, { modelPath: vi.fn(), executable: vi.fn() }, root, vi.fn(), (p) => p);
  const job = await service.importVideo(input); job.options.reviewProfileId = profile.id;
  job.segments = [{ id: 'a', startMs: 100, endMs: 1800, sourceText: 'Ann met Bob.', translatedText: '安娜遇见鲍勃。', translationStale: false }, { id: 'b', startMs: 2000, endMs: 3800, sourceText: 'Ann left.', translatedText: '安娜走了。', translationStale: true }];
  job.style.emphasisBySegment = [{ segmentId: 'a', keywords: ['安娜', '鲍勃'] }]; job.outputs = ['historical.srt']; store.saveJob(job);
  const generate = vi.spyOn(providers, 'generateText').mockResolvedValue(JSON.stringify(proposed));
  const transcribe = vi.spyOn(providers, 'transcribe'); const translate = vi.spyOn(providers, 'translateBatch');
  return { root, store, service, job, generate, transcribe, translate };
}
function applyInput(job: Job): ApplyNamesInput {
  const report = job.nameReport; if (!report) throw new Error('Fixture report missing');
  return { jobId: job.id, revision: job.revision, reportId: report.id, mappings: report.candidates.map((candidate) => ({ candidateId: candidate.id, sourceName: candidate.sourceName, translatedName: candidate.translatedName, enabled: true })) };
}
async function analyzed(f: Awaited<ReturnType<typeof fixture>>): Promise<Job> { return f.service.analyzeNames({ jobId: f.job.id, revision: f.store.getJob(f.job.id).revision }); }
describe('grounded names service and persistent field undo', () => {
  it('publishes actual-shape ja-to-zh mixed-script aliases on the first response and safely applies and undoes them', async () => {
    const f = await fixture(); const value = f.store.getJob(f.job.id);
    value.options.sourceLanguage = 'ja'; value.options.targetLanguage = 'zh-CN';
    value.segments = [
      { id: 'a', startMs: 100, endMs: 1800, sourceText: 'とアンAは帰った。', translatedText: '和Ann见面。', translationStale: false },
      { id: 'b', startMs: 2000, endMs: 3800, sourceText: 'アンB君とアンAが来た。', translatedText: '看见Ann先生回来了。Anna是另一个人。', translationStale: false },
    ];
    f.store.saveJob(value);
    f.generate.mockResolvedValue(JSON.stringify({ candidates: [{ sourceAliases: ['アンA', 'アンB'], translatedAliases: ['Ann', 'Ann先生'], sourceName: 'アンC', translatedName: '安妮', reason: '两句的向导为同一人，另一人Anna不合并' }] }));
    const result = await analyzed(f);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(result.nameReport?.candidates[0]).toMatchObject({ cueCount: 2, sourceCount: 3, translatedCount: 2 });
    const applied = f.service.applyNames(applyInput(result));
    expect(applied.segments.map(cue => [cue.sourceText, cue.translatedText])).toEqual([
      ['とアンCは帰った。', '和安妮见面。'],
      ['アンC君とアンCが来た。', '看见安妮回来了。Anna是另一个人。'],
    ]);
    if (!applied.nameBatch) throw new Error('Missing mixed-script batch');
    const undone = f.service.undoNames({ jobId: applied.id, revision: applied.revision, batchId: applied.nameBatch.id });
    expect(undone.segments.map(cue => [cue.sourceText, cue.translatedText])).toEqual(value.segments.map(cue => [cue.sourceText, cue.translatedText]));
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.transcribe).not.toHaveBeenCalled(); expect(f.translate).not.toHaveBeenCalled();
  });
  it.each(['canonical', 'wrong-field', 'case', 'boundary', 'json', 'shape'] as const)('corrects %s once over the identical whole timeline', async (failure) => {
    const f = await fixture();
    const first = await analyzed(f);
    const invalid = failure === 'json' ? '{"candidates":' : failure === 'shape' ? '{"candidates":[{}]}' : JSON.stringify({ candidates: [{ ...proposed.candidates[0], sourceAliases: failure === 'canonical' ? ['Ann', 'Anne'] : failure === 'wrong-field' ? ['安娜'] : failure === 'case' ? ['ANN'] : ['An'] }] });
    f.generate.mockClear().mockResolvedValueOnce(invalid).mockResolvedValueOnce(JSON.stringify(proposed));
    const result = await analyzed(f);
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.generate.mock.calls[1]?.[2]).toContain('Correction 1/1');
    expect(f.generate.mock.calls[1]?.[2].split('\n').at(-1)).toBe(f.generate.mock.calls[0]?.[2].split('\n').at(-1));
    expect(result.nameReport?.id).not.toBe(first.nameReport?.id);
    expect(result.nameReport?.candidates[0]?.sourceCount).toBe(2);
    expect(result.segments).toEqual(first.segments);
    expect(result.revision).toBe(first.revision);
  });
  it.each(['AUTH_ERROR', 'RATE_LIMIT', 'NETWORK_ERROR', 'PROVIDER_TIMEOUT', 'STREAM_TRUNCATED', 'CANCELLED'])('retains prior report without content correction after %s', async (code) => {
    const f = await fixture(); const first = await analyzed(f);
    f.generate.mockClear().mockRejectedValue(new AppError(code, 'fixture failure'));
    await expect(analyzed(f)).rejects.toMatchObject({ code });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.store.getJob(first.id).nameReport).toEqual(first.nameReport);
  });
  it('retains the prior report on a second invalid response and cancels a held correction under the same lease', async () => {
    const f = await fixture(); const first = await analyzed(f);
    f.generate.mockClear().mockResolvedValue('{"candidates":[{}]}');
    await expect(analyzed(f)).rejects.toThrow('一次纠正仍未通过');
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect(f.store.getJob(first.id).nameReport).toEqual(first.nameReport);
    f.generate.mockClear().mockResolvedValueOnce('{"candidates":[{}]}').mockImplementationOnce(async (_p, _k, _t, signal) => new Promise<string>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new AppError('CANCELLED', 'fixture cancel')), { once: true })));
    const pending = analyzed(f);
    await vi.waitFor(() => expect(f.generate).toHaveBeenCalledTimes(2));
    expect(() => f.service.applyNames(applyInput(first))).toThrow('已有任务');
    f.service.cancel(first.id);
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(f.store.getJob(first.id).nameReport).toEqual(first.nameReport);
  });
  it.each(['absent', 'stale', 'custom', 'multiple'] as const)('ignores %s chapter plans, never plans or mutates chapters, and keeps chapter-only edits applicable', async (kind) => {
    const f = await fixture(); const current = f.store.getJob(f.job.id);
    const plan = newCoveragePlan(current);
    if (kind === 'stale') current.chapterPlan = { ...plan, state: 'stale', sourceFingerprint: 'old-source' };
    if (kind === 'custom') current.customChapterPlan = { ...plan, kind: 'custom', criterion: { id: 'fixture', revision: 1, name: 'fixture', instructions: 'fixture' } };
    if (kind === 'multiple') current.chapterPlan = { ...plan, chapters: [{ id: 'one', startMs: 0, endMs: 1900, title: 'one', summary: '' }, { id: 'two', startMs: 1900, endMs: 5000, title: 'two', summary: '' }] };
    f.store.saveJob(current);
    const before = f.store.getJob(current.id); const prompt = createPersonNameRequest(before);
    const result = await analyzed(f);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.generate.mock.calls[0]?.[2]).toBe(prompt);
    expect(result.chapterPlan).toEqual(before.chapterPlan);
    expect(result.customChapterPlan).toEqual(before.customChapterPlan);
    const changed = f.store.getJob(result.id);
    changed.chapterPlan = { ...plan, revision: 1, chapters: [{ id: 'changed', startMs: 0, endMs: 5000, title: 'changed boundaries', summary: '' }] };
    f.store.saveJob(changed);
    expect(createPersonNameRequest(f.store.getJob(result.id))).toBe(prompt);
    expect(f.store.getJob(result.id).nameReport?.state).toBe('current');
    expect(() => f.service.applyNames(applyInput(f.store.getJob(result.id)))).not.toThrow();
  });
  it('uses one complete global request for distant once-only variants and safely applies and undoes a combined identity', async () => {
    const f = await fixture();
    const value = f.store.getJob(f.job.id);
    value.media.durationMs = 180000;
    value.segments = [
      { id: 'intro', startMs: 100, endMs: 1800, sourceText: 'Ann the guide leads our group.', translatedText: '向导安娜带领我们。', translationStale: false },
      { id: 'other-person', startMs: 10000, endMs: 12000, sourceText: 'Anna the cook stays at the camp.', translatedText: '厨师安妮留在营地。', translationStale: false },
      { id: 'narrative', startMs: 60000, endMs: 62000, sourceText: 'We followed the guide through the valley.', translatedText: '我们跟着向导穿过山谷。', translationStale: false },
      { id: 'return', startMs: 160000, endMs: 162000, sourceText: 'An the guide returned with our group.', translatedText: '向导安纳带着我们回来了。', translationStale: false },
    ];
    f.store.saveJob(value);
    f.generate.mockResolvedValue(JSON.stringify({ candidates: [{ sourceAliases: ['Ann', 'An'], translatedAliases: ['安娜', '安纳'], sourceName: 'Anne', translatedName: '艾妮', reason: '第1、4句均指带领队伍的向导；第2句厨师Anna为另一人。统一向导的两种识别与译名写法。' }] }));
    const result = await analyzed(f);
    expect(f.generate).toHaveBeenCalledTimes(1);
    const prompt = f.generate.mock.calls[0]?.[2];
    if (!prompt) throw new Error('missing names prompt');
    const payload = JSON.parse(prompt.split('\n').at(-1) ?? '{}');
    expect(payload.cues).toEqual(value.segments.map((cue, index) => ({ ordinal: index + 1, id: cue.id, startMs: cue.startMs, endMs: cue.endMs, sourceText: cue.sourceText, translatedText: cue.translatedText })));
    expect(result.segments).toEqual(value.segments);
    expect(result.revision).toBe(value.revision);
    expect(result.nameReport?.candidates).toHaveLength(1);
    expect(result.nameReport?.candidates[0]).toMatchObject({ cueCount: 2, sourceCount: 2, translatedCount: 2, sourceAliases: ['Ann', 'An'], translatedAliases: ['安娜', '安纳'] });
    const applied = f.service.applyNames(applyInput(result));
    expect(applied.revision).toBe(result.revision + 1);
    expect(applied.segments.map((cue) => cue.sourceText)).toEqual(['Anne the guide leads our group.', 'Anna the cook stays at the camp.', 'We followed the guide through the valley.', 'Anne the guide returned with our group.']);
    expect(applied.segments[1]).toEqual(value.segments[1]);
    expect(applied.segments[2]).toEqual(value.segments[2]);
    if (!applied.nameBatch) throw new Error('missing names batch');
    const undone = f.service.undoNames({ jobId: applied.id, revision: applied.revision, batchId: applied.nameBatch.id });
    expect(undone.segments.map((cue) => [cue.id, cue.startMs, cue.endMs, cue.sourceText, cue.translatedText])).toEqual(value.segments.map((cue) => [cue.id, cue.startMs, cue.endMs, cue.sourceText, cue.translatedText]));
    expect(undone.nameBatch?.undo).toMatchObject({ restoredFields: 4, skippedFields: 0 });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.transcribe).not.toHaveBeenCalled();
    expect(f.translate).not.toHaveBeenCalled();
  });
  it('a new successful batch replaces undo while stale revisions cannot apply or consume it', async () => {
    const f = await fixture();
    const first = f.service.applyNames(applyInput(await analyzed(f)));
    const previousBatch = first.nameBatch;
    if (!previousBatch) throw new Error('missing first batch');
    f.generate.mockResolvedValue(JSON.stringify({ candidates: [{ sourceAliases: ['Anne'], translatedAliases: ['艾妮'], sourceName: 'Annie', translatedName: '安妮', reason: '下一次明确修改' }] }));
    const nextReport = await analyzed(f);
    expect(() => f.service.applyNames({ ...applyInput(nextReport), revision: nextReport.revision - 1 })).toThrow('字幕已更新');
    const next = f.service.applyNames(applyInput(nextReport));
    const batch = next.nameBatch;
    if (!batch) throw new Error('missing next batch');
    expect(batch.id).not.toBe(previousBatch.id);
    expect(() => f.service.undoNames({ jobId: next.id, revision: next.revision, batchId: previousBatch.id })).toThrow('替代');
    expect(() => f.service.undoNames({ jobId: next.id, revision: next.revision - 1, batchId: batch.id })).toThrow('字幕已更新');
    expect(f.store.getJob(next.id).nameBatch?.state).toBe('available');
    const undone = f.service.undoNames({ jobId: next.id, revision: next.revision, batchId: batch.id });
    expect(undone.segments.map((s) => [s.sourceText, s.translatedText])).toEqual(first.segments.map((s) => [s.sourceText, s.translatedText]));
  });
  it.each(['key', 'model', 'mode'] as const)('does not publish analysis when %s changes during generation', async (change) => {
    const f = await fixture();
    const previous = await analyzed(f);
    f.generate.mockClear().mockImplementationOnce(async () => {
      if (change === 'mode') {
        const current = f.store.getJob(f.job.id);
        current.options.translationEnabled = false;
        f.store.saveJob(current);
      } else {
        const profile = f.store.getProfile(previous.options.reviewProfileId ?? '');
        const { hasKey: _hasKey, ...input } = profile;
        f.store.saveProfile({ ...input, ...(change === 'key' ? { apiKey: 'changed-fixture-key' } : { model: 'changed-fixture-model' }) });
      }
      return JSON.stringify(proposed);
    });
    await expect(analyzed(f)).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.store.getJob(previous.id).nameReport?.id).toBe(previous.nameReport?.id);
  });
  it('rejects an over-budget complete batch before saving any field or replacing available undo', async () => {
    const f = await fixture();
    const first = f.service.applyNames(applyInput(await analyzed(f)));
    const current = f.store.getJob(first.id);
    current.options.translationEnabled = false;
    current.segments = Array.from({ length: 101 }, (_, n) => ({ id: `large-${n}`, startMs: n * 40, endMs: n * 40 + 35, sourceText: `Anne ${'x'.repeat(9900)}`, translatedText: '', translationStale: false }));
    const candidates = [{ sourceAliases: ['Anne'], translatedAliases: [], sourceName: 'Annie', reason: 'repeated fixture' }];
    current.nameReport = { version: 1, id: 'large-report', profileId: current.options.reviewProfileId ?? '', providerFingerprint: first.nameReport?.providerFingerprint ?? '', revision: current.revision, createdAt: Date.now(), translationEnabled: false, timelineFingerprint: nameTimelineFingerprint(current), state: 'current', candidates: groundNames(current, { candidates }) };
    f.store.saveJob(current);
    const before = f.store.getJob(current.id);
    expect(() => f.service.applyNames(applyInput(before))).toThrow('撤销容量');
    expect(f.store.getJob(current.id)).toEqual(before);
  });
  it('publishes one whole grounded analysis, applies one content revision, preserves exports and invalidates grades', async () => {
    const f = await fixture(); f.generate.mockResolvedValueOnce('{"a":[[0,[]],[1,[]]]}');
    await f.service.reviewSubtitles({ jobId: f.job.id, revision: f.job.revision });
    const report = await analyzed(f); expect(report.nameReport?.candidates[0]).toMatchObject({ sourceCount: 2, translatedCount: 2, cueCount: 2 });
    const applied = f.service.applyNames(applyInput(report));
    expect(applied.revision).toBe(report.revision + 1); expect(applied.outputs).toEqual(['historical.srt']);
    expect(applied.segments.map((s) => s.sourceText)).toEqual(['Anne met Bob.', 'Anne left.']);
    expect(applied.segments.every((s) => s.translationStale)).toBe(true); expect(applied.nameReport?.state).toBe('stale');
    expect(applied.reviewReport?.assessments?.every((a) => a.status === 'recheck')).toBe(true);
    expect(applied.style.emphasisBySegment).toEqual([{ segmentId: 'a', keywords: ['鲍勃'] }]);
    expect(f.transcribe).not.toHaveBeenCalled(); expect(f.translate).not.toHaveBeenCalled();
  });
  it('no-op, disabled and failed applies preserve the previous successful batch and revision', async () => {
    const f = await fixture(); const first = f.service.applyNames(applyInput(await analyzed(f))); const batchId = first.nameBatch?.id;
    f.generate.mockResolvedValue(JSON.stringify({ candidates: [{ sourceAliases: ['Anne'], translatedAliases: ['艾妮'], sourceName: 'Anne', translatedName: '艾妮', reason: 'same' }] }));
    const next = await analyzed(f); const noOp = f.service.applyNames(applyInput(next)); expect(noOp.revision).toBe(next.revision); expect(noOp.nameBatch?.id).toBe(batchId);
    const disabled = applyInput(next); disabled.mappings = disabled.mappings.map((m) => ({ ...m, enabled: false })); expect(f.service.applyNames(disabled).nameBatch?.id).toBe(batchId);
    const invalid = applyInput(next); invalid.mappings[0] = { ...invalid.mappings[0] as ApplyNamesInput['mappings'][number], sourceName: ' ' };
    expect(() => f.service.applyNames(invalid)).toThrow(); expect(f.store.getJob(f.job.id).nameBatch?.id).toBe(batchId);
  });
  it('undo preserves later edits to other fields/cues/style and skips same-field changes', async () => {
    const f = await fixture(); const applied = f.service.applyNames(applyInput(await analyzed(f))); const a = applied.segments[0]; if (!a || !applied.nameBatch) throw new Error('missing');
    const edited = f.service.editSegment(applied.id, { ...a, sourceText: 'later manual original' }, applied.revision);
    const styled = f.service.setStyle(edited.id, { ...edited.style, templateId: 'bold' });
    const undone = f.service.undoNames({ jobId: styled.id, revision: styled.revision, batchId: applied.nameBatch.id });
    expect(undone.segments[0]?.sourceText).toBe('later manual original'); expect(undone.segments[0]?.translatedText).toBe('安娜遇见鲍勃。'); expect(undone.segments[1]?.sourceText).toBe('Ann left.');
    expect(undone.style.templateId).toBe('bold'); expect(undone.nameBatch?.undo).toMatchObject({ restoredFields: 3, skippedFields: 1 }); expect(undone.revision).toBe(styled.revision + 1);
    expect(() => f.service.undoNames({ jobId: undone.id, revision: undone.revision, batchId: applied.nameBatch?.id ?? '' })).toThrow('无法重复');
  });
  it('persists latest-batch undo across restart without provider credentials and never resurrects removed cues', async () => {
    const f = await fixture(); const applied = f.service.applyNames(applyInput(await analyzed(f))); const batch = applied.nameBatch; if (!batch) throw new Error('missing');
    f.service.removeSegment(applied.id, 'b', applied.revision); f.store.close();
    const reopened = new Store(join(f.root, 'isolated.db'), secrets); const saved = fixtures.find((item) => item.root === f.root); if (!saved) throw new Error('fixture missing'); saved.store = reopened;
    reopened.removeProfile(applied.options.reviewProfileId ?? '');
    const service = new JobService(reopened, {} as MediaService, { modelPath: vi.fn(), executable: vi.fn() }, f.root, vi.fn(), (p) => p);
    const current = reopened.getJob(applied.id); const undone = service.undoNames({ jobId: current.id, revision: current.revision, batchId: batch.id });
    expect(undone.segments).toHaveLength(1); expect(undone.segments[0]?.sourceText).toBe('Ann met Bob.'); expect(undone.nameBatch?.undo?.skippedFields).toBe(2);
    expect(reopened.getJob(undone.id).nameBatch?.state).toBe('consumed');
  });
  it('conflict-only undo consumes once without a content revision increment', async () => {
    const f = await fixture(); const applied = f.service.applyNames(applyInput(await analyzed(f))); if (!applied.nameBatch) throw new Error('missing');
    let current = applied; for (const s of current.segments) current = f.service.editSegment(current.id, { ...s, sourceText: 'later', translatedText: '之后编辑' }, current.revision);
    const undone = f.service.undoNames({ jobId: current.id, revision: current.revision, batchId: applied.nameBatch.id }); expect(undone.revision).toBe(current.revision); expect(undone.nameBatch?.undo).toMatchObject({ restoredFields: 0, skippedFields: 4 });
  });
  it('marks analysis stale after timeline/mode/material profile changes, preserves history and rejects stale apply', async () => {
    const f = await fixture(); const result = await analyzed(f); const a = result.segments[0]; if (!a) throw new Error('missing');
    const edited = f.service.editSegment(result.id, { ...a, endMs: 1700 }, result.revision); expect(edited.nameReport?.state).toBe('stale'); expect(() => f.service.applyNames({ ...applyInput(result), revision: edited.revision })).toThrow('过期');
    await analyzed(f); const fresh = f.store.getJob(result.id); f.store.saveProfile({ id: fresh.options.reviewProfileId, name: 'changed', protocol: 'openai', baseUrl: 'http://fixture.invalid/v1', model: 'changed' });
    expect(f.store.getJob(result.id).nameReport?.state).toBe('stale');
  });
  it('retains prior report on invalid/hallucinated results and capacity errors without silent batches', async () => {
    const f = await fixture(); const first = await analyzed(f); f.generate.mockResolvedValue('{"candidates":[{"sourceAliases":["Ghost"],"translatedAliases":[],"sourceName":"Ghost","reason":"x"}]}');
    await expect(analyzed(f)).rejects.toMatchObject({ code: 'NAMES_EVIDENCE' }); expect(f.store.getJob(first.id).nameReport?.id).toBe(first.nameReport?.id);
    f.generate.mockClear(); const many = f.store.getJob(first.id); many.segments = Array.from({ length: 2001 }, (_, n) => ({ ...many.segments[0] as Job['segments'][number], id: `n${n}` })); f.store.saveJob(many);
    await expect(analyzed(f)).rejects.toMatchObject({ code: 'TEXT_LIMIT' }); expect(f.generate).not.toHaveBeenCalled();
  });
  it('rejects an oversized UTF-8 global name request before generation and preserves the prior report', async () => {
    const f = await fixture();
    const previous = await analyzed(f);
    const value = f.store.getJob(previous.id);
    value.segments = Array.from({ length: 10 }, (_, index) => ({ id: `large-${index}`, startMs: index * 400, endMs: index * 400 + 350, sourceText: `Ann ${'山'.repeat(18000)}`, translatedText: '', translationStale: false }));
    f.store.saveJob(value);
    f.generate.mockClear();
    await expect(analyzed(f)).rejects.toMatchObject({ code: 'TEXT_LIMIT' });
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.store.getJob(previous.id).nameReport?.id).toBe(previous.nameReport?.id);
    expect(f.store.getJob(previous.id).segments).toEqual(value.segments);
  });
  it('holds busy lock throughout cancellable analysis and retains previous report on cancel', async () => {
    const f = await fixture(); const first = await analyzed(f);
    f.generate.mockImplementation(async (_profile, _key, _prompt, signal) => new Promise<string>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new AppError('CANCELLED', 'cancelled')), { once: true })));
    const pending = analyzed(f); expect(() => f.service.applyNames(applyInput(first))).toThrow('已有任务'); expect(() => f.service.updateOptions(first.id, first.options)).toThrow('已有任务');
    f.service.cancel(first.id); await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' }); expect(f.store.getJob(first.id).nameReport?.id).toBe(first.nameReport?.id);
    f.generate.mockResolvedValue(JSON.stringify(proposed)); await expect(analyzed(f)).resolves.toMatchObject({ id: first.id });
  });
  it('rejects changed snapshot before publication and permits original-only names without stored translations', async () => {
    const f = await fixture(); f.generate.mockImplementationOnce(async () => { const mutated = f.store.getJob(f.job.id); mutated.revision++; mutated.segments[0] = { ...mutated.segments[0] as Job['segments'][number], sourceText: 'new content' }; f.store.saveJob(mutated); return JSON.stringify(proposed); });
    await expect(analyzed(f)).rejects.toMatchObject({ code: 'STALE_REVISION' }); expect(f.store.getJob(f.job.id).nameReport).toBeUndefined();
    const original = f.store.getJob(f.job.id); original.segments[0] = { ...original.segments[0] as Job['segments'][number], sourceText: 'Ann met Bob.' }; original.options.translationEnabled = false; f.store.saveJob(original);
    f.generate.mockResolvedValue(JSON.stringify({ candidates: [{ sourceAliases: ['Ann'], translatedAliases: [], sourceName: 'Anne', reason: 'x' }] }));
    const analyzedOriginal = await analyzed(f); const input = applyInput(analyzedOriginal); const before = analyzedOriginal.segments.map((s) => s.translatedText); const applied = f.service.applyNames(input);
    expect(applied.segments.map((s) => s.translatedText)).toEqual(before); expect(f.generate.mock.calls.at(-1)?.[2]).not.toContain('安娜'); expect(f.transcribe).not.toHaveBeenCalled(); expect(f.translate).not.toHaveBeenCalled();
    const originalPrompt = f.generate.mock.calls.at(-1)?.[2];
    const payload = JSON.parse(originalPrompt?.split('\n').at(-1) ?? '{}');
    expect(payload).not.toHaveProperty('targetLanguage');
    expect(payload.cues).toEqual(original.segments.map((cue, index) => ({ ordinal: index + 1, id: cue.id, startMs: cue.startMs, endMs: cue.endMs, sourceText: cue.sourceText })));
  });
  it('rejects corrupted persisted spans before any write and preflights undo budget', async () => {
    const f = await fixture(); const first = await analyzed(f); const corrupt = f.store.getJob(first.id); const occurrence = corrupt.nameReport?.candidates[0]?.occurrences[0]; if (!occurrence) throw new Error('missing'); occurrence.end += 1; f.store.saveJob(corrupt);
    expect(() => f.service.applyNames(applyInput(corrupt))).toThrow('出现位置'); expect(f.store.getJob(first.id).segments).toEqual(first.segments);
    const valid = await analyzed(f); const report = valid.nameReport; if (!report) throw new Error('missing');
    expect(() => draftNameApply(valid, report, [{ candidateId: report.candidates[0]?.id ?? '', sourceName: 'Anne', translatedName: '艾妮', enabled: true }])).not.toThrow();
  });
});
