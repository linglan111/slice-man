// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/src/App';
import { savedJob, stubApi } from './app-fixtures';
import type { ProgressEvent, RepairRun } from '../../../src/shared/contracts';

beforeEach(() => { localStorage.clear(); HTMLDialogElement.prototype.showModal = function (): void { this.open = true; }; HTMLDialogElement.prototype.close = function (): void { this.open = false; }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const run: RepairRun = { id: 'current-run', scope: { mode: 'range', startMs: 200, endMs: 1500 }, threshold: 'medium', maxRounds: 3, state: 'running', phase: 'analysis', round: 0, committedRounds: 0, affectedCount: 0, effectiveIntervals: [], startedAt: 10 };
describe('App loop ownership presentation', () => {
  it('uses the dedicated main API and current range without chaining manual operations', async () => {
    const job = savedJob(); job.options.reviewProfileId = 'review'; const { api } = stubApi(job);
    vi.mocked(api.jobs.repairLoop).mockResolvedValue({ success: true, data: { ...job, updatedAt: 20, repairRun: { ...run, state: 'succeeded', phase: 'done', completedAt: 20, reason: 'no_eligible', remainingCount: 0 } } });
    await act(async () => { render(<App />); });
    fireEvent.change(screen.getByLabelText('自动修复范围'), { target: { value: 'range' } });
    fireEvent.change(screen.getByLabelText('自动修复开始（秒）'), { target: { value: '0.2' } });
    fireEvent.change(screen.getByLabelText('自动修复结束（秒）'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: '自动循环修复' }));
    await waitFor(() => expect(api.jobs.repairLoop).toHaveBeenCalledExactlyOnceWith({ jobId: job.id, revision: 7, scope: { mode: 'range', startMs: 200, endMs: 1500 }, threshold: 'medium', maxRounds: 3 }));
    await screen.findByText(/指定范围剩余 0 条/);
    expect(api.jobs.reviewSubtitles).not.toHaveBeenCalled(); expect(api.jobs.recognizePartial).not.toHaveBeenCalled(); expect(api.jobs.translatePartial).not.toHaveBeenCalled();
  });
  it('keeps edits locked across remount, cancels the owning job and ignores mismatched/stale run events', async () => {
    const job = savedJob(); job.options.reviewProfileId = 'review'; job.repairRun = run; job.updatedAt = 12;
    const { api } = stubApi(job); vi.mocked(api.jobs.cancel).mockResolvedValue({ success: true, data: undefined });
    await act(async () => { render(<App />); });
    expect((screen.getByLabelText('编辑字幕 1') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '取消自动修复' })); expect(api.jobs.cancel).toHaveBeenCalledExactlyOnceWith(job.id);
    const handler = vi.mocked(api.onProgress).mock.calls[0]?.[0]; if (!handler) throw new Error('Progress callback missing');
    const event: ProgressEvent = { stage: 'repair', jobId: job.id, repairRunId: 'wrong', progress: 0, message: '', job: { ...job, updatedAt: 100, repairRun: { ...run, phase: 'translate' } } };
    await act(async () => handler(event)); expect(screen.queryByText(/第 0 \/ 3 轮 · 重新翻译/)).toBeNull();
    const done = { ...job, updatedAt: 20, repairRun: { ...run, state: 'cancelled' as const, phase: 'done' as const, completedAt: 20, reason: 'user_cancelled' as const } };
    await act(async () => handler({ ...event, repairRunId: run.id, job: done }));
    expect((screen.getByLabelText('编辑字幕 1') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => handler({ ...event, repairRunId: run.id, job: { ...job, updatedAt: 21 } }));
    expect((screen.getByLabelText('编辑字幕 1') as HTMLButtonElement).disabled).toBe(false);
    await screen.findByText(/复查未完成，剩余疑点未知/);
  });
});
