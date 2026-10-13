import { useState, type ReactNode } from 'react';
import { applyNamesInputSchema, type ApplyNamesInput, type UndoNamesInput, type Job, type NameReport, type NameMapping } from '../../../shared/contracts';
import '../styles/person-names.css';

type Props = { job: Job; isBusy: boolean; onAnalyze: () => void; onApply: (input: ApplyNamesInput) => void; onUndo: (input: UndoNamesInput) => void; onCancel: () => void; onChooseProfile: () => void };
function NameEditor({ job, report, isBusy, onApply, onCancel }: Pick<Props, 'job' | 'isBusy' | 'onApply' | 'onCancel'> & { report: NameReport }): ReactNode {
  const [mappings, setMappings] = useState<NameMapping[]>(() => report.candidates.map((candidate) => ({ candidateId: candidate.id, sourceName: candidate.sourceName, ...(job.options.translationEnabled && candidate.translatedName ? { translatedName: candidate.translatedName } : {}), enabled: true })));
  const change = (id: string, patch: Partial<NameMapping>): void => setMappings((previous) => previous.map((mapping) => mapping.candidateId === id ? { ...mapping, ...patch } : mapping));
  const input = applyNamesInputSchema.safeParse({ jobId: job.id, revision: job.revision, reportId: report.id, mappings });
  const fresh = report.state === 'current';
  const candidates = <div className="person-names__candidates">
      {report.candidates.map((candidate) => {
        const mapping = mappings.find((m) => m.candidateId === candidate.id);
        if (!mapping) return null;
        const examples = [...new Set(candidate.occurrences.map((o) => o.segmentId))].slice(0, 2).map((id) => job.segments.find((cue) => cue.id === id)).filter((cue) => cue !== undefined);
        return <article key={candidate.id} className="person-names__candidate">
          <label className="person-names__choice"><input type="checkbox" checked={mapping.enabled} disabled={isBusy || !fresh} onChange={(event) => change(candidate.id, { enabled: event.target.checked })} />{candidate.sourceName} · {candidate.cueCount} 条字幕，原名 {candidate.sourceCount} 次{job.options.translationEnabled && `／译名 ${candidate.translatedCount} 次`}</label>
          <div className="person-names__fields"><label>替换原名<input aria-label={`${candidate.sourceName} 替换原名`} maxLength={120} value={mapping.sourceName} disabled={isBusy || !fresh || !mapping.enabled} onChange={(event) => change(candidate.id, { sourceName: event.target.value })} /></label>{job.options.translationEnabled && <label>替换译名<input aria-label={`${candidate.sourceName} 替换译名`} maxLength={120} value={mapping.translatedName ?? ''} disabled={isBusy || !fresh || !mapping.enabled} onChange={(event) => change(candidate.id, { translatedName: event.target.value })} /></label>}</div>
          <p className="hint">字幕别名：{candidate.sourceAliases.join('、')}{job.options.translationEnabled && candidate.translatedAliases.length > 0 && `；译名：${candidate.translatedAliases.join('、')}`}。{candidate.reason}</p>
          {examples.map((cue) => <p className="person-names__context" key={cue.id}>{cue.sourceText}{job.options.translationEnabled && cue.translatedText && <><br />{cue.translatedText}</>}</p>)}
        </article>;
      })}
      {!report.candidates.length && <p className="hint">没有找到在至少两条字幕中出现的关键人名。</p>}
    </div>;
  return <>
    {fresh ? candidates : <details className="person-names__history"><summary>查看上次人名检查结果</summary>{candidates}</details>}
    {!fresh && <p className="hint" role="status">字幕或服务已改变，请重新分析后再应用。</p>}
    {!input.success && <p className="error-message" role="alert">原名和所需译名须为 1–120 字符，不能为空。</p>}
    <div className="person-names__actions person-names__footer"><button className="button ghost" disabled={isBusy} onClick={onCancel}>取消人名修改</button><button className="button button--primary" disabled={isBusy || !fresh || !input.success || !mappings.some((m) => m.enabled)} onClick={() => { if (input.success) onApply(input.data); }}>应用选中人名</button></div>
  </>;
}
export function PersonNamePanel({ job, isBusy, onAnalyze, onApply, onUndo, onCancel, onChooseProfile }: Props): ReactNode {
  const report = job.nameReport;
  const batch = job.nameBatch;
  return <section className="person-names" aria-label="人名检查">
    <div className="person-names__overview"><div><strong>检查关键人名</strong><p className="hint">至少在两条字幕中出现。推荐值需确认后才会应用；中日韩名字按字面匹配，请核对上下文。</p></div><div className="person-names__actions"><button className="button" disabled={isBusy || !job.segments.length} onClick={job.options.reviewProfileId ? onAnalyze : onChooseProfile}>{report ? '重新检查人名' : 'AI 检查人名'}</button>{batch?.state === 'available' && <button className="button ghost" disabled={isBusy} onClick={() => onUndo({ jobId: job.id, revision: job.revision, batchId: batch.id })}>撤销上次人名修改</button>}{isBusy && <button className="button ghost" onClick={onCancel}>取消人名检查</button>}</div></div>
    {!job.options.reviewProfileId && <p className="hint">请先选择 AI 检查服务。</p>}
    {batch?.undo && <div className="person-names__undo" role="status">已撤销 {batch.undo.restoredFields} 个字幕字段；保留 {batch.undo.skippedFields} 个发生后续修改或已删除的字段。{batch.undo.conflicts.length > 0 && <details><summary>查看未回退条目（{batch.undo.conflicts.length}）</summary><ul>{batch.undo.conflicts.map((conflict, index) => <li key={index}>{job.segments.findIndex((cue) => cue.id === conflict.segmentId) >= 0 ? `字幕 ${job.segments.findIndex((cue) => cue.id === conflict.segmentId) + 1}` : `已删除字幕 ${conflict.segmentId}`} · {{ sourceText: '原文', translatedText: '译文', emphasis: '强调关键词' }[conflict.field]} · {{ changed: '后续已修改，保留当前值', missing: '字幕已删除或重新识别', keyword_invalid: '关键词不在当前字幕中' }[conflict.reason]}</li>)}</ul></details>}</div>}
    {batch?.state === 'available' && <p className="hint">仅保留最近一次成功批次。撤销保留后来编辑过的整个字段，完成后不可重复撤销。</p>}
    {!report && !isBusy && <div className="person-names__actions person-names__footer"><button className="button ghost" onClick={onCancel}>取消人名修改</button></div>}
    {report && <NameEditor key={`${job.id}:${report.id}`} job={job} report={report} isBusy={isBusy} onApply={onApply} onCancel={onCancel} />}
  </section>;
}
