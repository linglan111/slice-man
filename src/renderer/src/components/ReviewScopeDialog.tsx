import { useState, type ReactNode } from 'react';
import type { Job } from '../../../shared/contracts';
import { validateCueTimes } from '../lib/presentation';
import { Modal } from './Modal';

export type ReviewScope = { segmentIds?: string[]; range?: { startMs: number; endMs: number } };
export function ReviewScopeDialog({ job, selectedIds, isBusy, onClose, onReview }: { job: Job; selectedIds: string[]; isBusy: boolean; onClose: () => void; onReview: (scope: ReviewScope) => void }): ReactNode {
  const [scope, setScope] = useState<'all' | 'selected' | 'range'>(selectedIds.length ? 'selected' : 'all');
  const [draft, setDraft] = useState({ start: '0', end: String(job.media.durationMs / 1000) });
  const selected = job.segments.filter((segment) => selectedIds.includes(segment.id));
  const range = validateCueTimes(draft.start, draft.end, job.media.durationMs);
  const count = scope === 'all' ? job.segments.length : scope === 'selected' ? selected.length : typeof range === 'string' ? 0 : job.segments.filter((segment) => segment.startMs < range.endMs && segment.endMs > range.startMs).length;
  const error = scope === 'range' && typeof range === 'string' ? range : !count ? scope === 'selected' ? '请先在右侧字幕列表勾选字幕。' : '此范围内没有字幕，请调整检查范围。' : '';
  return <Modal title="AI 检查范围" className="review-scope-dialog" onClose={onClose}>
    <form noValidate onSubmit={(event) => { event.preventDefault(); if (isBusy || error) return; onReview(scope === 'range' && typeof range !== 'string' ? { range } : scope === 'selected' ? { segmentIds: selected.map((segment) => segment.id) } : {}); }}>
      <fieldset className="review-scope-options"><legend>检查对象</legend>{([{ value: 'all', label: '全部字幕' }, { value: 'selected', label: '已选字幕' }, { value: 'range', label: '指定时间范围' }] as const).map((item) => <label className="check-label" key={item.value}><input type="radio" name="review-scope" value={item.value} checked={scope === item.value} disabled={isBusy} onChange={() => setScope(item.value)} />{item.label}</label>)}</fieldset>
      {scope === 'range' && <div className="review-scope-times"><label>开始时间（秒）<input aria-label="检查开始时间（秒）" type="number" min="0" step="0.001" value={draft.start} disabled={isBusy} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label><label>结束时间（秒）<input aria-label="检查结束时间（秒）" type="number" min="0" step="0.001" value={draft.end} disabled={isBusy} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label></div>}
      <p className="hint">检查与范围重叠的完整字幕，范围外字幕仅供理解上下文。保留其他字幕的已有检查结果。</p>
      {error ? <p className="form-error" role="alert">{error}</p> : <p className="hint" role="status">本次检查 {count} 条字幕。</p>}
      <footer className="modal__footer"><button className="button" type="button" onClick={onClose}>取消</button><button className="button button--primary" type="submit" disabled={isBusy || Boolean(error)}>开始检查</button></footer>
    </form>
  </Modal>;
}
