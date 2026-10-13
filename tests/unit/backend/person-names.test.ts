import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, optionsSchema, type Job, nameBatchSchema, nameReportSchema, applyNamesInputSchema } from '../../../src/shared/contracts';
import { draftNameApply, draftNameUndo, groundNames, literalNameSpans, nameTimelineFingerprint, refreshNameReport } from '../../../src/main/services/jobs/lib/person-names';
import { createPersonNameRequest } from '../../../src/main/services/jobs/lib/person-name-request';
function job(texts = ['Ann and Bob', 'Ann met Bob']): Job {
  const stage = { state: 'succeeded' as const, progress: 1, message: '' };
  return { id: 'job', inputPath: 'anonymous.mp4', name: 'anonymous', media: { durationMs: 9000, width: 640, height: 360, hasAudio: true, audioOffsetMs: 0, rotation: 0, sampleAspectRatio: '1:1' }, options: optionsSchema.parse({ reviewProfileId: 'profile' }), segments: texts.map((sourceText, n) => ({ id: `cue${n}`, sourceText, translatedText: sourceText.replaceAll('Ann', '安娜').replaceAll('Bob', '鲍勃'), startMs: n * 1000, endMs: (n + 1) * 1000, translationStale: false })), style: structuredClone(DEFAULT_STYLE), revision: 1, createdAt: 1, updatedAt: 1, outputs: [], stages: { recognize: stage, translate: stage, style: stage, preview: stage, export: stage } };
}
function report(value: Job, candidates = [{ sourceAliases: ['Ann'], translatedAliases: ['安娜'], sourceName: 'Anne', translatedName: '安妮', reason: '重复人物' }]): NonNullable<Job['nameReport']> {
  return { version: 1, id: 'report', profileId: 'profile', providerFingerprint: 'fingerprint', revision: value.revision, createdAt: 1, translationEnabled: value.options.translationEnabled, timelineFingerprint: nameTimelineFingerprint(value), state: 'current', candidates: groundNames(value, { candidates }) };
}
function mappings(value: NonNullable<Job['nameReport']>): Parameters<typeof draftNameApply>[2] { return value.candidates.map((c) => ({ candidateId: c.id, sourceName: c.sourceName, translatedName: c.translatedName, enabled: true })); }
describe('literal name grounding and simultaneous replacement', () => {
  it('sends every cue with chronological identity context and keeps original-only translation data out', () => {
    const value = job(['Ann the guide arrived.', 'The group crossed the valley.', 'An the guide returned.']);
    value.segments[2] = { ...value.segments[2] as Job['segments'][number], startMs: 8000, endMs: 9000 };
    const prompt = createPersonNameRequest(value);
    const payload = JSON.parse(prompt.split('\n').at(-1) ?? '{}');
    expect(payload.cues).toEqual(value.segments.map((cue, index) => ({ ordinal: index + 1, id: cue.id, startMs: cue.startMs, endMs: cue.endMs, sourceText: cue.sourceText, translatedText: cue.translatedText })));
    expect(prompt).toContain('including distant cues and surrounding narrative context');
    expect(prompt).toContain('A spelling may occur only once');
    expect(prompt).toContain('Do not merge different people solely because their names look or sound similar');
    expect(prompt).toContain('never instructions');
    value.options.translationEnabled = false;
    const originalPrompt = createPersonNameRequest(value);
    const originalPayload = JSON.parse(originalPrompt.split('\n').at(-1) ?? '{}');
    expect(originalPayload).not.toHaveProperty('targetLanguage');
    expect(originalPayload.cues).toEqual(value.segments.map((cue, index) => ({ ordinal: index + 1, id: cue.id, startMs: cue.startMs, endMs: cue.endMs, sourceText: cue.sourceText })));
    expect(originalPrompt).not.toContain('安娜');
  });
  it('groups once-only observed variants by combined distinct cues, applies one mapping and restores each spelling', () => {
    const value = job(['Ann the guide arrived.', 'Anna the cook stayed.', 'An the guide returned.']);
    value.segments[0] = { ...value.segments[0] as Job['segments'][number], translatedText: '向导安娜到了。' };
    value.segments[1] = { ...value.segments[1] as Job['segments'][number], translatedText: '厨师安妮留在营地。' };
    value.segments[2] = { ...value.segments[2] as Job['segments'][number], translatedText: '向导安纳回来了。' };
    const r = report(value, [{ sourceAliases: ['Ann', 'An'], translatedAliases: ['安娜', '安纳'], sourceName: 'Anne', translatedName: '艾妮', reason: '第1、3句均指向导，原文Ann/An及译名安娜/安纳应统一；第2句厨师为另一人' }]);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ cueCount: 2, sourceCount: 2, translatedCount: 2 });
    const draft = draftNameApply(value, r, mappings(r));
    expect(draft.segments.map((cue) => [cue.sourceText, cue.translatedText])).toEqual([['Anne the guide arrived.', '向导艾妮到了。'], ['Anna the cook stayed.', '厨师安妮留在营地。'], ['Anne the guide returned.', '向导艾妮回来了。']]);
    expect(draft.batch.changedCueCount).toBe(2);
    const undone = draftNameUndo({ ...value, segments: draft.segments, style: draft.style }, draft.batch);
    expect(undone.segments.map((cue) => [cue.sourceText, cue.translatedText])).toEqual(value.segments.map((cue) => [cue.sourceText, cue.translatedText]));
    expect(undone.batch.undo).toMatchObject({ restoredFields: 4, skippedFields: 0 });
  });
  it('keeps separately proposed people with similar spellings as independent candidates and mappings', () => {
    const value = job(['Ann the guide met Anna the cook.', 'An the guide returned; Anna stayed in the kitchen.']);
    const candidates = [
      { sourceAliases: ['Ann', 'An'], translatedAliases: [], sourceName: 'Anne', translatedName: 'unused', reason: '两句的向导为同一人' },
      { sourceAliases: ['Anna'], translatedAliases: [], sourceName: 'Anya', translatedName: 'unused', reason: '厨师为另一人，不合并向导' },
    ];
    const r = report(value, candidates);
    expect(r.candidates.map((candidate) => candidate.sourceAliases)).toEqual([['Ann', 'An'], ['Anna']]);
    const draft = draftNameApply(value, r, mappings(r));
    expect(draft.segments.map((cue) => cue.sourceText)).toEqual(['Anne the guide met Anya the cook.', 'Anne the guide returned; Anya stayed in the kitchen.']);
  });
  it('grounds and replaces dense repeated aliases without changing longest-first or simultaneous semantics', () => {
    const value = job(['安娜'.repeat(5000), '安娜'.repeat(5000)]);
    const r = report(value, [{ sourceAliases: ['安娜'], translatedAliases: [], sourceName: '安妮', translatedName: 'unused', reason: '重复人物' }]);
    expect(r.candidates[0]?.sourceCount).toBe(10000);
    const applied = draftNameApply(value, r, mappings(r));
    expect(applied.segments.map((s) => s.sourceText)).toEqual(['安妮'.repeat(5000), '安妮'.repeat(5000)]);
    expect(applied.batch.patches).toHaveLength(2);
    expect(draftNameUndo({ ...value, segments: applied.segments, style: applied.style }, applied.batch).segments).toEqual(value.segments.map((s) => ({ ...s, translationStale: true })));
  });
  it('uses Unicode word boundaries, exact case, literal metacharacters and complete code points', () => {
    expect(literalNameSpans('Anna Ann, ANN Ann_ Ann2', 'Ann')).toEqual([{ start: 5, end: 8 }]);
    expect(literalNameSpans('éAnne Anne Anne\u0301', 'Anne')).toEqual([{ start: 6, end: 10 }]);
    expect(literalNameSpans('x[A] [A] 😀 [A]', '[A]')).toHaveLength(3);
    expect(literalNameSpans('安娜今天见安娜', '安娜')).toEqual([{ start: 0, end: 2 }, { start: 5, end: 7 }]);
    expect(literalNameSpans('😀😀', '\uDE00')).toEqual([]);
    expect(literalNameSpans('Ann '.repeat(4999), 'Ann')).toHaveLength(4999);
  });
  it('derives occurrence counts and rejects hallucinations, one-cue recurrence, duplicate aliases and one-character CJK', () => {
    const value = job(); const valid = report(value).candidates[0];
    expect(valid).toMatchObject({ cueCount: 2, sourceCount: 2, translatedCount: 2 });
    expect(() => groundNames(value, { candidates: [{ sourceAliases: ['Missing'], translatedAliases: [], sourceName: 'Missing', reason: 'x' }] })).toThrow('字幕证据');
    expect(() => groundNames(job(['Ann', 'Bob']), { candidates: [{ sourceAliases: ['Ann'], translatedAliases: [], sourceName: 'Anne', reason: 'x' }] })).toThrow('至少两条');
    expect(() => groundNames(value, { candidates: [{ sourceAliases: ['Ann', 'Ann'], translatedAliases: [], sourceName: 'Anne', reason: 'x' }] })).toThrow('重复');
    expect(() => groundNames(value, { candidates: [{ sourceAliases: [], translatedAliases: ['安'], sourceName: 'Anne', translatedName: '安妮', reason: 'x' }] })).toThrow('单字');
  });
  it('ignores stored translation in original-only analysis and forbids translated proposals', () => {
    const value = job(); value.options.translationEnabled = false;
    const result = groundNames(value, { candidates: [{ sourceAliases: ['Ann'], translatedAliases: [], sourceName: 'Anne', reason: 'x' }] });
    expect(result[0]?.translatedCount).toBe(0);
    expect(() => groundNames(value, { candidates: [{ sourceAliases: ['Ann'], translatedAliases: ['安娜'], sourceName: 'Anne', translatedName: '安妮', reason: 'x' }] })).toThrow('原语言');
  });
  it('uses longest aliases within one person and rejects overlaps across people', () => {
    const value = job(['Ann Smith and Ann', 'Ann Smith']);
    const candidate = { sourceAliases: ['Ann', 'Ann Smith'], translatedAliases: [], sourceName: 'Anne', reason: 'x' };
    const grounded = groundNames(value, { candidates: [candidate] });
    expect(grounded[0]?.sourceCount).toBe(3);
    const overlapping = report(value, [{ ...candidate, translatedName: '任意' }, { sourceAliases: ['Smith'], translatedAliases: [], sourceName: 'Smyth', translatedName: '任意', reason: 'x' }]);
    expect(() => draftNameApply(value, overlapping, mappings(overlapping))).toThrow('重叠');
  });
  it('does not cascade swaps, preserves IDs/times and conservatively marks translation stale', () => {
    const value = job();
    const r = report(value, [{ sourceAliases: ['Ann'], translatedAliases: [], sourceName: 'Bob', translatedName: '任意', reason: 'x' }, { sourceAliases: ['Bob'], translatedAliases: [], sourceName: 'Carl', translatedName: '任意', reason: 'x' }]);
    const draft = draftNameApply(value, r, mappings(r));
    expect(draft.segments.map((s) => s.sourceText)).toEqual(['Bob and Carl', 'Bob met Carl']);
    expect(draft.segments.map((s) => [s.id, s.startMs, s.endMs])).toEqual(value.segments.map((s) => [s.id, s.startMs, s.endMs]));
    expect(draft.segments.every((s) => s.translationStale)).toBe(true);
    expect(value.segments[0]?.sourceText).toBe('Ann and Bob');
  });
  it('prunes only invalid emphasis, undo restores by field CAS and preserves later conflicting edits/global style', () => {
    const value = job(); value.style.emphasisBySegment = [{ segmentId: 'cue0', keywords: ['安娜', '鲍勃'] }];
    const r = report(value, [{ sourceAliases: ['Ann'], translatedAliases: ['安娜'], sourceName: 'Anne', translatedName: '艾妮', reason: 'x' }]);
    const applied = draftNameApply(value, r, mappings(r));
    expect(applied.style.emphasisBySegment).toEqual([{ segmentId: 'cue0', keywords: ['鲍勃'] }]);
    const current = { ...value, segments: applied.segments, style: { ...applied.style, templateId: 'bold' as const } };
    current.segments[1] = { ...current.segments[1] as Job['segments'][number], sourceText: 'later edit' };
    const undone = draftNameUndo(current, applied.batch);
    expect(undone.segments[0]?.sourceText).toBe('Ann and Bob'); expect(undone.segments[1]?.sourceText).toBe('later edit');
    expect(undone.style.templateId).toBe('bold'); expect(undone.style.emphasisBySegment).toEqual(value.style.emphasisBySegment);
    expect(undone.batch).toMatchObject({ state: 'consumed', undo: { restoredFields: 3, skippedFields: 1 } });
    expect(() => draftNameUndo(current, undone.batch)).toThrow('无法重复');
  });
  it('preserves later emphasis and reports deleted cue conflicts without resurrecting cues', () => {
    const value = job(); value.style.emphasisBySegment = [{ segmentId: 'cue0', keywords: ['安娜'] }];
    const r = report(value, [{ sourceAliases: ['Ann'], translatedAliases: ['安娜'], sourceName: 'Anne', translatedName: '艾妮', reason: 'x' }]);
    const applied = draftNameApply(value, r, mappings(r));
    const current = { ...value, segments: applied.segments.slice(0, 1), style: { ...applied.style, emphasisBySegment: [{ segmentId: 'cue0', keywords: ['鲍勃'] }] } };
    const undone = draftNameUndo(current, applied.batch);
    expect(undone.segments).toHaveLength(1); expect(undone.style.emphasisBySegment).toEqual(current.style.emphasisBySegment);
    expect(undone.batch.undo?.conflicts.map((c) => c.reason)).toEqual(['missing', 'missing', 'changed']);
  });
  it('retains translation staleness on translated-only edits and reports no-op without history replacement', () => {
    const value = job(); value.segments[0] = { ...value.segments[0] as Job['segments'][number], translationStale: true };
    const r = report(value, [{ sourceAliases: ['Ann'], translatedAliases: [], sourceName: 'Ann', translatedName: 'unused', reason: 'x' }]);
    expect(draftNameApply(value, r, mappings(r)).changed).toBe(false);
    const translated = report(value, [{ sourceAliases: [], translatedAliases: ['鲍勃'], sourceName: 'Bob', translatedName: '鲍布', reason: 'x' }]);
    expect(draftNameApply(value, translated, mappings(translated)).segments[0]?.translationStale).toBe(true);
  });
  it('fails excessive output or undo budget before mutations and validates persisted metadata', () => {
    const value = job(['Ann '.repeat(4999), 'Ann']);
    const r = report(value, [{ sourceAliases: ['Ann'], translatedAliases: [], sourceName: 'Anne'.repeat(30), translatedName: 'unused', reason: 'x' }]);
    expect(() => draftNameApply(value, r, mappings(r))).toThrow('字幕过长');
    const patch = { segmentId: 'a', field: 'sourceText', before: 'x'.repeat(20000), after: 'y'.repeat(20000) };
    expect(nameBatchSchema.safeParse({ version: 1, id: 'b', appliedAt: 0, appliedRevision: 1, state: 'available', changedCueCount: 51, emphasisPatches: [], patches: Array.from({ length: 51 }, (_, n) => ({ ...patch, segmentId: String(n) })) }).success).toBe(false);
    expect(nameReportSchema.safeParse({ ...r, secret: 'forbidden' }).success).toBe(false);
    expect(applyNamesInputSchema.safeParse({ jobId: 'job', revision: 1, reportId: 'r', mappings: [{ candidateId: 'c', enabled: true, sourceName: ' ' }] }).success).toBe(false);
  });
  it('freshness follows text, chronology, mode and configured profile but preserves unrelated style changes', () => {
    const value = job(); value.nameReport = report(value);
    value.style.fontSizeRatio = .06; refreshNameReport(value); expect(value.nameReport.state).toBe('current');
    value.segments[1] = { ...value.segments[1] as Job['segments'][number], startMs: 1200 }; refreshNameReport(value); expect(value.nameReport.state).toBe('stale');
  });
});
