// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProviderLiveDialog } from '../../../src/renderer/src/components/ProviderLiveDialog';
import { liveSnapshot } from './provider-live-fixtures';

beforeAll(() => { HTMLDialogElement.prototype.showModal = function (): void { this.open = true; }; HTMLDialogElement.prototype.close = function (): void { this.open = false; }; });
afterEach(cleanup);


describe('live external provider details', () => {
  it('shows thinking immediately while answer bytes remain zero, then updates the separate answer and terminal state', () => {
    const onClose = vi.fn(); const snapshot = liveSnapshot();
    const { rerender } = render(<ProviderLiveDialog items={[snapshot]} error="" onClose={onClose} />);
    expect(screen.getByText('模型思考中')).toBeTruthy();
    expect(screen.getByLabelText('模型思考内容').textContent).toBe(snapshot.thinkingText);
    expect(screen.getByLabelText('流式回答内容').textContent).toContain('尚未开始输出回答');
    expect(screen.getAllByRole('button', { name: '关闭对话框' })).toHaveLength(1);
    rerender(<ProviderLiveDialog items={[{ ...snapshot, phase: 'answer', answerText: '{"result":', answerBytes: 10 }]} error="" onClose={onClose} />);
    expect(screen.getByText('正在输出结果')).toBeTruthy();
    expect(screen.getByLabelText('流式回答内容').textContent).toBe('{"result":');
    rerender(<ProviderLiveDialog items={[{ ...snapshot, state: 'published', phase: 'complete', answerText: '{"result":[]}', answerBytes: 13 }]} error="" onClose={onClose} />);
    expect(screen.getByText('输出已完成')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' })); expect(onClose).toHaveBeenCalledOnce();
  });
  it('retains the selected concurrent request across polling and renders provider text as text', () => {
    const first = liveSnapshot(); const other = liveSnapshot({ requestId: '00000000-0000-4000-8000-000000000002', thinkingText: '<script>unsafe</script>', model: 'second' });
    const { rerender, container } = render(<ProviderLiveDialog items={[first, other]} error="" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('查看流式请求'), { target: { value: other.requestId } });
    rerender(<ProviderLiveDialog items={[other, first]} error="" onClose={vi.fn()} />);
    expect((screen.getByLabelText('查看流式请求') as HTMLSelectElement).value).toBe(other.requestId);
    expect(screen.getByLabelText('模型思考内容').textContent).toBe('<script>unsafe</script>');
    expect(container.querySelector('script')).toBeNull();
  });
  it('explains bounded buffers, missing thinking, empty sessions and read errors without hiding close', () => {
    const { rerender } = render(<ProviderLiveDialog items={[liveSnapshot({ thinkingText: '', phase: 'failed', thinkingTruncated: true, answerTruncated: true })]} error="读取失败" onClose={vi.fn()} />);
    expect(screen.getByText('请求失败')).toBeTruthy();
    expect(screen.getByLabelText('模型思考内容').textContent).toContain('尚未返回可展示');
    expect(screen.getByText('仅显示最近一部分思考内容。')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('读取失败');
    rerender(<ProviderLiveDialog items={[]} error="" onClose={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('当前暂无流式请求');
    expect((screen.getByRole('button', { name: '关闭对话框' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
