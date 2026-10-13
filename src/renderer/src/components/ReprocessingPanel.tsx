import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Job, ReprocessTarget, ReprocessPlan } from '../../../shared/contracts';
import { requireResult } from '../lib/api-result';
import { formatTime, validateCueTimes } from '../lib/presentation';

type Props = { initialRange?: { startMs: number; endMs: number }; job: Job; operation: 'recognize' | 'translate'; selectedIds: string[]; currentTimeMs: number; isBusy: boolean; onClose: () => void; onExecute: (target: ReprocessTarget, translate: boolean) => Promise<void> };
export function ReprocessingPanel({ initialRange, job, operation, selectedIds, currentTimeMs, isBusy, onClose, onExecute }: Props): ReactNode {
  const [mode, setMode] = useState<'selection' | 'range'>(initialRange ? 'range' : selectedIds.length ? 'selection' : 'range');
  const [start, setStart] = useState((Math.min(initialRange?.startMs ?? currentTimeMs, Math.max(0, job.media.durationMs - 1)) / 1000).toFixed(3));
  const [end, setEnd] = useState((Math.min(job.media.durationMs, initialRange?.endMs ?? currentTimeMs + 10000) / 1000).toFixed(3));
  const [shouldTranslate, setShouldTranslate] = useState(false);
  const [plan, setPlan] = useState<ReprocessPlan | null>(null);
  const [error, setError] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const selectedKey = JSON.stringify(selectedIds);
  const target = useMemo<ReprocessTarget | null>(() => {
    if (mode === 'selection') { const ids = JSON.parse(selectedKey) as string[]; return ids.length ? { mode, segmentIds: ids } : null; }
    const times = validateCueTimes(start, end, job.media.durationMs);
    return typeof times === 'string' ? null : { mode, ...times };
  }, [mode, selectedKey, start, end, job.media.durationMs]);
  useEffect(() => {
    let isCurrent = true;
    setPlan(null); setError('');
    if (!target || isBusy) { setIsPlanning(false); return; }
    setIsPlanning(true);
    void requireResult(window.api.jobs.planReprocess({ jobId: job.id, revision: job.revision, target, operation })).then((next) => { if (isCurrent) setPlan(next); }).catch((cause: unknown) => { if (isCurrent) setError(cause instanceof Error ? cause.message : '无法计算处理范围。'); }).finally(() => { if (isCurrent) setIsPlanning(false); });
    return () => { isCurrent = false; };
  }, [job.id, job.revision, target, operation, isBusy]);
  async function execute(): Promise<void> {
    if (!target || !plan || isBusy) return;
    try { await onExecute(target, job.options.translationEnabled && shouldTranslate); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '处理失败，已有字幕保留。'); }
  }
  return <section className="reprocessing-panel" aria-label="分段处理">
    <div className="section-heading"><h3>{operation === 'recognize' ? '重新识别片段' : '重新翻译片段'}</h3><button className="icon-button" aria-label="关闭分段处理" disabled={isBusy} onClick={onClose}>×</button></div>
    <div className="reprocessing-panel__body">
      <div className="reprocessing-panel__controls">
        <div className="reprocessing-panel__modes"><button className="button" aria-pressed={mode === 'selection'} disabled={isBusy} onClick={() => setMode('selection')}>勾选字幕（{selectedIds.length}）</button><button className="button" aria-pressed={mode === 'range'} disabled={isBusy} onClick={() => setMode('range')}>起止时间</button></div>
        {mode === 'range' ? <div className="form-grid"><label>片段开始（秒）<input aria-label="片段开始（秒）" inputMode="decimal" value={start} disabled={isBusy} onChange={(event) => setStart(event.target.value)} /></label><label>片段结束（秒）<input aria-label="片段结束（秒）" inputMode="decimal" value={end} disabled={isBusy} onChange={(event) => setEnd(event.target.value)} /></label></div> : <p className="hint">在右侧字幕列表勾选要处理的条目，支持不连续的片段。</p>}
        {!target && <p className="hint">{mode === 'selection' ? '请先勾选至少一条字幕。' : validateCueTimes(start, end, job.media.durationMs) as string}</p>}
      </div>
      <div className="reprocessing-panel__summary">
        {isPlanning && <p role="status" className="hint">正在计算实际范围…</p>}
        {plan && <div className="reprocessing-panel__scope" role="status"><strong>实际处理范围 · {plan.affectedCount} 条已有字幕</strong><p>{plan.intervals.map((interval) => `${formatTime(interval.startMs)} → ${formatTime(interval.endMs)}`).join('；')}</p><small>{operation === 'recognize' ? '按完整字幕边界替换；失败或取消保留原内容。' : '仅更新目标译文，保留原文和时间。'}{operation === 'recognize' && job.options.recognition === 'cloud' && ' 云端识别将上传片段音频，可能计费。'}</small></div>}
      </div>
    </div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <footer className="reprocessing-panel__actions">{operation === 'recognize' && job.options.translationEnabled && <label className="check-label reprocessing-panel__translation"><input type="checkbox" aria-label="同时翻译" checked={shouldTranslate} disabled={isBusy} onChange={(event) => setShouldTranslate(event.target.checked)} />同时翻译</label>}<button className="button" disabled={isBusy} onClick={onClose}>取消</button><button className="button button--primary" disabled={isBusy || !plan || !target || (operation === 'translate' && !plan.affectedCount)} onClick={() => void execute()}>{isBusy ? '处理中…' : operation === 'recognize' ? '识别并替换片段' : '翻译选定片段'}</button></footer>
  </section>;
}
