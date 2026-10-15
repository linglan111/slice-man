import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { REVIEW_RISK_LABELS, type Job, type Segment, type ReviewFinding } from '../../../shared/contracts';
import { formatTime } from '../lib/presentation';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { ReviewGrade } from './ReviewGrade';
import { ReviewFilterMenu } from './ReviewFilterMenu';
import { SubtitleTimeSelection } from './SubtitleTimeSelection';
import { ReviewRubricHelp } from './ReviewRubricHelp';
import { createRepairLoopDraft, RepairLoopControls } from './RepairLoopControls';
import type { RepairLoopInput } from '../../../shared/contracts';
import { multiFilteredReviewIds, reviewGrades, REVIEW_LEVELS, type ReviewFilter } from '../lib/review-presentation';

type Props = { job: Job; selectedIds: string[]; activeIds: string[]; isBusy: boolean; isEditing: boolean; editingId?: string; draftStartMs?: number; editor: ReactNode; onAdd: () => void; onRemove: (segment: Segment) => void; onSelect: (id: string) => void; onSelectMany?: (ids: string[]) => void; onEdit: (segment: Segment) => void; onSeek: (ms: number) => void; onRetranslate: () => void; onReview?: (ids?: string[]) => void; onReviewScope?: () => void; onRepair?: (ids: string[], operation: 'recognize' | 'translate') => void; onIgnore?: (finding: ReviewFinding) => void; onPlay?: (ms: number) => void; onRepairRange?: (range: { startMs: number; endMs: number }) => void };
const CATEGORY_LABELS = { timing: '可疑时轴', source: '可疑原文', translation: '可疑译文' };
export function SubtitleList({ job, selectedIds, activeIds, isBusy, isEditing, editingId, draftStartMs, editor, onAdd, onRemove, onSelect, onSelectMany, onEdit, onSeek, onRetranslate, onReview, onReviewScope, onRepair, onIgnore, onPlay, onRepairRange, onRepairLoop, onCancelRepair }: Props & { onRepairLoop?: (input: RepairLoopInput) => void; onCancelRepair?: () => void }): ReactNode {
  const [isFollowing, setIsFollowing] = useState(true);
  const [filters, setFilters] = useState<ReviewFilter[]>(['all']);
  const [dialog, setDialog] = useState<'rubric' | 'repair' | 'time' | null>(null);
  const [repairDraft, setRepairDraft] = useState(() => createRepairLoopDraft(job));
  const [timeDraft, setTimeDraft] = useState(() => ({ start: '0', end: String(job.media.durationMs / 1000) }));
  const grades = useMemo(() => reviewGrades(job), [job]);
  const filteredIds = useMemo(() => multiFilteredReviewIds(job, filters, grades), [job, filters, grades]);
  const visibleIds = new Set(filteredIds);
  const selectedIdSet = new Set(selectedIds);
  const selectedFilteredCount = filteredIds.filter((id) => selectedIdSet.has(id)).length;
  const allFilteredSelected = filteredIds.length > 0 && selectedFilteredCount === filteredIds.length;
  const { orphanFindings, findingsBySegment } = useMemo(() => {
    const knownIds = new Set(job.segments.map((segment) => segment.id));
    const orphan: ReviewFinding[] = []; const grouped = new Map<string, ReviewFinding[]>();
    for (const finding of job.reviewReport?.findings ?? []) {
      if (!job.options.translationEnabled && finding.category === 'translation') continue;
      grouped.set(finding.segmentId, [...(grouped.get(finding.segmentId) ?? []), finding]);
      if (finding.status === 'ignored') continue;
      if (!knownIds.has(finding.segmentId)) orphan.push(finding);
    }
    return { orphanFindings: orphan, findingsBySegment: grouped };
  }, [job.segments, job.reviewReport, job.options.translationEnabled]);
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
  return <section className="subtitle-panel" aria-label="字幕列表"><div className="section-heading subtitle-panel__heading"><div className="subtitle-panel__title"><h2>字幕校对 <span className="count">{job.segments.length}</span></h2><p className="hint">点击时间定位，勾选字幕可批量修复。</p></div>
    <div className="subtitle-panel__actions">{onRepairLoop && onCancelRepair && <button className="button" aria-haspopup="dialog" aria-expanded={dialog === 'repair'} onClick={() => setDialog('repair')}><Icon name="repair" />字幕自动修复</button>}{onReview && <div className="review-action-group"><button className="button" disabled={isBusy || !job.segments.length} onClick={() => onReview()}><Icon name="review" />AI 检查字幕</button>{onReviewScope && <button className="button review-scope-trigger" aria-label="检查范围" title="选择 AI 检查范围" aria-haspopup="dialog" disabled={isBusy || !job.segments.length} onClick={onReviewScope}><Icon name="settings" /></button>}</div>}<button className="button" aria-label="添加字幕" disabled={isBusy} onClick={() => { setFilters(['all']); onAdd(); }}><Icon name="add" />添加字幕</button></div></div>
    {onReview && <div className="review-toolbar review-toolbar--grades">
      <div className="review-toolbar__filter-group">
        <ReviewFilterMenu value={filters} onChange={setFilters} choices={[
          { value: 'all', label: '全部', count: job.segments.length }, { value: 'unchecked', label: '未检查', count: grades.uncheckedIds.length },
          ...REVIEW_LEVELS.map((level) => ({ value: level, label: REVIEW_RISK_LABELS[level], count: grades.counts[level] })),
        ]} />
        <button className="text-button" aria-label="可疑度判断标准" aria-haspopup="dialog" aria-expanded={dialog === 'rubric'} title="查看统一等级标准、例子与排除条件" onClick={() => setDialog((value) => value === 'rubric' ? null : 'rubric')}>可疑度标准</button>
        {filters.includes('unchecked') && grades.uncheckedIds.length > 0 && <button className="text-button" disabled={isBusy} onClick={() => onReview(grades.uncheckedIds)}>检查未检查字幕</button>}
      </div>
      <div className="review-toolbar__view-group">
        <button className="text-button review-toolbar__select-all" disabled={isBusy || !filteredIds.length || !onSelectMany} onClick={() => onSelectMany?.(allFilteredSelected ? selectedIds.filter((id) => !visibleIds.has(id)) : [...new Set([...selectedIds, ...filteredIds])])}>{allFilteredSelected ? '取消全选' : '全选'}</button>
        <button className="text-button" aria-haspopup="dialog" aria-expanded={dialog === 'time'} disabled={isBusy || !job.segments.length || !onSelectMany} onClick={() => setDialog('time')}>选择时间范围</button>
        <label className="check-label review-toolbar__follow"><input type="checkbox" checked={isFollowing} onChange={(event) => setIsFollowing(event.target.checked)} />跟随播放</label>
      </div>
    </div>}
    {job.reviewReport && <p className="review-summary hint">{!job.reviewReport.assessments ? '旧版检查未分级，请重新检查。' : job.reviewReport.state === 'stale' ? '部分结果需复查；等级数量仅统计当前有效结果。' : '结合上下文的文本检查；可疑度不代表音频识别正确。'}</p>}
    {!onReview && <div className="subtitle-tools"><label className="check-label"><input type="checkbox" checked={isFollowing} onChange={(event) => setIsFollowing(event.target.checked)} />跟随播放</label></div>}
    {isEditing && <span className="hint">编辑时暂停跟随</span>}
    {selectedIds.length > 0 && <div className="subtitle-tools subtitle-tools--selection"><span className="hint">已选 {selectedIds.length} 条</span>{onRepair && <button className="text-button" disabled={isBusy} onClick={() => onRepair(selectedIds, 'recognize')}>重新识别选中</button>}{job.options.translationEnabled && <button className="text-button" disabled={isBusy || job.stages.recognize.state !== 'succeeded'} onClick={onRetranslate}>重译选中（{selectedIds.length}）</button>}{onReview && <button className="text-button" disabled={isBusy} onClick={() => onReview(selectedIds)}>检查选中</button>}</div>}
    <div className="subtitle-list" ref={listRef} tabIndex={0} aria-label="可滚动字幕" onWheel={() => setIsFollowing(false)} onPointerDown={(event) => {
      const list = event.currentTarget;
      if (event.target === list && event.clientX >= list.getBoundingClientRect().left + list.clientWidth) setIsFollowing(false);
    }} onKeyDown={(event) => {
      if (event.target === event.currentTarget && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) setIsFollowing(false);
    }}>{job.segments.map((segment, index) => (visibleIds.has(segment.id) || editingId === segment.id) && <Fragment key={segment.id}>
      {draftStartMs !== undefined && draftIndex === index && editor}
      <article ref={(element) => { if (element) rowRefs.current.set(segment.id, element); else rowRefs.current.delete(segment.id); }} className={`subtitle-row ${activeIds.includes(segment.id) ? 'subtitle-row--active' : ''}`} aria-current={activeIds.includes(segment.id) ? 'true' : undefined} data-testid={`segment-${index}`}>
      <input aria-label={`选择字幕 ${index + 1}`} type="checkbox" disabled={isBusy} checked={selectedIds.includes(segment.id)} onChange={() => onSelect(segment.id)} />
      <div className="subtitle-row__body"><div className="subtitle-row__meta"><span className="cue-number">{String(index + 1).padStart(2, '0')}</span><button className="time-button" onClick={() => onSeek(segment.startMs)}>{formatTime(segment.startMs)} → {formatTime(segment.endMs)}</button>{job.options.translationEnabled && segment.translationStale && <span className="stale-badge">待重译</span>}<ReviewGrade view={grades.views.get(segment.id) ?? { state: 'unreviewed' }} />{onReview && grades.views.get(segment.id)?.state === 'stale' && !(findingsBySegment.get(segment.id)?.some((finding) => finding.status !== 'ignored')) && <button className="text-button" disabled={isBusy} onClick={() => onReview([segment.id])}>复查</button>}</div>
        <p className={`subtitle-row__source ${!job.options.translationEnabled ? 'subtitle-row__source--primary' : ''}`}>{segment.sourceText || '（空原文）'}</p>{job.options.translationEnabled && <p className="subtitle-row__translation">{segment.translatedText || '等待翻译…'}</p>}
        {(findingsBySegment.get(segment.id) ?? []).map((finding) => <div key={finding.id} className={`review-finding review-finding--${finding.status}`}><p><strong>{CATEGORY_LABELS[finding.category]}</strong> · {finding.reason}{finding.status === 'recheck' && <span className="stale-badge">需复查</span>}{finding.status === 'ignored' && <span className="hint">已忽略</span>}</p>{finding.status !== 'ignored' && <div className="review-finding__actions"><button className="text-button" onClick={() => (onPlay ?? onSeek)(segment.startMs)}>定位播放</button><button className="text-button" disabled={isBusy} onClick={() => onRepair?.([segment.id], 'recognize')}>重新识别</button>{job.options.translationEnabled && <button className="text-button" disabled={isBusy} onClick={() => onRepair?.([segment.id], 'translate')}>仅重新翻译</button>}<button className="text-button" disabled={isBusy} onClick={() => onEdit(segment)}>手工修改</button><button className="text-button" disabled={isBusy} onClick={() => onReview?.([segment.id])}>复查</button><button className="text-button" disabled={isBusy || finding.status === 'recheck'} title={finding.status === 'recheck' ? '请先复查新字幕' : undefined} onClick={() => onIgnore?.(finding)}>忽略</button></div>}</div>)}{editingId === segment.id && editor}</div>
      <div className="subtitle-row__actions"><button className="icon-button" aria-label={`编辑字幕 ${index + 1}`} disabled={isBusy} onClick={() => onEdit(segment)}><Icon name="edit" /></button><button className="text-button text-button--danger" aria-label={`删除字幕 ${index + 1}`} disabled={isBusy} onClick={() => onRemove(segment)}>删除</button></div>
    </article></Fragment>)}{draftStartMs !== undefined && draftIndex === job.segments.length && editor}
    {(filters.includes('all') || filters.includes('unchecked')) && orphanFindings.map((finding) => <div key={finding.id} className="review-finding review-finding--recheck"><p><strong>原片段需复查</strong> · {finding.reason}<span className="stale-badge">需复查</span></p><p className="hint">原字幕已被替换，旧提示不代表新字幕的检查结论。</p>{finding.startMs !== undefined && finding.endMs !== undefined && <div className="review-finding__actions"><button className="text-button" onClick={() => (onPlay ?? onSeek)(finding.startMs ?? 0)}>定位播放</button><button className="text-button" disabled={isBusy} onClick={() => { if (finding.startMs !== undefined && finding.endMs !== undefined) onRepairRange?.({ startMs: finding.startMs, endMs: finding.endMs }); }}>重新识别原片段</button></div>}<button className="text-button" disabled={isBusy || finding.status === 'recheck'} title={finding.status === 'recheck' ? '请先复查新字幕' : undefined} onClick={() => onIgnore?.(finding)}>忽略</button></div>)}
    {!filters.includes('all') && !filteredIds.length && !(filters.includes('unchecked') && orphanFindings.length) && <div className="editor-empty"><h3>{filters.length === 1 && filters[0] === 'unchecked' ? '没有未检查字幕' : '没有符合当前筛选的字幕'}</h3><p>未检查包含尚未检查和需重新检查的字幕；可切换其他等级继续校对。</p></div>}
    {!job.segments.length && draftStartMs === undefined && <div className="editor-empty"><span className="empty-glyph">≡</span><h3>字幕将在这里出现</h3><p>可以添加手工字幕，或选择服务识别原片。</p></div>}</div>
    {dialog === 'rubric' && <Modal title="可疑度判断标准" onClose={() => setDialog(null)}><ReviewRubricHelp /></Modal>}
    {dialog === 'time' && <Modal title="选择时间范围" className="time-selection-dialog" onClose={() => setDialog(null)}><SubtitleTimeSelection segments={job.segments} durationMs={job.media.durationMs} visibleIds={visibleIds} draft={timeDraft} onChange={setTimeDraft} isBusy={isBusy} unavailable={!onSelectMany} onSelect={(ids) => { onSelectMany?.([...new Set([...selectedIds, ...ids])]); setDialog(null); }} /></Modal>}
    {dialog === 'repair' && onRepairLoop && onCancelRepair && <Modal title="字幕自动修复" className="repair-loop-dialog" onClose={() => setDialog(null)}><RepairLoopControls job={job} isBusy={isBusy} onStart={onRepairLoop} onCancel={onCancelRepair} draft={repairDraft} onDraftChange={setRepairDraft} /><p className="hint">关闭窗口不会取消正在执行的修复；可再次打开查看进度。</p></Modal>}
  </section>;
}
