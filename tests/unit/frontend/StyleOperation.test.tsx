// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StyleOperation } from '../../../src/renderer/src/components/StyleOperation';
import { savedJob } from './app-fixtures';

afterEach(cleanup);
describe('style design operation', () => {
  it('opens settings independently and requires an explicit nonblank design with a configured service', async () => {
    const job = savedJob(); job.options.styleProfileId = 'style';
    const onSettings = vi.fn(); const onClose = vi.fn(); const onDesign = vi.fn().mockResolvedValue(undefined);
    render(<StyleOperation job={job} isBusy={false} onSettings={onSettings} onClose={onClose} onDesign={onDesign} />);
    expect(onDesign).not.toHaveBeenCalled();
    const action = screen.getByRole('button', { name: '生成 AI 样式' }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '打开样式设置' }));
    expect(onSettings).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('AI 设计描述'), { target: { value: '  白色字幕，淡黄色强调  ' } });
    expect(action.disabled).toBe(false);
    fireEvent.click(action);
    expect(onDesign).toHaveBeenCalledExactlyOnceWith('白色字幕，淡黄色强调');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps settings accessible without a service and blocks missing service and busy generation', () => {
    const job = savedJob(); job.options.styleProfileId = undefined;
    const props = { job, isBusy: false, onSettings: vi.fn(), onClose: vi.fn(), onDesign: vi.fn() };
    const { rerender } = render(<StyleOperation {...props} />);
    fireEvent.change(screen.getByLabelText('AI 设计描述'), { target: { value: '清晰字幕' } });
    expect((screen.getByRole('button', { name: '生成 AI 样式' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/请在生成设置中选择 AI 样式服务/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打开样式设置' }));
    expect(props.onSettings).toHaveBeenCalledOnce();
    job.options.styleProfileId = 'style'; rerender(<StyleOperation {...props} isBusy />);
    expect((screen.getByLabelText('AI 设计描述') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '生成 AI 样式' }) as HTMLButtonElement).disabled).toBe(true);
    expect(props.onDesign).not.toHaveBeenCalled();
  });

  it('retains the design draft and shows a generation error for retry', async () => {
    const job = savedJob(); job.options.styleProfileId = 'style';
    const onDesign = vi.fn().mockRejectedValue(new Error('生成失败，请重试'));
    render(<StyleOperation job={job} isBusy={false} onSettings={vi.fn()} onClose={vi.fn()} onDesign={onDesign} />);
    fireEvent.change(screen.getByLabelText('AI 设计描述'), { target: { value: '电影感' } });
    fireEvent.click(screen.getByRole('button', { name: '生成 AI 样式' }));
    expect((await screen.findByRole('alert')).textContent).toBe('生成失败，请重试');
    expect((screen.getByLabelText('AI 设计描述') as HTMLTextAreaElement).value).toBe('电影感');
  });
});
