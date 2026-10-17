// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessingProgress } from '../../../src/renderer/src/components/ProcessingProgress';
import type { AiWorkProgress } from '../../../src/shared/contracts';
import { savedJob } from './app-fixtures';
import { liveSnapshot } from './provider-live-fixtures';

afterEach(cleanup);
const work: AiWorkProgress = { runId: 'repair-run', operation: 'repair', phase: 'reassessment', startedAt: Date.now(), round: 2, maxRounds: 3, targetsCompleted: 2, targetsTotal: 8, chaptersCompleted: 1, chaptersTotal: 4, requests: [
  { id: 'a', chapterId: 'one', label: '第 1 章 · 开场', state: 'running', targetCount: 2, startedAt: Date.now() },
  { id: 'b', chapterId: 'two', label: '第 2 章 · 会面', state: 'running', targetCount: 2, startedAt: Date.now() },
  { id: 'c', chapterId: 'three', label: '第 3 章 · 对话', state: 'queued', targetCount: 2 },
  { id: 'd', chapterId: 'four', label: '第 4 章 · 结尾', state: 'completed', targetCount: 2, startedAt: Date.now(), endedAt: Date.now() },
] };

describe('structured concurrent processing progress', () => {
  it('keeps phase, round, counts and every concurrent chapter visible during streaming', () => {
    const job = savedJob();
    const onView = vi.fn(); const onCancel = vi.fn();
    render(<ProcessingProgress job={job} label="自动循环修复" work={work} items={[liveSnapshot({ jobId: job.id, runId: work.runId, chapterId: 'one' }), liveSnapshot({ requestId: 'second', jobId: job.id, runId: work.runId, chapterId: 'two', phase: 'answer' })]} isRunning onView={onView} onCancel={onCancel} />);
    expect(screen.getByRole('status').textContent).toContain('第 2 / 3 轮');
    expect(screen.getByRole('status').textContent).toContain('复查本轮结果');
    expect(screen.getByRole('status').textContent).toContain('章节 1 / 4 · 字幕 2 / 8 · 处理中 2 · 排队 1');
    const rows = within(screen.getByRole('list', { name: '并发请求进度' })).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain('模型思考中');
    expect(rows[1]?.textContent).toContain('正在输出结果');
    expect(rows[2]?.textContent).toContain('排队中');
    expect(rows[3]?.textContent).toContain('已完成');
    fireEvent.click(screen.getByRole('button', { name: '查看流式信息' })); expect(onView).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '取消当前处理' })); expect(onCancel).toHaveBeenCalledOnce();
  });
  it('shows final consistency as assessment-only while preserving the last round and excluding foreign streams', () => {
    const job = savedJob();
    render(<ProcessingProgress job={job} label="自动循环修复" work={{ ...work, phase: 'final_consistency', round: 3, targetsCompleted: 0, targetsTotal: 2 }} message="待复查 2 条字幕，1 章" items={[liveSnapshot({ jobId: job.id, runId: 'old-run', chapterId: 'one', wireBytes: 999999 })]} isRunning onView={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('第 3 / 3 轮');
    expect(screen.getByRole('status').textContent).toContain('结束前一致性补查（仅检查）');
    expect(screen.getByRole('status').textContent).toContain('待复查 2 条字幕，1 章');
    expect(screen.queryByText(/999,999/)).toBeNull();
    expect(screen.queryByText(/第 4 \/ 3 轮/)).toBeNull();
  });
  it('uses one whole-timeline name request without fictional chapter counts and keeps correction visible', () => {
    const job = savedJob();
    render(<ProcessingProgress job={job} label="AI 检查人名" message="正在纠正人名证据（最多一次）" work={{ ...work, operation: 'names', phase: 'correction', round: undefined, maxRounds: undefined, requests: [{ id: 'names', label: '全片人名分析 · 证据纠正', state: 'running', targetCount: 8 }] }} items={[]} isRunning onView={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('AI 检查人名 · 全片分析');
    expect(screen.getByRole('status').textContent).toContain('正在纠正人名证据');
    expect(screen.getByRole('status').textContent).not.toContain('章节');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
  it('does not hide terminal failed or cancelled chapter rows', () => {
    const job = savedJob();
    render(<ProcessingProgress job={job} label="字幕检查" work={{ ...work, requests: [{ ...work.requests[0], id: 'a', label: '第 1 章', state: 'failed', targetCount: 2, code: 'AI_FAILED' }, { id: 'b', label: '第 2 章', state: 'cancelled', targetCount: 2 }] }} items={[]} isRunning={false} onView={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getAllByRole('listitem')[0]?.textContent).toContain('失败');
    expect(screen.getAllByRole('listitem')[1]?.textContent).toContain('已取消');
    expect(screen.queryByRole('button', { name: '取消当前处理' })).toBeNull();
  });
});
