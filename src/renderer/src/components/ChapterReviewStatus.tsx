import type { ReactNode } from 'react';
import type { ChapterReviewRun } from '../../../shared/chapter-contracts';

const STATES: Record<ChapterReviewRun['state'], string> = {running:'正在检查', complete:'检查完成', failed:'检查未完成', cancelled:'检查已取消', interrupted:'上次检查中断', stale:'检查结果已过期'};
export function ChapterReviewStatus({run,isBusy,onResume}: {run: ChapterReviewRun; isBusy: boolean; onResume: (ids: string[])=>void}): ReactNode {
  const completed=run.chapters.filter((chapter)=>chapter.state==='completed');
  const completeIds=new Set(completed.flatMap((chapter)=>chapter.targetIds));
  const failedIds=new Set(run.chapters.filter((chapter)=>chapter.state==='failed').flatMap((chapter)=>chapter.targetIds));
  const pending=run.targetIds.filter((id)=>!completeIds.has(id)&&!failedIds.has(id)).length;
  const resumable=['failed','cancelled','interrupted'].includes(run.state);
  return <div className="stage-detail" aria-label="分章节检查覆盖"><strong>分章节检查 · {STATES[run.state]}</strong>
    {run.state==='stale' ? <p>旧记录已完成 {completeIds.size}/{run.targetIds.length} 条，{completed.length}/{run.chapters.length} 章；字幕、章节或检查服务已变化，请重新检查。</p> : <p>已完成 {completeIds.size}/{run.targetIds.length} 条 · {completed.length}/{run.chapters.length} 章；待检查 {pending} 条{failedIds.size ? `，失败 ${failedIds.size} 条` : ''}</p>}
    {resumable && <><p className="hint">已完成章节的有效结果已保留；继续时只处理兼容的剩余章节。</p><button className="button" disabled={isBusy} onClick={()=>onResume(run.targetIds)}>继续检查剩余章节</button></>}
  </div>;
}
