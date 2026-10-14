// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/src/App';
import { profileInputSchema } from '../../../src/shared/contracts';
import { savedJob, stubApi } from './app-fixtures';

beforeEach(() => { localStorage.clear(); HTMLDialogElement.prototype.showModal = function (): void { this.open = true; }; HTMLDialogElement.prototype.close = function (): void { this.open = false; }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const profile = { ...profileInputSchema.parse({ name: 'Explicit review', protocol: 'openai', baseUrl: 'https://example.test/v1', model: 'text' }), id: 'chosen', hasKey: true };

describe('visible operation navigation', () => {
  it('opens generation/style/export/names without starting work and places settings in the lower left', async () => {
    const { api } = stubApi(savedJob()); await act(async () => { render(<App />); });
    for (const name of ['生成', '样式', '导出作品', '人名检查']) fireEvent.click(screen.getByRole('button', { name }));
    expect(api.jobs.recognize).not.toHaveBeenCalled(); expect(api.jobs.translate).not.toHaveBeenCalled();
    expect(api.jobs.export).not.toHaveBeenCalled(); expect(api.jobs.designStyle).not.toHaveBeenCalled(); expect(api.jobs.analyzeNames).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '生成设置' }).closest('.sidebar__footer')).toBeTruthy();
    expect(screen.getByRole('button', { name: '样式设置' }).closest('.sidebar__footer')).toBeTruthy();
  });

  it.each(['failed', 'cancelled', 'interrupted'] as const)('uses explicit full translation rather than an inert generic retry for existing cues after %s', async (state) => {
    const job = savedJob();
    job.stages.translate = { state, progress: 0, message: 'Translation did not finish' };
    const { api } = stubApi(job);
    vi.mocked(api.jobs.translate).mockResolvedValue({ success: true, data: { ...job, revision: 8, updatedAt: 8, stages: { ...job.stages, translate: { state: 'succeeded', progress: 1, message: '' } } } });
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    expect(screen.getByRole('region', { name: '生成操作面板' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重试未完成阶段' })).toBeNull();
    expect((screen.getByRole('button', { name: '重新识别原片' }) as HTMLButtonElement).disabled).toBe(false);
    const translate = screen.getByRole('button', { name: '翻译全部字幕' });
    expect((translate as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(translate);
    await waitFor(() => expect(api.jobs.translate).toHaveBeenCalledExactlyOnceWith({ jobId: job.id }));
    await screen.findByText('字幕已生成，可校对文字和时间，再选择样式。');
    expect(screen.getByText('Corrected original.')).toBeTruthy();
    expect(api.jobs.recognize).not.toHaveBeenCalled();
    expect(api.jobs.recognizeAgain).not.toHaveBeenCalled();
  });

  it('keeps generic retry functional for a failed recognition with an empty source-only timeline', async () => {
    const job = savedJob();
    job.options.translationEnabled = false;
    job.options.translationProfileId = undefined;
    const empty = { ...job, segments: [], stages: { ...job.stages, recognize: { state: 'failed' as const, progress: 0, message: 'Recognition did not finish' }, translate: { state: 'idle' as const, progress: 0, message: '' } } };
    const { api } = stubApi(empty);
    vi.mocked(api.jobs.recognize).mockResolvedValue({ success: true, data: { ...job, revision: 8, updatedAt: 8 } });
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    fireEvent.click(screen.getByRole('button', { name: '重试未完成阶段' }));
    await screen.findByText('Corrected original.');
    expect(api.jobs.recognize).toHaveBeenCalledExactlyOnceWith(job.id);
    expect(api.jobs.recognizeAgain).not.toHaveBeenCalled();
    expect(api.jobs.translate).not.toHaveBeenCalled();
  });

  it.each([undefined, 'deleted'])('chooses an explicit review service for missing/dangling %s and uses the saved revision', async (reviewProfileId) => {
    const job = savedJob(); job.options.reviewProfileId = reviewProfileId;
    const { api } = stubApi(job); vi.mocked(api.profiles.list).mockResolvedValue({ success: true, data: [profile] });
    const saved = { ...job, revision: 8, updatedAt: 8, options: { ...job.options, reviewProfileId: profile.id } };
    vi.mocked(api.jobs.updateOptions).mockResolvedValue({ success: true, data: saved });
    vi.mocked(api.jobs.reviewSubtitles).mockResolvedValue({ success: true, data: saved });
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: 'AI 检查字幕' }));
    expect(api.jobs.reviewSubtitles).not.toHaveBeenCalled();
    expect((screen.getByLabelText('AI 检查服务') as HTMLSelectElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('AI 检查服务'), { target: { value: profile.id } });
    fireEvent.click(screen.getByRole('button', { name: '保存并检查' }));
    await waitFor(() => expect(api.jobs.reviewSubtitles).toHaveBeenCalledExactlyOnceWith({ jobId: job.id, revision: 8 }));
  });

  it('shows matched name analysis progress, exposes cancel and clears it after switching projects', async () => {
    const job = savedJob(); job.options.reviewProfileId = profile.id;
    const other = { ...savedJob(), id: 'other', name: 'Other project' };
    const { api } = stubApi(job); vi.mocked(api.jobs.list).mockResolvedValue({ success: true, data: [job, other] });
    vi.mocked(api.profiles.list).mockResolvedValue({ success: true, data: [profile] });
    let finish: (() => void) | undefined;
    vi.mocked(api.jobs.analyzeNames).mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ success: false, code: 'CANCELLED', error: '检查已取消，保留上次结果' }); }));
    vi.mocked(api.jobs.cancel).mockResolvedValue({ success: true, data: undefined });
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: '人名检查' })); fireEvent.click(screen.getByRole('button', { name: 'AI 检查人名' }));
    const handler = vi.mocked(api.onProgress).mock.calls[0]?.[0]; if (!handler) throw new Error('Progress handler absent');
    await act(async () => handler({ stage: 'names', jobId: job.id, message: '正在核验真实人名次数', progress: .6 }));
    expect(screen.getByText(/正在核验真实人名次数/)).toBeTruthy();
    await act(async () => handler({ stage: 'names', jobId: other.id, message: 'Foreign progress', progress: .7 }));
    expect(screen.queryByText(/Foreign progress/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '取消人名检查' })); expect(api.jobs.cancel).toHaveBeenCalledExactlyOnceWith(job.id);
    await act(async () => finish?.()); await screen.findByText(/检查已取消，保留上次结果/);
    fireEvent.click(screen.getByRole('button', { name: 'Other project' }));
    expect(screen.queryByText(/正在核验真实人名次数/)).toBeNull();
    await act(async () => handler({ stage: 'names', jobId: job.id, message: 'Late old progress', progress: .8 }));
    expect(screen.queryByText(/Late old progress/)).toBeNull();
  });
  it('clears transient chapter waiting progress when the actual operation has finished', async () => {
    const job = savedJob(); job.options.chapterProfileId = profile.id;
    const { api } = stubApi(job); vi.mocked(api.profiles.list).mockResolvedValue({ success: true, data: [profile] });
    let finish: (() => void) | undefined;
    vi.mocked(api.jobs.planChapters).mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ success: true, data: job }); }));
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: '章节' }));
    fireEvent.click(screen.getByRole('button', { name: 'AI 切分章节' }));
    const handler = vi.mocked(api.onProgress).mock.calls[0]?.[0]; if (!handler) throw new Error('Progress handler absent');
    await act(async () => handler({ stage: 'chapters', jobId: job.id, message: '等待 AI 响应 · 0 秒 · 198 字节', progress: 0 }));
    expect(screen.getByText('等待 AI 响应 · 0 秒 · 198 字节')).toBeTruthy();
    await act(async () => finish?.());
    await waitFor(() => expect(screen.queryByText('等待 AI 响应 · 0 秒 · 198 字节')).toBeNull());
  });
});
