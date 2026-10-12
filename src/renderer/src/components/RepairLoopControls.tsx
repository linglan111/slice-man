import { useState, type ReactNode } from 'react';
import { REVIEW_RISK_LABELS, repairLoopInputSchema, type Job, type RepairLoopInput, type RepairRun } from '../../../shared/contracts';
import { formatTime, validateCueTimes } from '../lib/presentation';
import '../styles/repair-loop.css';

type Props = { job: Job; isBusy: boolean; onStart: (input: RepairLoopInput) => void; onCancel: () => void };
const PHASE_LABELS: Record<RepairRun['phase'], string> = { analysis: '分析可疑字幕', recognize: '重新识别', translate: '重新翻译', commit: '保存本轮', reassessment: '复查本轮结果', done: '已停止' };
export function repairRunSummary(run: RepairRun): string {
  const scope = run.scope.mode === 'range' ? '指定范围' : '全部字幕';
  const count = run.remainingCount === undefined ? '复查未完成，剩余疑点未知' : `${scope}剩余 ${run.remainingCount} 条${REVIEW_RISK_LABELS[run.threshold]}及以上未忽略疑点`;
  if (run.state === 'running') return `${run.round === 0 ? '修复前分析' : `第 ${run.round} / ${run.maxRounds} 轮`} · ${PHASE_LABELS[run.phase]} · 已保存 ${run.committedRounds} 轮`;
  const reason = { no_eligible: '没有达到所选等级的未忽略疑点', max_rounds: '达到最大轮数', user_cancelled: '已取消', error: '修复失败', interrupted: '上次运行已中断' };
  return `${run.reason ? reason[run.reason] : '已停止'} · 已保存 ${run.committedRounds} 轮 · ${count}`;
}

export function RepairLoopControls({ job, isBusy, onStart, onCancel }: Props): ReactNode {
  const run = job.repairRun;
  const [mode, setMode] = useState<'all' | 'range'>(run?.scope.mode ?? 'all');
  const [threshold, setThreshold] = useState<RepairLoopInput['threshold']>(run?.threshold ?? 'medium');
  const [maxRounds, setMaxRounds] = useState(String(run?.maxRounds ?? 3));
  const [start, setStart] = useState(((run?.scope.mode === 'range' ? run.scope.startMs : 0) / 1000).toFixed(3));
  const [end, setEnd] = useState(((run?.scope.mode === 'range' ? run.scope.endMs : job.media.durationMs) / 1000).toFixed(3));
  const times = validateCueTimes(start, end, job.media.durationMs);
  const parsed = repairLoopInputSchema.safeParse({ jobId: job.id, revision: job.revision, threshold, maxRounds: Number(maxRounds), scope: mode === 'all' ? { mode } : typeof times === 'string' ? { mode } : { mode, ...times } });
  const validation = mode === 'range' && typeof times === 'string' ? times : !maxRounds.trim() || !parsed.success ? '最大轮数须为 1–20 的整数。' : '';
  const running = run?.state === 'running';
  return <section className="repair-loop" aria-label="自动循环修复">
    <div className="repair-loop__fields">
      <label>修复范围<select aria-label="自动修复范围" disabled={isBusy} value={mode} onChange={(event) => setMode(event.target.value === 'range' ? 'range' : 'all')}><option value="all">全部字幕</option><option value="range">指定时间范围</option></select></label>
      <label>最低可疑度<select aria-label="自动修复最低可疑度" disabled={isBusy} value={threshold} onChange={(event) => setThreshold(repairLoopInputSchema.shape.threshold.parse(event.target.value))}><option value="low">低及以上</option><option value="medium">中及以上</option><option value="high">高</option></select></label>
      <label>最大轮数<input aria-label="自动修复最大轮数" type="number" min={1} max={20} step={1} disabled={isBusy} value={maxRounds} onChange={(event) => setMaxRounds(event.target.value)} /></label>
    </div>
    {mode === 'range' && <div className="repair-loop__range"><label>开始（秒）<input aria-label="自动修复开始（秒）" inputMode="decimal" disabled={isBusy} value={start} onChange={(event) => setStart(event.target.value)} /></label><label>结束（秒）<input aria-label="自动修复结束（秒）" inputMode="decimal" disabled={isBusy} value={end} onChange={(event) => setEnd(event.target.value)} /></label></div>}
    <div className="repair-loop__actions"><span className="hint">按问题类型修复，每轮复查</span>{running ? <button className="button" onClick={onCancel}>取消自动修复</button> : <button className="button" disabled={isBusy || !job.options.reviewProfileId || !parsed.success || Boolean(validation)} onClick={() => { if (parsed.success && !validation) onStart(parsed.data); }}>自动循环修复</button>}</div>
    {validation && <p className="error-message" role="alert">{validation}</p>}
    {!job.options.reviewProfileId && <p className="hint">请在生成设置中选择 AI 检查服务。</p>}
    {mode === 'range' && <p className="repair-loop__boundary hint">识别会扩展至完整字幕及重叠区间；忽略提示不锁定字幕。</p>}
    {run && <div className="repair-loop__status" role="status"><strong>{repairRunSummary(run)}</strong><p>请求范围：{run.scope.mode === 'range' ? `${formatTime(run.scope.startMs)} → ${formatTime(run.scope.endMs)}` : '全部字幕'}{run.effectiveIntervals.length > 0 && <>；本轮实际范围：{run.effectiveIntervals.map((interval) => `${formatTime(interval.startMs)} → ${formatTime(interval.endMs)}`).join('；')}</>}</p>{run.errorMessage && <p>{run.errorMessage}</p>}<small>AI 文本分析不保证音频识别正确；已保存轮次保留。</small></div>}
  </section>;
}
