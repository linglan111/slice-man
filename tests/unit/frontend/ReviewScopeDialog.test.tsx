// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReviewScopeDialog } from '../../../src/renderer/src/components/ReviewScopeDialog';
import { savedJob } from './app-fixtures';

beforeAll(() => { HTMLDialogElement.prototype.showModal = function (): void { this.open = true; }; HTMLDialogElement.prototype.close = function (): void { this.open = false; }; });
afterEach(cleanup);
function input(): Parameters<typeof ReviewScopeDialog>[0] {
  const job = savedJob();
  const cue = job.segments[0]; if (!cue) throw new Error('Missing fixture cue');
  job.segments = [
    { ...cue, id: 'left', startMs: 0, endMs: 1000 },
    { ...cue, id: 'middle', startMs: 1000, endMs: 2000 },
    { ...cue, id: 'right', startMs: 2000, endMs: 3000 },
  ];
  return { job, selectedIds: [], isBusy: false, onClose: vi.fn(), onReview: vi.fn() };
}
function chooseRange(start: string, end: string): void {
  fireEvent.click(screen.getByRole('radio', { name: '指定时间范围' }));
  fireEvent.change(screen.getByLabelText('检查开始时间（秒）'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('检查结束时间（秒）'), { target: { value: end } });
}

describe('explicit subtitle review scope', () => {
  it('previews half-open overlap with millisecond rounding and submits the range rather than all cues', () => {
    const props = input(); render(<ReviewScopeDialog {...props} />);
    chooseRange('0.9996', '2.0004');
    expect(screen.getByRole('status').textContent).toContain('1 条');
    fireEvent.click(screen.getByRole('button', { name: '开始检查' }));
    expect(props.onReview).toHaveBeenCalledExactlyOnceWith({ range: { startMs: 1000, endMs: 2000 } });
  });
  it('defaults to explicit selected cues, and allows an intentional full review', () => {
    const props = { ...input(), selectedIds: ['middle', 'deleted'] }; render(<ReviewScopeDialog {...props} />);
    expect((screen.getByRole('radio', { name: '已选字幕' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '开始检查' }));
    expect(props.onReview).toHaveBeenLastCalledWith({ segmentIds: ['middle'] });
    fireEvent.click(screen.getByRole('radio', { name: '全部字幕' }));
    fireEvent.click(screen.getByRole('button', { name: '开始检查' }));
    expect(props.onReview).toHaveBeenLastCalledWith({});
  });
  it.each([
    ['', '2', '请填写起止时间'], ['2', '1', '结束时间必须大于开始时间'],
    ['0', '5', '结束时间不能超过视频时长'], ['3', '4', '此范围内没有字幕'],
  ])('prevents invalid or empty range %s..%s from silently checking all', (start, end, message) => {
    const props = input(); const { container } = render(<ReviewScopeDialog {...props} />);
    chooseRange(start, end);
    expect(screen.getByRole('alert').textContent).toContain(message);
    expect((screen.getByRole('button', { name: '开始检查' }) as HTMLButtonElement).disabled).toBe(true);
    const form = container.querySelector('form'); if (!form) throw new Error('Missing scope form');
    fireEvent.submit(form);
    expect(props.onReview).not.toHaveBeenCalled();
  });
  it('guards empty selections and direct submission while busy', () => {
    const props = input(); const { container, rerender } = render(<ReviewScopeDialog {...props} />);
    fireEvent.click(screen.getByRole('radio', { name: '已选字幕' }));
    expect(screen.getByRole('alert').textContent).toContain('请先在右侧字幕列表勾选字幕');
    fireEvent.click(screen.getByRole('radio', { name: '全部字幕' }));
    rerender(<ReviewScopeDialog {...props} isBusy />);
    const form = container.querySelector('form'); if (!form) throw new Error('Missing scope form');
    fireEvent.submit(form);
    expect(props.onReview).not.toHaveBeenCalled();
  });
});
