import { useEffect, useState, type ReactNode } from 'react';
import type { Job, Profile } from '../../../shared/contracts';
import type { Chapter, ChapterPlan, PlanChaptersInput, UpdateChaptersInput } from '../../../shared/chapter-contracts';
import type { ChapterExportInput, ChapterExportRun, CriterionLibrary } from '../../../shared/chapter-export-contracts';
import { requireResult } from '../lib/api-result';
import { formatTime } from '../lib/presentation';
import { ChapterCriteriaDialog } from './ChapterCriteriaDialog';
import { ExportForm } from './ExportDialog';
import { Modal } from './Modal';

type Props = { job: Job; profiles: Profile[]; isBusy: boolean; onPlan: (input: PlanChaptersInput) => Promise<void>; onUpdate: (input: UpdateChaptersInput) => Promise<void>; onExport: (input: ChapterExportInput) => Promise<ChapterExportRun | null>; onSeek: (ms: number) => void; onClose: () => void };
export function ChapterPanel({job, profiles, isBusy, onPlan, onUpdate, onExport, onSeek, onClose}: Props): ReactNode {
  const [kind, setKind] = useState<'normal' | 'custom'>('normal');
  const [profileId, setProfileId] = useState(job.options.chapterProfileId ?? job.options.translationProfileId ?? job.options.reviewProfileId ?? '');
  const [library, setLibrary] = useState<CriterionLibrary>({items: []});
  const [dialog, setDialog] = useState<'criteria' | 'export' | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Chapter[]>();
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<ChapterExportRun[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  const plan: ChapterPlan | undefined = kind === 'normal' ? job.chapterPlan : job.customChapterPlan;
  const busy = isBusy || isWorking;
  useEffect(() => { if (isBusy) setError(''); }, [isBusy]);
  useEffect(() => { let current = true; void Promise.all([requireResult(window.api.chapterCriteria.list()), requireResult(window.api.chapterExports.list(job.id))]).then(([next, exports]) => {if (current) {setLibrary(next); setRuns(exports);}}).catch((cause: unknown) => {if (current) setError(cause instanceof Error ? cause.message : '无法读取章节');}); return () => {current = false;}; }, [job.id, job.revision]);
  async function perform(action: () => Promise<void>): Promise<void> { setIsWorking(true); setError(''); try {await action();} catch(cause) {setError(cause instanceof Error ? cause.message : '章节操作失败');} finally {setIsWorking(false);} }
  function toggleKind(next: 'normal' | 'custom'): void {setKind(next); setSelectedIds([]); setEditing(undefined); setError('');}
  const chapters = editing ?? plan?.chapters ?? [];
  const selected = chapters.filter((chapter) => selectedIds.includes(chapter.id));
  const allSelected = chapters.length > 0 && selected.length === chapters.length;
  function updateChapter(id: string, patch: Partial<Chapter>): void {setEditing(chapters.map((chapter) => chapter.id === id ? {...chapter, ...patch} : chapter));}
  async function reloadRuns(): Promise<void> {setRuns(await requireResult(window.api.chapterExports.list(job.id)));}
  const compatibleRuns = runs.filter((run) => run.planId === plan?.id && run.planRevision === plan.revision && run.state !== 'complete' && run.input?.revision === job.revision);
  return <section className="chapter-panel" aria-label="章节操作">
    <div className="chapter-panel__setup">
      <label>章节类型<select aria-label="章节类型" value={kind} disabled={busy || Boolean(editing)} onChange={(event) => toggleKind(event.target.value === 'custom' ? 'custom' : 'normal')}><option value="normal">完整内容章节</option><option value="custom">自定义切分章节</option></select></label>
      <label>章节分析服务<select aria-label="章节分析服务" value={profileId} disabled={busy} onChange={(event) => setProfileId(event.target.value)}><option value="">请选择文字模型</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
      {kind === 'custom' && <label>切分标准<select aria-label="切分标准" value={library.selectedId ?? ''} disabled={busy} onChange={(event) => void perform(async () => setLibrary(await requireResult(window.api.chapterCriteria.select({id: event.target.value || undefined}))))}><option value="">请选择标准</option>{library.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {kind === 'custom' && <button className="button" disabled={busy} onClick={() => setDialog('criteria')}>管理切分标准</button>}
      <button className="button button--primary" disabled={busy || Boolean(editing) || !profiles.some((profile) => profile.id === profileId) || (kind === 'custom' && !library.selectedId)} onClick={() => void perform(async () => {await onPlan({jobId: job.id, revision: job.revision, kind, profileId, ...(kind === 'custom' ? {criterionId: library.selectedId} : {})}); setSelectedIds([]);})}>{plan ? '重新 AI 切分' : 'AI 切分章节'}</button>
    </div>
    <p className="hint">每章不超过 20 分钟；点击 AI 切分时才发送原文字幕。</p>
    {plan?.criterion && <details className="chapter-panel__snapshot"><summary>本计划标准：{plan.criterion.name} · v{plan.criterion.revision}</summary><p>{plan.criterion.instructions}</p></details>}
    {plan && <><div className="chapter-panel__selection"><span>{chapters.length} 章 · 已选 {selected.length}</span><button className="text-button" disabled={busy || !chapters.length} onClick={() => setSelectedIds(allSelected ? [] : chapters.map((chapter) => chapter.id))}>{allSelected ? '取消全选章节' : '全选章节'}</button>{plan.state === 'stale' && <span className="error-message">源字幕已变化，请重新切分。</span>}</div>
      {!chapters.length && <p className="hint">本次没有符合标准的章节，可调整标准后重新切分。</p>}
      <div className="chapter-panel__list" aria-label="章节列表">{chapters.map((chapter, index) => <article key={chapter.id} className="chapter-row">
        <div className="chapter-row__heading"><input aria-label={`选择章节 ${index + 1}`} type="checkbox" disabled={busy} checked={selectedIds.includes(chapter.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, chapter.id] : ids.filter((id) => id !== chapter.id))} /><input aria-label={`章节 ${index + 1} 标题`} maxLength={120} value={chapter.title} disabled={busy} onChange={(event) => updateChapter(chapter.id, {title: event.target.value})} /><button className="text-button" disabled={busy} onClick={() => onSeek(chapter.startMs)}>定位 {formatTime(chapter.startMs)}</button></div>
        <div className="chapter-row__times"><label>开始（秒）<input aria-label={`章节 ${index + 1} 开始（秒）`} type="number" min={0} step={.001} value={chapter.startMs / 1000} disabled={busy} onChange={(event) => updateChapter(chapter.id, {startMs: Math.round(Number(event.target.value) * 1000)})} /></label><label>结束（秒）<input aria-label={`章节 ${index + 1} 结束（秒）`} type="number" min={0} step={.001} value={chapter.endMs / 1000} disabled={busy} onChange={(event) => updateChapter(chapter.id, {endMs: Math.round(Number(event.target.value) * 1000)})} /></label><label>摘要<textarea aria-label={`章节 ${index + 1} 摘要`} rows={1} maxLength={1000} value={chapter.summary} disabled={busy} onChange={(event) => updateChapter(chapter.id, {summary: event.target.value})} /></label></div>
      </article>)}</div></>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {compatibleRuns.length > 0 && <details><summary>未完成的章节导出（{compatibleRuns.length}）</summary>{compatibleRuns.map((run) => <div className="chapter-panel__selection" key={run.id}><span>已完成 {run.clips.filter((clip) => clip.state === 'complete').length}/{run.clips.length} · {run.input?.format.toUpperCase()}</span><button className="button" disabled={busy || Boolean(editing)} onClick={() => void perform(async () => {if (run.input) {try {await onExport({...run.input, runId: run.id});} finally {await reloadRuns();}}})}>继续未完成导出</button></div>)}</details>}
    <footer className="operation-panel__actions"><button className="button" onClick={onClose}>返回工作区</button>{editing && <><button className="button" disabled={busy} onClick={() => setEditing(undefined)}>放弃章节修改</button><button className="button button--primary" disabled={busy || !plan} onClick={() => void perform(async () => {if (plan) {await onUpdate({jobId: job.id, revision: job.revision, planId: plan.id, planRevision: plan.revision, chapters: editing}); setEditing(undefined);}})}>保存章节修改</button></>}<button className="button button--primary" disabled={busy || Boolean(editing) || !plan || plan.state !== 'current' || !selected.length} onClick={() => setDialog('export')}>导出所选章节（{selected.length}）</button></footer>
    {dialog === 'criteria' && <ChapterCriteriaDialog library={library} onChange={setLibrary} onClose={() => setDialog(null)} />}
    {dialog === 'export' && plan && <Modal title="按章节标题导出" onClose={() => setDialog(null)}><p className="hint">导出 {selected.length} 个独立文件；字幕按章节边界裁剪并从零计时。已有文件保留。</p><ExportForm jobId={job.id} onClose={() => setDialog(null)} onExport={async (options) => {try {return Boolean(await onExport({...options, revision: job.revision, planId: plan.id, planRevision: plan.revision, chapterIds: selected.map((chapter) => chapter.id)}));} finally {await reloadRuns();}}} /></Modal>}
  </section>;
}
