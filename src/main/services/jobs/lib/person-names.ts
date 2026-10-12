import { createHash, randomUUID } from 'node:crypto';
import type { Job, Segment, SubtitleStyle } from '../../../../shared/contracts';
import { nameBatchSchema, proposedNamesSchema, type NameBatch, type NameCandidate, type NameField, type NameMapping, type NameReport, type NameTextPatch, type NameEmphasisPatch } from '../../../../shared/person-name-contracts';
import { primarySubtitleText } from '../../../../shared/subtitle-content';
import { AppError } from '../../../lib/errors';

type Span = { start: number; end: number };
const continuation = /[\p{L}\p{N}\p{M}_]/u;
const boundedEdge = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{N}\p{M}_]/u;
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
function previousPoint(text: string, at: number): string | undefined {
  if (at === 0) return undefined;
  const last = text.charCodeAt(at - 1);
  return text.slice(last >= 0xDC00 && last <= 0xDFFF && at >= 2 ? at - 2 : at - 1, at);
}
export function literalNameSpans(text: string, alias: string): Span[] {
  const result: Span[] = [];
  const points = Array.from(alias);
  const first = points[0]; const last = points.at(-1);
  if (!first || !last) return result;
  for (let at = text.indexOf(alias); at !== -1; at = text.indexOf(alias, at + 1)) {
    const end = at + alias.length;
    const before = previousPoint(text, at); const code = text.codePointAt(end); const after = code === undefined ? undefined : String.fromCodePoint(code);
    // UTF-16 positions must also be complete code-point boundaries.
    if (at > 0 && /[\uDC00-\uDFFF]/u.test(text[at] ?? '')) continue;
    if (end < text.length && /[\uDC00-\uDFFF]/u.test(text[end] ?? '')) continue;
    if ((boundedEdge.test(first) && before && continuation.test(before)) || (boundedEdge.test(last) && after && continuation.test(after))) continue;
    if ((before && /\p{M}/u.test(first)) || (after && /\p{M}/u.test(after))) continue;
    result.push({ start: at, end });
  }
  return result;
}
function longestSpans(spans: Span[]): Span[] {
  const chosen: Span[] = [];
  // Names are bounded to 120 UTF-16 units. Mark occupied units instead of
  // rescanning every previously accepted hit in a densely repeated cue.
  const occupied = new Uint8Array(spans.reduce((end, span) => Math.max(end, span.end), 0));
  for (const span of spans.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)) {
    let overlaps = false;
    for (let at = span.start; at < span.end; at++) {
      if (occupied[at]) { overlaps = true; break; }
    }
    if (!overlaps) { occupied.fill(1, span.start, span.end); chosen.push(span); }
  }
  return chosen.sort((a, b) => a.start - b.start);
}
export function nameTimelineFingerprint(job: Pick<Job, 'segments' | 'options'>): string {
  return createHash('sha256').update(JSON.stringify([job.options.translationEnabled, job.segments.map((cue) => [cue.id, cue.startMs, cue.endMs, cue.sourceText, job.options.translationEnabled ? cue.translatedText : ''])])).digest('hex');
}
export function refreshNameReport(job: Job & { nameReport?: NameReport }): void {
  const report = job.nameReport;
  if (report && (report.timelineFingerprint !== nameTimelineFingerprint(job) || report.translationEnabled !== job.options.translationEnabled || report.profileId !== job.options.reviewProfileId)) report.state = 'stale';
}
export function groundNames(job: Job, raw: unknown): NameCandidate[] {
  const parsed = proposedNamesSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('NAMES_INVALID', '人名结果格式不正确，请重新分析');
  const claims = new Map<string, number>();
  return parsed.data.candidates.map((candidate, index) => {
    if (!candidate.sourceAliases.length && !candidate.translatedAliases.length) throw new AppError('NAMES_EVIDENCE', '人名缺少字幕中的实际别名');
    if (candidate.translatedAliases.length && !candidate.translatedName) throw new AppError('NAMES_INVALID', '人名结果缺少推荐译名');
    if (!job.options.translationEnabled && (candidate.translatedAliases.length || candidate.translatedName)) throw new AppError('NAMES_INVALID', '原语言项目不接受译名结果');
    const fields: NameField[] = job.options.translationEnabled ? ['sourceText', 'translatedText'] : ['sourceText'];
    const occurrences: NameCandidate['occurrences'] = [];
    for (const field of fields) {
      const names = field === 'sourceText' ? candidate.sourceAliases : candidate.translatedAliases;
      if (new Set(names).size !== names.length) throw new AppError('NAMES_INVALID', '人名别名重复');
      for (const alias of names) {
        if (Array.from(alias).length === 1 && cjk.test(alias)) throw new AppError('NAMES_INVALID', '不接受单字中日韩人名别名，请使用完整姓名');
        const key = `${field}:${alias}`;
        if (claims.has(key) && claims.get(key) !== index) throw new AppError('NAMES_CONFLICT', '不同人名使用了相同别名');
        claims.set(key, index);
        if (!job.segments.some((cue) => literalNameSpans(cue[field], alias).length)) throw new AppError('NAMES_EVIDENCE', '推荐的人名别名没有字幕证据');
      }
      for (const cue of job.segments) for (const span of longestSpans(names.flatMap((alias) => literalNameSpans(cue[field], alias)))) occurrences.push({ segmentId: cue.id, field, ...span });
    }
    const cueCount = new Set(occurrences.map((o) => o.segmentId)).size;
    if (cueCount < 2) throw new AppError('NAMES_EVIDENCE', '关键人名须在至少两条字幕中出现');
    if (occurrences.length > 100000) throw new AppError('TEXT_LIMIT', '人名出现次数超出容量，请缩小字幕内容');
    return { ...candidate, id: randomUUID(), occurrences, cueCount, sourceCount: occurrences.filter((o) => o.field === 'sourceText').length, translatedCount: occurrences.filter((o) => o.field === 'translatedText').length };
  });
}
type Draft = { segments: Segment[]; style: SubtitleStyle; batch: NameBatch; changed: boolean };
export function draftNameApply(job: Job, report: NameReport, mappings: NameMapping[]): Draft {
  if (new Set(mappings.map((m) => m.candidateId)).size !== mappings.length) throw new AppError('NAMES_CONFLICT', '重复的人名映射');
  const replacements = new Map<string, { span: Span; target: string; candidateId: string }[]>();
  for (const mapping of mappings) {
    const candidate = report.candidates.find((c) => c.id === mapping.candidateId);
    if (!candidate) throw new AppError('NOT_FOUND', '所选人名不存在，请重新分析');
    if (!mapping.enabled) continue;
    // Recompute trusted occurrence spans: persisted coordinates are not replacement authority.
    const verified = groundNames(job, { candidates: [{ sourceAliases: candidate.sourceAliases, translatedAliases: candidate.translatedAliases, sourceName: candidate.sourceName, ...(candidate.translatedName ? { translatedName: candidate.translatedName } : {}), reason: candidate.reason }] })[0];
    if (!verified || JSON.stringify(verified.occurrences) !== JSON.stringify(candidate.occurrences) || verified.cueCount !== candidate.cueCount || verified.sourceCount !== candidate.sourceCount || verified.translatedCount !== candidate.translatedCount) throw new AppError('NAMES_EVIDENCE', '人名出现位置或计数已失效，请重新分析');
    if (!job.options.translationEnabled && mapping.translatedName) throw new AppError('TRANSLATION_DISABLED', '原语言项目不能修改译名');
    for (const occurrence of candidate.occurrences) {
      if (!job.options.translationEnabled && occurrence.field === 'translatedText') continue;
      const target = occurrence.field === 'sourceText' ? mapping.sourceName : mapping.translatedName;
      if (!target) throw new AppError('NAMES_INVALID', '请输入所选人名的译名');
      const key = `${occurrence.segmentId}:${occurrence.field}`;
      const items = replacements.get(key) ?? [];
      items.push({ span: occurrence, target, candidateId: candidate.id }); replacements.set(key, items);
    }
  }
  const patches: NameTextPatch[] = [];
  const segments = job.segments.map((cue) => {
    const result = { ...cue };
    for (const field of ['sourceText', 'translatedText'] as const) {
      const items = replacements.get(`${cue.id}:${field}`)?.sort((a, b) => a.span.start - b.span.start);
      if (!items?.length) continue;
      let after = ''; let at = 0;
      for (const item of items) {
        if (item.span.start < at) throw new AppError('NAMES_CONFLICT', '所选人名的替换位置重叠，请取消其中一项');
        after += cue[field].slice(at, item.span.start) + item.target; at = item.span.end;
      }
      after += cue[field].slice(at);
      if (after.length > 20000) throw new AppError('TEXT_LIMIT', '替换后的字幕过长，未保存任何修改');
      if (after !== cue[field]) { patches.push({ segmentId: cue.id, field, before: cue[field], after }); result[field] = after; }
    }
    if (result.sourceText !== cue.sourceText) result.translationStale = true;
    return result;
  });
  const emphasisPatches: NameEmphasisPatch[] = [];
  const emphasisBySegment = job.style.emphasisBySegment.flatMap((entry) => {
    const cue = segments.find((s) => s.id === entry.segmentId);
    if (!cue || !patches.some((p) => p.segmentId === cue.id)) return [entry];
    const valid = entry.keywords.filter((word) => primarySubtitleText(cue, job.options.translationEnabled).includes(word));
    if (valid.length === entry.keywords.length) return [entry];
    emphasisPatches.push({ segmentId: entry.segmentId, before: entry.keywords, after: valid.length ? valid : null });
    return valid.length ? [{ ...entry, keywords: valid }] : [];
  });
  const batchInput = { version: 1, id: randomUUID(), appliedAt: Date.now(), appliedRevision: job.revision + 1, state: 'available', patches, emphasisPatches, changedCueCount: new Set(patches.map((p) => p.segmentId)).size };
  const parsed = nameBatchSchema.safeParse(batchInput);
  if (!parsed.success) throw new AppError('TEXT_LIMIT', '人名批量修改超过撤销容量，未保存任何修改');
  return { segments, style: { ...job.style, emphasisBySegment }, batch: parsed.data, changed: patches.length > 0 || emphasisPatches.length > 0 };
}
export function draftNameUndo(job: Job, batch: NameBatch): Draft {
  if (batch.state !== 'available') throw new AppError('NAMES_UNDO_USED', '这次人名修改已撤销，无法重复撤销');
  const segments = job.segments.map((cue) => ({ ...cue }));
  const undo: NonNullable<NameBatch['undo']> = { restoredFields: 0, restoredEmphasis: 0, skippedFields: 0, conflicts: [] };
  for (const patch of batch.patches) {
    const cue = segments.find((s) => s.id === patch.segmentId);
    if (!cue || cue[patch.field] !== patch.after) { undo.skippedFields++; undo.conflicts.push({ segmentId: patch.segmentId, field: patch.field, reason: cue ? 'changed' : 'missing' }); continue; }
    cue[patch.field] = patch.before; if (patch.field === 'sourceText') cue.translationStale = true; undo.restoredFields++;
  }
  let emphasisBySegment = job.style.emphasisBySegment.map((e) => ({ ...e, keywords: [...e.keywords] }));
  for (const patch of batch.emphasisPatches) {
    const entry = emphasisBySegment.find((e) => e.segmentId === patch.segmentId);
    const cue = segments.find((s) => s.id === patch.segmentId);
    const same = JSON.stringify(entry?.keywords ?? null) === JSON.stringify(patch.after);
    const valid = !!cue && (patch.before ?? []).every((word) => primarySubtitleText(cue, job.options.translationEnabled).includes(word));
    if (!same || !valid) { undo.conflicts.push({ segmentId: patch.segmentId, field: 'emphasis', reason: !cue ? 'missing' : !same ? 'changed' : 'keyword_invalid' }); continue; }
    emphasisBySegment = emphasisBySegment.filter((e) => e.segmentId !== patch.segmentId);
    if (patch.before) emphasisBySegment.push({ segmentId: patch.segmentId, keywords: [...patch.before] });
    undo.restoredEmphasis++;
  }
  return { segments, style: { ...job.style, emphasisBySegment }, batch: { ...batch, state: 'consumed', undo }, changed: undo.restoredFields > 0 || undo.restoredEmphasis > 0 };
}
