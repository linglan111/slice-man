// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/src/App';
import { profileInputSchema } from '../../../src/shared/contracts';
import { savedJob, stubApi } from './app-fixtures';
import { liveSnapshot } from './provider-live-fixtures';

beforeEach(() => { localStorage.clear(); HTMLDialogElement.prototype.showModal = function (): void { this.open = true; }; HTMLDialogElement.prototype.close = function (): void { this.open = false; }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const profile = { ...profileInputSchema.parse({ name: 'Explicit review', protocol: 'openai', baseUrl: 'https://example.test/v1', model: 'text' }), id: 'chosen', hasKey: true };

describe('AI stream and review scope navigation', () => {
  it('shows received activity before any answer and opens/closes stream details without cancelling work', async () => {
    const job = savedJob(); job.options.reviewProfileId = profile.id;
    const { api } = stubApi(job); vi.mocked(api.profiles.list).mockResolvedValue({ success: true, data: [profile] });
    let finish: (() => void) | undefined;
    vi.mocked(api.jobs.reviewSubtitles).mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ success: true, data: job }); }));
    await act(async () => { render(<App />); });
    vi.mocked(api.diagnostics.live).mockImplementation(async () => ({ success: true, data: [liveSnapshot({ jobId: job.id, startedAt: Date.now() })] }));
    fireEvent.click(screen.getByRole('button', { name: 'AI 检查字幕' }));
    expect(api.jobs.reviewSubtitles).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '检查范围' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'AI 检查范围' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '开始检查' }));
    await screen.findByText('模型思考中 · 60 秒 · 已接收 8,123 字节');
    fireEvent.click(screen.getByRole('button', { name: '查看流式信息' }));
    expect(screen.getByRole('dialog', { name: 'AI 流式信息' })).toBeTruthy();
    expect(screen.getByLabelText('模型思考内容').textContent).toContain('合成思考');
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));
    expect(api.jobs.cancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '查看流式信息' })).toBeTruthy();
    vi.mocked(api.diagnostics.live).mockResolvedValue({ success: true, data: [liveSnapshot({ jobId: job.id, phase: 'complete', state: 'published', answerText: '{}' })] });
    await act(async () => finish?.());
    await waitFor(() => expect(screen.queryByRole('button', { name: '取消当前处理' })).toBeNull());
    expect(screen.queryByRole('button', { name: '流式信息' })).toBeNull();
    expect(screen.getAllByRole('button', { name: '查看流式信息' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '查看流式信息' }));
    await screen.findByText('输出已完成');
    expect(screen.getByLabelText('流式回答内容').textContent).toBe('{}');
  });

  it('retains explicit range through missing-service selection and sends the newly saved revision', async () => {
    const job = savedJob(); job.options.reviewProfileId = undefined;
    const { api } = stubApi(job); vi.mocked(api.profiles.list).mockResolvedValue({ success: true, data: [profile] });
    const saved = { ...job, revision: 8, updatedAt: 8, options: { ...job.options, reviewProfileId: profile.id } };
    vi.mocked(api.jobs.updateOptions).mockResolvedValue({ success: true, data: saved });
    vi.mocked(api.jobs.reviewSubtitles).mockResolvedValue({ success: true, data: saved });
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: 'AI 检查字幕' }));
    fireEvent.click(screen.getByRole('radio', { name: '指定时间范围' }));
    fireEvent.change(screen.getByLabelText('检查开始时间（秒）'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('检查结束时间（秒）'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '开始检查' }));
    expect(api.jobs.reviewSubtitles).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('AI 检查服务'), { target: { value: profile.id } });
    fireEvent.click(screen.getByRole('button', { name: '保存并检查' }));
    await waitFor(() => expect(api.jobs.reviewSubtitles).toHaveBeenCalledExactlyOnceWith({ jobId: job.id, revision: 8, range: { startMs: 1000, endMs: 2000 } }));
  });
});
