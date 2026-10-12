// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/src/App';
import { savedJob, stubApi } from './app-fixtures';
import { REVIEW_RUBRIC_VERSION, REVIEW_RULES, type ReviewReport } from '../../../src/shared/contracts';

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (): void { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('optional translation and subtitle repair workspace', () => {
  it('passes the selected grade to scoped repair without triggering translation in original-language mode', async () => {
    const job = savedJob(); job.options.translationEnabled = false;
    job.segments.push({ id: 'clear-cue', startMs: 2000, endMs: 3000, sourceText: 'Clear neighbour.', translatedText: 'Stored neighbour translation', translationStale: false });
    job.reviewReport = { id: 'report', profileId: 'review', providerFingerprint: 'config', completedAt: 10, state: 'complete', reviewedSegmentIds: ['old-cue', 'clear-cue'], fingerprints: {}, findings: [], rubric: { version: REVIEW_RUBRIC_VERSION, rules: [...REVIEW_RULES] }, assessments: [{ segmentId: 'old-cue', riskLevel: 'high', status: 'current', contextGroupId: 'context', findingIds: [] }, { segmentId: 'clear-cue', riskLevel: 'none', status: 'current', contextGroupId: 'context', findingIds: [] }] };
    const { api } = stubApi(job);
    vi.mocked(api.jobs.planReprocess).mockResolvedValue({ success: true, data: { jobId: job.id, revision: 7, operation: 'recognize', intervals: [{ startMs: 100, endMs: 1800 }], segmentIds: ['old-cue'], affectedCount: 1 } });
    vi.mocked(api.jobs.recognizePartial).mockResolvedValue({ success: true, data: { ...job, revision: 8, updatedAt: 11 } });
    render(<App />);
    await screen.findByLabelText('可疑度：高');
    fireEvent.change(screen.getByLabelText('可疑度筛选'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: '选择当前等级' }));
    expect((screen.getByLabelText('选择字幕 1') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '重新识别选中' }));
    await within(screen.getByRole('region', { name: '分段处理' })).findByText('00:00.100 → 00:01.800');
    expect(screen.queryByLabelText('同时翻译')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '识别并替换片段' }));
    await waitFor(() => expect(api.jobs.recognizePartial).toHaveBeenCalledExactlyOnceWith({ jobId: job.id, revision: 7, target: { mode: 'selection', segmentIds: ['old-cue'] }, translate: false }));
    expect(api.jobs.translate).not.toHaveBeenCalled(); expect(api.jobs.translatePartial).not.toHaveBeenCalled();
  });
  it('generates original-only subtitles without a translation service or translation request', async () => {
    const previous = savedJob();
    previous.options.translationEnabled = false; previous.options.translationProfileId = undefined;
    const next = { ...previous, revision: 8, updatedAt: 8 };
    const initial = { ...previous, segments: [], stages: { ...previous.stages, recognize: { state: 'idle' as const, progress: 0, message: '' } } };
    const { api } = stubApi(initial);
    vi.mocked(api.jobs.recognize).mockResolvedValue({ success: true, data: next });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '生成' }));
    fireEvent.click(screen.getByRole('button', { name: '一键生成字幕' }));
    await screen.findByText('Corrected original.');
    expect(api.jobs.recognize).toHaveBeenCalledExactlyOnceWith(previous.id);
    expect(api.jobs.translate).not.toHaveBeenCalled();
    expect(screen.queryByText('人工校对译文。')).toBeNull();
    expect(screen.queryByLabelText('翻译服务')).toBeNull();
    expect(screen.queryByRole('button', { name: '重新翻译片段' })).toBeNull();
    fireEvent.click(screen.getByLabelText('编辑字幕 1'));
    expect(screen.queryByLabelText('译文')).toBeNull();
  });

  it('collects import mode before opening the picker and persists the sidebar preference separately', async () => {
    const { api } = stubApi(savedJob());
    vi.mocked(api.jobs.importVideo).mockResolvedValue({ success: true, data: null });
    render(<App />);
    await screen.findByText('Corrected original.');
    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }));
    expect(localStorage.getItem('slice-man.sidebar-collapsed')).toBe('true');
    expect(api.jobs.updateOptions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '导入视频' }));
    expect(api.jobs.importVideo).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: '导入视频' });
    const checkbox = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '选择视频并导入' }));
    await waitFor(() => expect(api.jobs.importVideo).toHaveBeenCalledExactlyOnceWith({ translationEnabled: false, targetLanguage: 'zh-CN' }));
    expect(screen.getByRole('dialog', { name: '导入视频' })).toBeTruthy();
    expect(api.jobs.recognize).not.toHaveBeenCalled();
  });

  it('shows the server-expanded range and submits atomic recognition with translation explicitly selected', async () => {
    const previous = savedJob(); const { api } = stubApi(previous);
    const user = userEvent.setup();
    vi.mocked(api.jobs.planReprocess).mockResolvedValue({ success: true, data: { jobId: previous.id, revision: 7, operation: 'recognize', intervals: [{ startMs: 100, endMs: 1800 }], segmentIds: ['old-cue'], affectedCount: 1 } });
    vi.mocked(api.jobs.recognizePartial).mockResolvedValue({ success: false, code: 'CANCELLED', error: 'Operation cancelled; existing content retained' });
    // Finish the initial project activation (including its selection-reset effect) before user interaction.
    await act(async () => { render(<App />); });
    await screen.findByText('Corrected original.');
    await user.click(screen.getByLabelText('选择字幕 1'));
    expect((screen.getByLabelText('选择字幕 1') as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: '重新识别片段' }));
    expect(screen.getByRole('button', { name: '勾选字幕（1）' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '起止时间' }).getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect(api.jobs.planReprocess).toHaveBeenCalledExactlyOnceWith({ jobId: previous.id, revision: 7, target: { mode: 'selection', segmentIds: ['old-cue'] }, operation: 'recognize' }));
    await within(screen.getByRole('region', { name: '分段处理' })).findByText('00:00.100 → 00:01.800');
    expect((screen.getByLabelText('同时翻译') as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByLabelText('同时翻译'));
    await user.click(screen.getByRole('button', { name: '识别并替换片段' }));
    await waitFor(() => expect(api.jobs.recognizePartial).toHaveBeenCalledExactlyOnceWith({ jobId: previous.id, revision: 7, target: { mode: 'selection', segmentIds: ['old-cue'] }, translate: true }));
    await screen.findAllByText(/Operation cancelled/);
    expect(screen.getByText('人工校对译文。')).toBeTruthy();
    expect(api.jobs.translate).not.toHaveBeenCalled();
  });

  it('checks text through the independent review API, filters findings, and ignores without changing media', async () => {
    const previous = savedJob(); previous.options.translationEnabled = false; previous.options.reviewProfileId = 'review';
    const report: ReviewReport = { rubric: { version: REVIEW_RUBRIC_VERSION, rules: [...REVIEW_RULES] }, assessments: [{ segmentId: 'old-cue', riskLevel: 'medium', status: 'current', contextGroupId: 'context', findingIds: ['issue'] }], id: 'report', profileId: 'review', providerFingerprint: 'config', completedAt: 10, state: 'complete' as const, reviewedSegmentIds: ['old-cue'], fingerprints: { 'old-cue': 'content' }, findings: [{ id: 'issue', segmentId: 'old-cue', category: 'source' as const, reason: '句意可能重复', status: 'pending' as const }] };
    const { api } = stubApi(previous);
    vi.mocked(api.profiles.list).mockResolvedValue({ success: true, data: [{ id: 'review', name: 'Review', protocol: 'openai', baseUrl: 'https://example.test/v1', model: 'text', mode: 'chat', sessionOnly: false, maxUploadBytes: 24000000, structuredOutput: false, timeoutMs: 120000, hasKey: true }] });
    vi.mocked(api.jobs.reviewSubtitles).mockResolvedValue({ success: true, data: { ...previous, updatedAt: 10, reviewReport: report } });
    vi.mocked(api.jobs.acknowledgeFinding).mockResolvedValue({ success: true, data: { ...previous, updatedAt: 11, reviewReport: { ...report, findings: report.findings.map((finding) => ({ ...finding, status: 'ignored' as const })) } } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'AI 检查字幕' }));
    await screen.findByText(/句意可能重复/);
    expect(api.jobs.reviewSubtitles).toHaveBeenCalledExactlyOnceWith({ jobId: previous.id, revision: 7 });
    expect(api.jobs.recognize).not.toHaveBeenCalled(); expect(api.jobs.translate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('可疑度筛选'), { target: { value: 'pending' } });
    fireEvent.click(screen.getByRole('button', { name: '忽略' }));
    await screen.findByText('没有待检查字幕');
    expect(api.jobs.acknowledgeFinding).toHaveBeenCalledExactlyOnceWith({ jobId: previous.id, reportId: 'report', findingId: 'issue', status: 'ignored' });
    expect(api.jobs.editSegment).not.toHaveBeenCalled();
  });

  it.each([false, true])('retries failed partial recognition in the same scope with translation mode %s', async (translationEnabled) => {
    const user = userEvent.setup();
    const previous = savedJob(); previous.options.translationEnabled = translationEnabled;
    const { api, progress } = stubApi(previous);
    const failed = { ...previous, updatedAt: 8, stages: { ...previous.stages, recognize: { state: 'cancelled' as const, progress: 0.5, message: '片段已取消' } } };
    vi.mocked(api.jobs.planReprocess).mockResolvedValue({ success: true, data: { jobId: previous.id, revision: 7, operation: 'recognize', intervals: [{ startMs: 100, endMs: 1800 }], segmentIds: ['old-cue'], affectedCount: 1 } });
    vi.mocked(api.jobs.recognizePartial).mockImplementationOnce(async () => { progress(failed); return { success: false, code: 'CANCELLED', error: '片段已取消，原字幕保留' }; }).mockResolvedValueOnce({ success: true, data: { ...previous, revision: 8, updatedAt: 9 } });
    await act(async () => { render(<App />); });
    await screen.findByText('Corrected original.');
    await user.click(screen.getByLabelText('选择字幕 1'));
    expect((screen.getByLabelText('选择字幕 1') as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: '重新识别片段' }));
    expect(screen.getByRole('button', { name: '勾选字幕（1）' }).getAttribute('aria-pressed')).toBe('true');
    await within(screen.getByRole('region', { name: '分段处理' })).findByText('00:00.100 → 00:01.800');
    await user.click(screen.getByRole('button', { name: '识别并替换片段' }));
    await screen.findAllByText(/片段已取消，原字幕保留/);
    expect(screen.queryByRole('button', { name: '重试未完成阶段' })).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: '识别并替换片段' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: '识别并替换片段' }));
    await waitFor(() => expect(api.jobs.recognizePartial).toHaveBeenCalledTimes(2));
    for (const call of vi.mocked(api.jobs.recognizePartial).mock.calls) expect(call[0]).toEqual({ jobId: previous.id, revision: 7, target: { mode: 'selection', segmentIds: ['old-cue'] }, translate: false });
    expect(api.jobs.recognize).not.toHaveBeenCalled(); expect(api.jobs.translate).not.toHaveBeenCalled();
  });

  it('retries failed partial translation without translating the entire retained timeline', async () => {
    const user = userEvent.setup();
    const previous = savedJob(); const { api, progress } = stubApi(previous);
    const failed = { ...previous, updatedAt: 8, stages: { ...previous.stages, translate: { state: 'failed' as const, progress: 0, message: '片段翻译失败' } } };
    vi.mocked(api.jobs.planReprocess).mockResolvedValue({ success: true, data: { jobId: previous.id, revision: 7, operation: 'translate', intervals: [{ startMs: 100, endMs: 1800 }], segmentIds: ['old-cue'], affectedCount: 1 } });
    vi.mocked(api.jobs.translatePartial).mockImplementationOnce(async () => { progress(failed); return { success: false, code: 'PROVIDER_FAILED', error: '片段翻译失败，原字幕保留' }; }).mockResolvedValueOnce({ success: true, data: { ...previous, revision: 8, updatedAt: 9 } });
    await act(async () => { render(<App />); });
    await screen.findByText('Corrected original.');
    await user.click(screen.getByLabelText('选择字幕 1'));
    expect((screen.getByLabelText('选择字幕 1') as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: '重新翻译片段' }));
    expect(screen.getByRole('button', { name: '勾选字幕（1）' }).getAttribute('aria-pressed')).toBe('true');
    await within(screen.getByRole('region', { name: '分段处理' })).findByText('00:00.100 → 00:01.800');
    await user.click(screen.getByRole('button', { name: '翻译选定片段' }));
    await screen.findAllByText(/片段翻译失败，原字幕保留/);
    expect(screen.queryByRole('button', { name: '重试未完成阶段' })).toBeNull();
    await waitFor(() => expect((screen.getByRole('button', { name: '翻译选定片段' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: '翻译选定片段' }));
    await waitFor(() => expect(api.jobs.translatePartial).toHaveBeenCalledTimes(2));
    for (const call of vi.mocked(api.jobs.translatePartial).mock.calls) expect(call[0]).toEqual({ jobId: previous.id, revision: 7, target: { mode: 'selection', segmentIds: ['old-cue'] } });
    expect(api.jobs.recognize).not.toHaveBeenCalled(); expect(api.jobs.translate).not.toHaveBeenCalled();
  });
});
