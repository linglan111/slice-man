import type { ReactNode } from 'react';
import type { Segment } from '../../../shared/contracts';
import { validateCueTimes } from '../lib/presentation';

export type TimeSelectionDraft = { start: string; end: string };
type Props = { segments: Segment[]; durationMs: number; visibleIds: Set<string>; draft: TimeSelectionDraft; onChange: (draft: TimeSelectionDraft) => void; onSelect: (ids: string[]) => void; isBusy: boolean; unavailable: boolean };

export function SubtitleTimeSelection({ segments, durationMs, visibleIds, draft, onChange, onSelect, isBusy, unavailable }: Props): ReactNode {
  const timing = validateCueTimes(draft.start, draft.end, durationMs);
  const ids = typeof timing === 'string' ? [] : segments.filter((segment) => visibleIds.has(segment.id) && segment.startMs < timing.endMs && segment.endMs > timing.startMs).map((segment) => segment.id);
  return <form className="time-selection-form" onSubmit={(event) => { event.preventDefault(); if (!isBusy && !unavailable && typeof timing !== 'string' && ids.length) onSelect(ids); }}>
    <p className="hint">选择与此时间范围重叠、且符合当前可疑度筛选的字幕。保留此前已选字幕。</p>
    <div className="time-selection-form__fields">
      <label>开始时间（秒）<input aria-label="选择范围开始（秒）" type="number" min="0" step="0.001" value={draft.start} disabled={isBusy} onChange={(event) => onChange({ ...draft, start: event.target.value })} /></label>
      <label>结束时间（秒）<input aria-label="选择范围结束（秒）" type="number" min="0" step="0.001" value={draft.end} disabled={isBusy} onChange={(event) => onChange({ ...draft, end: event.target.value })} /></label>
    </div>
    {typeof timing === 'string' ? <p className="form-error" role="alert">{timing}</p> : <p className="hint" role="status">此范围符合筛选的字幕：{ids.length} 条</p>}
    <div className="form-actions"><button className="button button--primary" type="submit" disabled={isBusy || unavailable || !ids.length || typeof timing === 'string'}>选择此范围</button></div>
  </form>;
}
