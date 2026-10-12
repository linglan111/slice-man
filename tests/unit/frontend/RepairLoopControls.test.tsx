// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { RepairLoopControls, repairRunSummary } from '../../../src/renderer/src/components/RepairLoopControls';
import { savedJob } from './app-fixtures';
import type { RepairLoopInput, RepairRun } from '../../../src/shared/contracts';

afterEach(cleanup);
const run: RepairRun = { id: 'run', scope: { mode: 'range', startMs: 500, endMs: 1000 }, threshold: 'medium', maxRounds: 3, state: 'succeeded', phase: 'done', round: 3, committedRounds: 3, affectedCount: 1, remainingCount: 2, effectiveIntervals: [{ startMs: 100, endMs: 1800 }], startedAt: 10, completedAt: 20, reason: 'max_rounds' };
function props(): { job: ReturnType<typeof savedJob>; isBusy: boolean; onStart: Mock<(input: RepairLoopInput) => void>; onCancel: Mock<() => void> } { const job = savedJob(); job.options.reviewProfileId = 'review'; return { job, isBusy: false, onStart: vi.fn<(input: RepairLoopInput) => void>(), onCancel: vi.fn<() => void>() }; }
describe('bounded repair controls', () => {
  it('defaults to inclusive medium/three/all independently of selected grade', () => {
    const input = props(); render(<RepairLoopControls {...input} />);
    fireEvent.click(screen.getByRole('button', { name: '自动循环修复' }));
    expect(input.onStart).toHaveBeenCalledExactlyOnceWith({ jobId: input.job.id, revision: 7, scope: { mode: 'all' }, threshold: 'medium', maxRounds: 3 });
  });
  it('converts decimal seconds and submits a fixed interval with the latest revision', () => {
    const input = props(); const { rerender } = render(<RepairLoopControls {...input} />);
    fireEvent.change(screen.getByLabelText('自动修复范围'), { target: { value: 'range' } });
    fireEvent.change(screen.getByLabelText('自动修复开始（秒）'), { target: { value: '0.501' } });
    fireEvent.change(screen.getByLabelText('自动修复结束（秒）'), { target: { value: '1.002' } });
    rerender(<RepairLoopControls {...input} job={{ ...input.job, revision: 8 }} />);
    fireEvent.click(screen.getByRole('button', { name: '自动循环修复' }));
    expect(input.onStart).toHaveBeenCalledExactlyOnceWith({ jobId: input.job.id, revision: 8, scope: { mode: 'range', startMs: 501, endMs: 1002 }, threshold: 'medium', maxRounds: 3 });
  });
  it.each(['', '0', '-1', '1.5', '21'])('rejects invalid round input %s', (value) => {
    const input = props(); render(<RepairLoopControls {...input} />);
    fireEvent.change(screen.getByLabelText('自动修复最大轮数'), { target: { value } });
    expect((screen.getByRole('button', { name: '自动循环修复' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('1–20'); expect(input.onStart).not.toHaveBeenCalled();
  });
  it('rejects reversed/out-of-media ranges, shows requested/effective scope and scope-only cap count', () => {
    const input = props(); input.job.repairRun = run; render(<RepairLoopControls {...input} />);
    expect(screen.getByRole('status').textContent).toContain('指定范围剩余 2 条中及以上');
    expect(screen.getByRole('status').textContent).toContain('00:00.500 → 00:01.000');
    expect(screen.getByRole('status').textContent).toContain('00:00.100 → 00:01.800');
    fireEvent.change(screen.getByLabelText('自动修复结束（秒）'), { target: { value: '0.1' } });
    expect(screen.getByRole('alert').textContent).toContain('结束时间必须大于');
    fireEvent.change(screen.getByLabelText('自动修复结束（秒）'), { target: { value: '5' } });
    expect(screen.getByRole('alert').textContent).toContain('超过视频时长');
  });
  it('keeps cancellation available for persisted running work and never calls unknown counts clear', () => {
    const input = props(); input.job.repairRun = { ...run, state: 'running', phase: 'reassessment', remainingCount: undefined }; input.isBusy = true;
    render(<RepairLoopControls {...input} />);
    fireEvent.click(screen.getByRole('button', { name: '取消自动修复' })); expect(input.onCancel).toHaveBeenCalledOnce();
    expect((screen.getByLabelText('自动修复最低可疑度') as HTMLSelectElement).disabled).toBe(true);
    expect(repairRunSummary({ ...run, state: 'cancelled', reason: 'user_cancelled', remainingCount: undefined })).toContain('复查未完成，剩余疑点未知');
  });
});
