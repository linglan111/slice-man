import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Job, Segment } from '../../../shared/contracts';
import { formatTime } from '../lib/presentation';

type Props = { job: Job; selectedIds: string[]; activeIds: string[]; isBusy: boolean; isEditing: boolean; editingId?: string; draftStartMs?: number; editor: ReactNode; onAdd: () => void; onRemove: (segment: Segment) => void; onSelect: (id: string) => void; onEdit: (segment: Segment) => void; onSeek: (ms: number) => void; onRetranslate: () => void };
export function SubtitleList({ job, selectedIds, activeIds, isBusy, isEditing, editingId, draftStartMs, editor, onAdd, onRemove, onSelect, onEdit, onSeek, onRetranslate }: Props): ReactNode {
  const [isFollowing, setIsFollowing] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const insertion = draftStartMs === undefined ? -1 : job.segments.findIndex((segment) => segment.startMs >= draftStartMs);
  const draftIndex = insertion < 0 ? job.segments.length : insertion;
  useEffect(() => {
    if (!isFollowing || isEditing) return;
    const list = listRef.current;
    const firstId = activeIds[0];
    const row = firstId ? rowRefs.current.get(firstId) : undefined;
    if (!list || !row) return;
    const bounds = list.getBoundingClientRect();
    const target = row.getBoundingClientRect();
    if (target.top < bounds.top || target.bottom > bounds.bottom) list.scrollTo({ top: list.scrollTop + target.top - bounds.top, behavior: 'smooth' });
  }, [activeIds, isFollowing, isEditing]);
  return <section className="subtitle-panel" aria-label="字幕列表"><div className="section-heading"><div><h2>字幕校对 <span className="count">{job.segments.length}</span></h2><p className="hint">点击时间定位；勾选后可单独重译。</p></div>
    <button className="button" disabled={isBusy || job.stages.recognize.state !== 'succeeded' || !selectedIds.length} onClick={onRetranslate}>重译选中（{selectedIds.length}）</button></div>
    <div className="subtitle-tools"><button className="button" disabled={isBusy} onClick={onAdd}>＋ 添加字幕</button><label className="check-label"><input type="checkbox" checked={isFollowing} onChange={(event) => setIsFollowing(event.target.checked)} />跟随播放</label>{isEditing && <span className="hint">编辑时暂停跟随</span>}</div>
    <div className="subtitle-list" ref={listRef} tabIndex={0} aria-label="可滚动字幕" onWheel={() => setIsFollowing(false)} onPointerDown={(event) => {
      const list = event.currentTarget;
      if (event.target === list && event.clientX >= list.getBoundingClientRect().left + list.clientWidth) setIsFollowing(false);
    }} onKeyDown={(event) => {
      if (event.target === event.currentTarget && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) setIsFollowing(false);
    }}>{job.segments.map((segment, index) => <Fragment key={segment.id}>
      {draftStartMs !== undefined && draftIndex === index && editor}
      <article ref={(element) => { if (element) rowRefs.current.set(segment.id, element); else rowRefs.current.delete(segment.id); }} className={`subtitle-row ${activeIds.includes(segment.id) ? 'subtitle-row--active' : ''}`} aria-current={activeIds.includes(segment.id) ? 'true' : undefined} data-testid={`segment-${index}`}>
      <input aria-label={`选择字幕 ${index + 1}`} type="checkbox" disabled={isBusy} checked={selectedIds.includes(segment.id)} onChange={() => onSelect(segment.id)} />
      <div className="subtitle-row__body"><div className="subtitle-row__meta"><span className="cue-number">{String(index + 1).padStart(2, '0')}</span><button className="time-button" onClick={() => onSeek(segment.startMs)}>{formatTime(segment.startMs)} → {formatTime(segment.endMs)}</button>{segment.translationStale && <span className="stale-badge">待重译</span>}</div>
        <p className="subtitle-row__source">{segment.sourceText || '（空原文）'}</p><p className="subtitle-row__translation">{segment.translatedText || '等待翻译…'}</p>{editingId === segment.id && editor}</div>
      <div className="subtitle-row__actions"><button className="icon-button" aria-label={`编辑字幕 ${index + 1}`} disabled={isBusy} onClick={() => onEdit(segment)}>✎</button><button className="text-button text-button--danger" aria-label={`删除字幕 ${index + 1}`} disabled={isBusy} onClick={() => onRemove(segment)}>删除</button></div>
    </article></Fragment>)}{draftStartMs !== undefined && draftIndex === job.segments.length && editor}
    {!job.segments.length && draftStartMs === undefined && <div className="editor-empty"><span className="empty-glyph">≡</span><h3>字幕将在这里出现</h3><p>可以添加手工字幕，或选择服务识别原片。</p></div>}</div>
  </section>;
}
