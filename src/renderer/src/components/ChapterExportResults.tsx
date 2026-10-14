import { useEffect, useState, type ReactNode } from 'react';
import type { Job } from '../../../shared/contracts';
import type { ChapterExportInput, ChapterExportRun } from '../../../shared/chapter-export-contracts';
import { requireResult } from '../lib/api-result';
const RUN_STATES: Record<ChapterExportRun['state'], string> = {running:'正在导出', complete:'导出完成', failed:'导出失败', cancelled:'已取消', interrupted:'上次导出中断'};
const CLIP_STATES = {pending:'待处理', running:'导出中', complete:'已完成', failed:'失败'};
export function ChapterExportResults({job, isBusy, onResume}: {job: Job; isBusy: boolean; onResume: (input: ChapterExportInput) => Promise<void>}): ReactNode {
  const [runs, setRuns] = useState<ChapterExportRun[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    async function load(): Promise<void> {try {const next = await requireResult(window.api.chapterExports.list(job.id)); if(current) {setRuns(next); setError('');}} catch(cause) {if(current) setError(cause instanceof Error ? cause.message : '无法读取章节导出');}}
    void load(); const timer = isBusy ? window.setInterval(() => void load(), 1500) : undefined;
    return () => {current=false; if(timer) window.clearInterval(timer);};
  },[job.id,job.updatedAt,isBusy]);
  if (!runs.length && !error) return null;
  return <section className="chapter-export-results" aria-label="章节导出结果"><h3>章节导出</h3>{error && <p className="error-message">{error}</p>}{runs.slice(0,10).map((run,index) => {
    const plan = [job.chapterPlan,job.customChapterPlan].find((item) => item?.id===run.planId);
    const canResume = run.state!=='complete' && run.input && run.input.revision===job.revision && plan?.state==='current' && plan.revision===run.planRevision;
    return <details key={run.id} open={index===0}><summary>{RUN_STATES[run.state]} · {run.clips.filter((clip) => clip.state==='complete').length}/{run.clips.length}</summary><div className="chapter-export-results__clips">{run.clips.map((clip) => <p key={clip.chapterId} title={clip.path}><strong>{clip.title}</strong> · {CLIP_STATES[clip.state]}{clip.code ? ` (${clip.code})` : ''}{clip.path && <small>{clip.path}</small>}</p>)}</div>{canResume && <button className="button" disabled={isBusy} onClick={() => {if(run.input) void onResume({...run.input,runId:run.id}).catch((cause:unknown) => setError(cause instanceof Error ? cause.message : '继续导出失败'));}}>继续未完成章节</button>}</details>;
  })}</section>;
}
