import { useState, type ReactNode } from 'react';
import type { Segment } from '../../../shared/contracts';
import { validateCueTimes } from '../lib/presentation';

type Props = { segment: Segment; durationMs: number; onSave: (segment: Segment) => Promise<void>; onClose: () => void; onDelete?: () => Promise<void>; isBusy?: boolean; isNew?: boolean; translationEnabled?: boolean };
export function SegmentEditor({ segment, durationMs, onSave, onClose, onDelete, isBusy = false, isNew = false, translationEnabled = true }: Props): ReactNode {
  const [start, setStart] = useState((segment.startMs / 1000).toFixed(3));
  const [end, setEnd] = useState((segment.endMs / 1000).toFixed(3));
  const [sourceText, setSourceText] = useState(segment.sourceText);
  const [translatedText, setTranslatedText] = useState(segment.translatedText);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isDisabled = isSaving || isBusy;
  async function save(): Promise<void> {
    if (isDisabled) return;
    const timing = validateCueTimes(start, end, durationMs);
    if (typeof timing === 'string') { setError(timing); return; }
    if (isNew && !sourceText.trim()) { setError('请填写新字幕的原文。'); return; }
    setIsSaving(true); setError('');
    try { await onSave({ ...segment, ...timing, sourceText, translatedText }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。'); }
    finally { setIsSaving(false); }
  }
  async function remove(): Promise<void> {
    if (isDisabled || !onDelete) return;
    setIsSaving(true); setError('');
    try { await onDelete(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败，请重试。'); }
    finally { setIsSaving(false); }
  }
  return <section className="segment-editor" aria-label={isNew ? '添加字幕' : '校对字幕'}>
    <h3>{isNew ? '添加字幕' : '校对字幕'}</h3>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !isSaving) { event.preventDefault(); onClose(); } }}>
      <p className="hint">时间单位为秒，精确到毫秒。{translationEnabled ? '修改原文后，可重新翻译这条字幕。' : '原语言模式，直接校对并导出原文。'}</p>
      <div className="form-grid"><label>开始时间（秒）<input aria-label="开始时间（秒）" autoFocus disabled={isDisabled} inputMode="decimal" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label>结束时间（秒）<input aria-label="结束时间（秒）" disabled={isDisabled} inputMode="decimal" value={end} onChange={(event) => setEnd(event.target.value)} /></label></div>
      <label>原文<textarea aria-label="原文" rows={2} disabled={isDisabled} value={sourceText} onChange={(event) => setSourceText(event.target.value)} /></label>
      {translationEnabled && <label>译文<textarea aria-label="译文" rows={2} disabled={isDisabled} value={translatedText} onChange={(event) => setTranslatedText(event.target.value)} /></label>}
      {error && <p role="alert" className="error-message">{error}</p>}
      <footer className="segment-editor__actions">{onDelete && !isNew && <button type="button" className="text-button text-button--danger" disabled={isDisabled} onClick={() => void remove()}>删除此字幕</button>}<button type="button" className="button" disabled={isSaving} onClick={onClose}>取消</button>
        <button className="button button--primary" disabled={isDisabled}>{isSaving ? '保存中…' : '保存字幕'}</button></footer>
    </form>
  </section>;
}

