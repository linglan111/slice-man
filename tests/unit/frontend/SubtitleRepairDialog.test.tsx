// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { SubtitleList } from '../../../src/renderer/src/components/SubtitleList';
import type { RepairRun } from '../../../src/shared/contracts';
import { savedJob } from './app-fixtures';

beforeEach(() => { HTMLDialogElement.prototype.showModal = function (): void { this.open = true; }; HTMLDialogElement.prototype.close = function (): void { this.open = false; }; });
afterEach(cleanup);
function props(): ComponentProps<typeof SubtitleList> {
  const job = savedJob(); job.options.reviewProfileId = 'review';
  return { job, selectedIds: [], activeIds: [], isBusy: false, isEditing: false, editor: null, onAdd: vi.fn(), onRemove: vi.fn(), onSelect: vi.fn(), onEdit: vi.fn(), onSeek: vi.fn(), onRetranslate: vi.fn(), onReview: vi.fn(), onRepairLoop: vi.fn(), onCancelRepair: vi.fn() };
}

describe('subtitle automatic repair dialog', () => {
  it('opens without executing, preserves drafts and validation on reopen, and submits the current revision', () => {
    const input = props(); const { rerender } = render(<SubtitleList {...input} />);
    const opener = screen.getByRole('button', { name: '字幕自动修复' });
    expect(opener.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect([...opener.parentElement?.querySelectorAll('button') ?? []].map((button) => button.textContent)).toEqual(['字幕自动修复', 'AI 检查字幕', '添加字幕']);
    expect(screen.queryByLabelText('自动修复范围')).toBeNull();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: '字幕自动修复' })).toBeTruthy();
    expect(input.onRepairLoop).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('自动修复范围'), { target: { value: 'range' } });
    fireEvent.change(screen.getByLabelText('自动修复最低可疑度'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('自动修复最大轮数'), { target: { value: '21' } });
    fireEvent.change(screen.getByLabelText('自动修复开始（秒）'), { target: { value: '0.2' } });
    fireEvent.change(screen.getByLabelText('自动修复结束（秒）'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(input.onCancelRepair).not.toHaveBeenCalled();
    fireEvent.click(opener);
    expect((screen.getByLabelText('自动修复最大轮数') as HTMLInputElement).value).toBe('21');
    expect(screen.getByRole('alert').textContent).toContain('1–20');
    expect((screen.getByRole('button', { name: '自动循环修复' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('自动修复最大轮数'), { target: { value: '4' } });
    rerender(<SubtitleList {...input} job={{ ...input.job, revision: 8 }} />);
    fireEvent.click(screen.getByRole('button', { name: '自动循环修复' }));
    expect(input.onRepairLoop).toHaveBeenCalledExactlyOnceWith({ jobId: input.job.id, revision: 8, scope: { mode: 'range', startMs: 200, endMs: 1500 }, threshold: 'high', maxRounds: 4 });
  });

  it('can reopen during repair and closes on Escape without cancelling ongoing work', () => {
    const input = props(); const run: RepairRun = { id: 'run', scope: { mode: 'all' }, threshold: 'medium', maxRounds: 3, state: 'running', phase: 'analysis', round: 0, committedRounds: 0, affectedCount: 0, effectiveIntervals: [], startedAt: 10 };
    render(<SubtitleList {...input} isBusy job={{ ...input.job, repairRun: run }} />);
    const opener = screen.getByRole('button', { name: '字幕自动修复' });
    expect((opener as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(opener);
    expect(screen.getByRole('status').textContent).toContain('修复前分析');
    expect((screen.getByLabelText('自动修复范围') as HTMLSelectElement).disabled).toBe(true);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(input.onCancelRepair).not.toHaveBeenCalled();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: '取消自动修复' }));
    expect(input.onCancelRepair).toHaveBeenCalledOnce();
    expect(input.onRepairLoop).not.toHaveBeenCalled();
  });

  it('uses mutually exclusive repair and standard dialogs', () => {
    render(<SubtitleList {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: '字幕自动修复' }));
    fireEvent.click(screen.getByRole('button', { name: '可疑度判断标准' }));
    expect(screen.queryByRole('dialog', { name: '字幕自动修复' })).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: '可疑度判断标准' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));
    fireEvent.click(screen.getByRole('button', { name: '字幕自动修复' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: '可疑度判断标准' })).toBeNull();
  });
});
