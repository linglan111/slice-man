// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/src/App';
import { profileInputSchema } from '../../../src/shared/contracts';
import { providerDiagnosticSchema, type ProviderDiagnostic } from '../../../src/shared/provider-diagnostics-contracts';
import { savedJob, stubApi } from './app-fixtures';

beforeEach(() => { localStorage.clear(); HTMLDialogElement.prototype.showModal = function (): void { this.open = true; }; HTMLDialogElement.prototype.close = function (): void { this.open = false; }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const profile = { ...profileInputSchema.parse({ name: 'Explicit text', protocol: 'openai', baseUrl: 'https://example.test/v1', model: 'text' }), id: 'chosen', hasKey: true };
const invalid = { success: false as const, code: 'CHAPTER_INVALID', error: '返回格式不正确，原有结果保留' };
function history(operation: ProviderDiagnostic['operation']): ProviderDiagnostic {
  const id = '00000000-0000-4000-8000-000000000001';
  return providerDiagnosticSchema.parse({ id, runId: 'run', jobId: 'saved-job', operation, profileId: profile.id, model: 'fixture', protocol: 'openai', mode: 'chat', state: 'failed', attempt: 0, targetCount: 1, promptBytes: 10, streamRequested: true, timeoutMs: 120000, textTimeoutMs: 1800000, startedAt: 1000, endedAt: 2000, elapsedMs: 1000, wireBytes: 30, textBytes: 2, events: 3, heartbeats: 1, artifact: `${id}/answer.complete.txt`, errorCode: 'CHAPTER_INVALID', errorPhase: 'validation' });
}
function configure(): ReturnType<typeof stubApi> & { job: ReturnType<typeof savedJob> } {
  const job = savedJob(); job.options.reviewProfileId = profile.id; job.options.chapterProfileId = profile.id; job.options.styleProfileId = profile.id;
  const fixture = stubApi(job); vi.mocked(fixture.api.profiles.list).mockResolvedValue({ success: true, data: [profile] });
  return { ...fixture, job };
}

describe('explicit AI retry recovery', () => {
  it('does not offer an inert operation retry when startup fails without a project', async () => {
    const { api } = configure();
    vi.mocked(api.jobs.list).mockResolvedValue({ success: false, code: 'DATABASE_ERROR', error: '无法读取项目' });
    await act(async () => { render(<App />); });
    expect((await screen.findByRole('alert')).textContent).toContain('无法读取项目');
    expect(screen.queryByRole('button', { name: '重试本次操作' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重新设置并重试' })).toBeNull();
  });
  it('retries exactly the failed review range and does not interpret it as a full review', async () => {
    const { api, job } = configure();
    vi.mocked(api.jobs.reviewSubtitles).mockResolvedValueOnce(invalid).mockResolvedValueOnce({ success: true, data: job });
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: 'AI 检查字幕' }));
    expect(api.jobs.reviewSubtitles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: '指定时间范围' }));
    fireEvent.change(screen.getByLabelText('检查开始时间（秒）'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText('检查结束时间（秒）'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '开始检查' }));
    fireEvent.click(await screen.findByRole('button', { name: '重试本次操作' }));
    await screen.findByText('AI 检查完成，提示为可疑项，请试听确认。');
    expect(api.jobs.reviewSubtitles).toHaveBeenCalledTimes(2);
    for (const [input] of vi.mocked(api.jobs.reviewSubtitles).mock.calls) expect(input).toEqual({ jobId: job.id, revision: 7, range: { startMs: 500, endMs: 1000 } });
    expect(screen.queryByRole('button', { name: '重试本次操作' })).toBeNull();
    expect(api.jobs.recognize).not.toHaveBeenCalled();
  });

  it('defaults the single review dialog to selected cues before an explicit submit', async () => {
    const { api, job } = configure(); vi.mocked(api.jobs.reviewSubtitles).mockResolvedValue({ success: true, data: job });
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByLabelText('选择字幕 1'));
    fireEvent.click(screen.getByRole('button', { name: 'AI 检查字幕' }));
    expect((screen.getByRole('radio', { name: '已选字幕' }) as HTMLInputElement).checked).toBe(true);
    expect(api.jobs.reviewSubtitles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '开始检查' }));
    await waitFor(() => expect(api.jobs.reviewSubtitles).toHaveBeenCalledExactlyOnceWith({ jobId: job.id, revision: 7, segmentIds: ['old-cue'] }));
  });

  it('retries failed translation without re-recognizing source subtitles', async () => {
    const { api, job } = configure(); vi.mocked(api.jobs.translate).mockResolvedValueOnce(invalid).mockResolvedValueOnce({ success: true, data: job });
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    fireEvent.click(screen.getByRole('button', { name: '翻译全部字幕' }));
    fireEvent.click(await screen.findByRole('button', { name: '重试本次操作' }));
    await screen.findByText('字幕已生成，可校对文字和时间，再选择样式。');
    expect(api.jobs.translate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.jobs.translate).mock.calls[1]).toEqual(vi.mocked(api.jobs.translate).mock.calls[0]);
    expect(api.jobs.recognize).not.toHaveBeenCalled(); expect(api.jobs.recognizeAgain).not.toHaveBeenCalled();
  });

  it.each(['names', 'chapters', 'style'] as const)('provides explicit retry for %s with the original inputs', async (operation) => {
    const { api, job } = configure();
    const method = operation === 'names' ? api.jobs.analyzeNames : operation === 'chapters' ? api.jobs.planChapters : api.jobs.designStyle;
    vi.mocked(method).mockResolvedValueOnce(invalid).mockResolvedValueOnce({ success: true, data: job });
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: operation === 'names' ? '人名检查' : operation === 'chapters' ? '章节' : '样式' }));
    if (operation === 'style') fireEvent.change(screen.getByLabelText('AI 设计描述'), { target: { value: '原始样式要求' } });
    fireEvent.click(screen.getByRole('button', { name: operation === 'names' ? 'AI 检查人名' : operation === 'chapters' ? 'AI 切分章节' : '生成 AI 样式' }));
    const retry = await screen.findByRole('button', { name: '重试本次操作' });
    if (operation === 'style') fireEvent.change(screen.getByLabelText('AI 设计描述'), { target: { value: '新草稿暂不执行' } });
    fireEvent.click(retry);
    await waitFor(() => expect(method).toHaveBeenCalledTimes(2));
    expect(vi.mocked(method).mock.calls[1]).toEqual(vi.mocked(method).mock.calls[0]);
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试本次操作' })).toBeNull());
    expect(screen.queryByText(/返回格式不正确/)).toBeNull();
  });

  it('does not replay a failed review against a changed revision', async () => {
    const { api, job, progress } = configure(); vi.mocked(api.jobs.reviewSubtitles).mockResolvedValue(invalid);
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: 'AI 检查字幕' })); fireEvent.click(screen.getByRole('button', { name: '开始检查' }));
    await screen.findByRole('button', { name: '重试本次操作' });
    await act(async () => progress({ ...job, revision: 8, updatedAt: 8 }));
    expect(screen.queryByRole('button', { name: '重试本次操作' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新设置并重试' }));
    expect(screen.getByRole('dialog', { name: 'AI 检查范围' })).toBeTruthy();
    expect(api.jobs.reviewSubtitles).toHaveBeenCalledTimes(1);
  });

  it('requires confirming custom chapter settings again after its criterion changes', async () => {
    const { api } = configure();
    const criterion = { id: 'custom', revision: 1, name: '主题标准', instructions: '重点主题', createdAt: 1, updatedAt: 1 };
    vi.mocked(api.chapterCriteria.list).mockResolvedValue({ success: true, data: { items: [criterion], selectedId: criterion.id } });
    vi.mocked(api.chapterCriteria.save).mockResolvedValue({ success: true, data: { items: [{ ...criterion, revision: 2, instructions: '新的主题要求' }], selectedId: criterion.id } });
    vi.mocked(api.jobs.planChapters).mockResolvedValue(invalid);
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: '章节' }));
    await screen.findByRole('option', { name: profile.name });
    fireEvent.change(screen.getByLabelText('章节类型'), { target: { value: 'custom' } });
    await screen.findByRole('option', { name: criterion.name });
    fireEvent.click(screen.getByRole('button', { name: 'AI 切分章节' }));
    await screen.findByRole('button', { name: '重新设置并重试' });
    expect(screen.queryByRole('button', { name: '重试本次操作' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '管理切分标准' }));
    fireEvent.click(screen.getByRole('button', { name: `${criterion.name} · 已选择` }));
    fireEvent.change(screen.getByLabelText('切分要求'), { target: { value: '新的主题要求' } });
    fireEvent.click(screen.getByRole('button', { name: '保存标准' }));
    await waitFor(() => expect(api.chapterCriteria.save).toHaveBeenCalledExactlyOnceWith({ id: criterion.id, revision: 1, name: criterion.name, instructions: '新的主题要求' }));
    fireEvent.click(screen.getByRole('button', { name: '返回章节' }));
    fireEvent.click(screen.getByRole('button', { name: '重新设置并重试' }));
    expect(screen.getByRole('region', { name: '章节操作面板' })).toBeTruthy();
    expect(api.jobs.planChapters).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'AI 切分章节' }));
    await waitFor(() => expect(api.jobs.planChapters).toHaveBeenCalledTimes(2));
  });

  it.each(['review', 'names', 'chapters', 'translate', 'style'] as const)('opens the matching form for historical %s failure without making a provider call', async (operation) => {
    const { api } = configure(); const record = history(operation);
    vi.mocked(api.diagnostics.list).mockResolvedValue({ success: true, data: [record] });
    vi.mocked(api.diagnostics.detail).mockResolvedValue({ success: true, data: record });
    vi.mocked(api.diagnostics.readAnswer).mockResolvedValue({ success: true, data: { text: '{}', truncated: false } });
    await act(async () => { render(<App />); });
    fireEvent.click(screen.getByRole('button', { name: 'AI 请求日志' }));
    fireEvent.click(await screen.findByRole('button', { name: /· 失败/ }));
    fireEvent.click(await screen.findByRole('button', { name: '重新设置并重试' }));
    const name = operation === 'review' ? 'AI 检查范围' : operation === 'names' ? '人名检查操作面板' : operation === 'chapters' ? '章节操作面板' : operation === 'translate' ? '分段处理' : '样式操作面板';
    expect(screen.getByRole(operation === 'review' ? 'dialog' : 'region', { name })).toBeTruthy();
    expect(api.jobs.reviewSubtitles).not.toHaveBeenCalled(); expect(api.jobs.analyzeNames).not.toHaveBeenCalled(); expect(api.jobs.planChapters).not.toHaveBeenCalled(); expect(api.jobs.translate).not.toHaveBeenCalled(); expect(api.jobs.translatePartial).not.toHaveBeenCalled(); expect(api.jobs.designStyle).not.toHaveBeenCalled();
  });
});
