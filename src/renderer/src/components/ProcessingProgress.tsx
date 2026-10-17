import { useEffect, useState, type ReactNode } from 'react';
import type { AiWorkProgress, Job } from '../../../shared/contracts';
import type { ProviderLiveSnapshot } from '../../../shared/provider-diagnostics-contracts';
import { LIVE_PHASE_LABELS } from './ProviderLiveDialog';
import { repairRunSummary } from './RepairLoopControls';
import '../styles/processing-progress.css';

const OPERATION_LABELS: Record<string, string> = { review: 'AI 检查字幕', names: 'AI 检查人名 · 全片分析', translate: '字幕翻译', style: 'AI 样式生成', chapters: '全文章节切分', repair: '字幕自动修复' };
const PHASE_LABELS: Record<string, string> = { planning: '准备全文章节', chapters: '准备全文章节', analysis: '批量检查待复查字幕', review: '批量检查字幕', check: '批量检查字幕', checking: '批量检查字幕', recognize: '重新语音识别', translate: '按章批量翻译字幕', translation: '批量翻译字幕', adjudication: '综合审核新旧字幕', adjudicate: '综合审核新旧字幕', audit: '综合审核新旧字幕', commit: '保存审核结果', publication: '保存审核结果', reassessment: '复查本轮结果', final_consistency: '结束前一致性补查（仅检查）', consistency: '结束前一致性补查（仅检查）', style: '按章生成样式', names: '全片人名分析', correction: '纠正模型返回内容', done: '处理结束' };
const REQUEST_STATES = { queued: '排队中', running: '处理中', completed: '已完成', failed: '失败', cancelled: '已取消' };

function seconds(milliseconds: number): string { return `${Math.max(0, Math.floor(milliseconds / 1000))} 秒`; }
function isActive(item: ProviderLiveSnapshot): boolean { return ['waiting', 'thinking', 'answer'].includes(item.phase); }

type Props = { job: Job; label: string; message?: string; work?: AiWorkProgress; items: ProviderLiveSnapshot[]; isRunning: boolean; onView: () => void; onCancel: () => void };

/** Operation state stays visible independently of volatile provider stream activity. */
export function ProcessingProgress({ job, label, message, work, items, isRunning, onView, onCancel }: Props): ReactNode {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);
  const repair = job.repairRun?.state === 'running' ? job.repairRun : undefined;
  const currentItems = items.filter((item) => item.jobId === job.id && (!work || item.runId === work.runId));
  const requests = work?.requests ?? [];
  const activeCount = work ? requests.filter((request) => request.state === 'running').length : currentItems.filter(isActive).length;
  const queuedCount = requests.filter((request) => request.state === 'queued').length;
  const phase = repair?.phase ?? work?.phase;
  const round = repair?.round ?? work?.round;
  const cap = repair?.maxRounds ?? work?.maxRounds;
  const title = repair ? '字幕自动修复' : work ? OPERATION_LABELS[work.operation] ?? label : label || '正在处理';
  const startedAt = repair?.startedAt ?? work?.startedAt;
  const isNames = work?.operation === 'names' || label === 'AI 检查人名';
  const streamSummary = (['waiting', 'thinking', 'answer'] as const).map((state) => ({ state, count: currentItems.filter((item) => item.phase === state).length })).filter((item) => item.count > 0).map((item) => `${LIVE_PHASE_LABELS[item.state]} ${item.count}`).join(' · ');
  const showRequests = requests.length > 0 || currentItems.length > 0;
  return <section className="processing-progress" aria-label="当前处理进度">
    <div className="processing-strip">
      <div className="processing-progress__summary" role="status">
        <strong>{title}{round !== undefined && cap !== undefined ? ` · 第 ${round} / ${cap} 轮` : ''}</strong>
        <span>{phase ? PHASE_LABELS[phase] ?? phase : message || '准备处理…'}{startedAt !== undefined && <> · 已用 {seconds(now - startedAt)}</>}</span>
        {repair && <span className="processing-progress__saved">已保存 {repair.committedRounds} 轮</span>}
        {work && <span>{!isNames && <>章节 {work.chaptersCompleted} / {work.chaptersTotal} · </>}字幕 {work.targetsCompleted} / {work.targetsTotal} · 处理中 {activeCount} · 排队 {queuedCount}</span>}
        {streamSummary && <span>{streamSummary}</span>}
        {message && phase && <span className="processing-progress__message">{message}</span>}
        {repair && !work && <span>{repairRunSummary(repair)}</span>}
      </div>
      <div className="processing-progress__actions"><button className="text-button stream-info-trigger" aria-haspopup="dialog" onClick={onView}>查看流式信息</button>{isRunning && <button className="text-button" onClick={onCancel}>取消当前处理</button>}</div>
    </div>
    {showRequests && <div className="processing-progress__requests" role="list" aria-label="并发请求进度" tabIndex={0}>
      {requests.map((request) => {
        const stream = currentItems.find((item) => request.chapterId ? item.chapterId === request.chapterId && isActive(item) : isActive(item)) ?? currentItems.find((item) => request.chapterId ? item.chapterId === request.chapterId : true);
        const elapsed = request.startedAt === undefined ? '' : ` · ${seconds((request.endedAt ?? now) - request.startedAt)}`;
        return <div key={request.id} role="listitem" className={`processing-progress__request processing-progress__request--${request.state}`}>
          <strong>{request.label}</strong><span>{REQUEST_STATES[request.state]} · {request.targetCount} 条字幕{elapsed}{request.code ? ` · ${request.code}` : ''}</span>
          {stream && request.state === 'running' && <span>{LIVE_PHASE_LABELS[stream.phase]} · 已接收 {stream.wireBytes.toLocaleString()} 字节</span>}
        </div>;
      })}
      {!work && currentItems.map((item) => <div key={item.requestId} role="listitem" className="processing-progress__request"><strong>{isNames ? '全片人名分析' : OPERATION_LABELS[item.operation]}{item.chapterId ? ` · ${item.chapterId}` : ''}</strong><span>{LIVE_PHASE_LABELS[item.phase]} · {seconds(item.elapsedMs)} · 已接收 {item.wireBytes.toLocaleString()} 字节</span></div>)}
    </div>}
  </section>;
}
