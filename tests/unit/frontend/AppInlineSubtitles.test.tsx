// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/src/App';
import type { Job, Result, Segment } from '../../../src/shared/contracts';
import { savedJob, stubApi } from './app-fixtures';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (): void { this.open = false; };
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
  vi.stubGlobal('VTTCue', class { constructor(public startTime: number, public endTime: number, public text: string) {} });
  Object.defineProperties(HTMLVideoElement.prototype, {
    readyState: { configurable: true, get: () => 2 }, videoWidth: { configurable: true, get: () => 640 }, videoHeight: { configurable: true, get: () => 360 },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect(0, 0, 640, 360) },
    addTextTrack: { configurable: true, value: () => ({ mode: 'disabled', addCue: vi.fn(), removeCue: vi.fn() }) },
    textTracks: { configurable: true, get: () => new EventTarget() },
    requestVideoFrameCallback: { configurable: true, value: undefined }, pause: { configurable: true, value: vi.fn() },
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function setup(job = savedJob()): Promise<ReturnType<typeof stubApi>> {
  const fixture = stubApi(job);
  vi.mocked(fixture.api.jobs.playback).mockResolvedValue({ success: true, data: { url: 'app-media://local/anonymous' } });
  render(<App />);
  await screen.findByLabelText('选择字幕 1');
  await waitFor(() => expect(document.querySelector('video')).toBeTruthy());
  const video = document.querySelector('video');
  if (!video) throw new Error('Fixture video missing');
  video.currentTime = .5; fireEvent(video, new Event('seeked'));
  await screen.findByRole('button', { name: '校对画面字幕：人工校对译文。' });
  return fixture;
}

function edited(job: Job, segment: Segment): Job {
  return { ...job, revision: job.revision + 1, updatedAt: job.updatedAt + 1, segments: job.segments.map((cue) => cue.id === segment.id ? segment : cue) };
}

describe('inline subtitle editing and manual timeline integration', () => {
  it('opens a keyboard-accessible preview form, pauses video and saves captured cue/revision without AI', async () => {
    const job = savedJob(); const { api } = await setup(job);
    expect(screen.getByRole('button', { name: '链接导入设置' }).closest('.sidebar__footer')).toBeTruthy();
    expect(screen.getByRole('button', { name: '链接导入' }).closest('.sidebar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '↓ 在线下载' })).toBeNull();
    vi.mocked(api.jobs.editSegment).mockImplementation(async ({ segment }) => ({ success: true, data: edited(job, segment) }));
    const target = screen.getByRole('button', { name: '校对画面字幕：人工校对译文。' });
    target.focus(); await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('video')?.pause).toHaveBeenCalled();
    expect(screen.getByRole('region', { name: '校对字幕' }).closest('.preview-panel')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('开始时间（秒）'), { target: { value: '0.200' } });
    fireEvent.change(screen.getByLabelText('结束时间（秒）'), { target: { value: '1.500' } });
    fireEvent.change(screen.getByLabelText('原文'), { target: { value: 'Edited source' } });
    fireEvent.change(screen.getByLabelText('译文'), { target: { value: '新译文' } });
    fireEvent.click(screen.getByRole('button', { name: '保存字幕' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '校对字幕' })).toBeNull());
    expect(api.jobs.editSegment).toHaveBeenCalledWith({ jobId: job.id, revision: 7, segment: { ...job.segments[0], startMs: 200, endMs: 1500, sourceText: 'Edited source', translatedText: '新译文' } });
    expect(screen.getByTestId('live-captions').textContent).toBe('新译文');
    expect(api.jobs.recognize).not.toHaveBeenCalled(); expect(api.jobs.translate).not.toHaveBeenCalled();
  });

  it('keeps editing in the matching list row and Escape/cancel send no mutation', async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByLabelText('编辑字幕 1'));
    const input = screen.getByLabelText('原文');
    expect(input.closest('[data-testid="segment-0"]')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Unsaved draft' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: '校对字幕' })).toBeNull();
    expect(api.jobs.editSegment).not.toHaveBeenCalled();
    expect(screen.getByTestId('segment-0').textContent).toContain('Corrected original.');
  });

  it('retains a draft and captured revision after a stale save rejects newer content', async () => {
    const job = savedJob(); const { api, progress } = await setup(job);
    vi.mocked(api.jobs.editSegment).mockResolvedValue({ success: false, code: 'STALE_REVISION', error: 'Reopen editor' });
    fireEvent.click(screen.getByLabelText('编辑字幕 1'));
    fireEvent.change(screen.getByLabelText('原文'), { target: { value: 'Draft' } });
    await act(async () => { progress({ ...job, revision: 8, updatedAt: 8, segments: job.segments.map((cue) => ({ ...cue, sourceText: 'Newer persisted source' })) }); });
    fireEvent.click(screen.getByRole('button', { name: '保存字幕' }));
    expect((await screen.findByRole('alert')).textContent).toContain('STALE_REVISION');
    expect(api.jobs.editSegment).toHaveBeenCalledWith(expect.objectContaining({ jobId: job.id, revision: 7 }));
    expect((screen.getByLabelText('原文') as HTMLTextAreaElement).value).toBe('Draft');
    expect(screen.getByTestId('segment-0').textContent).toContain('Newer persisted source');
  });

  it('does not let a delayed old save close a newer inline draft', async () => {
    const job = savedJob(); job.segments.push({ ...job.segments[0], id: 'second', startMs: 2000, endMs: 3000, sourceText: 'Second', translatedText: '第二句', translationStale: false });
    const { api } = await setup(job);
    let complete: ((result: Result<Job>) => void) | undefined;
    vi.mocked(api.jobs.editSegment).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    fireEvent.click(screen.getByLabelText('编辑字幕 1'));
    fireEvent.click(screen.getByRole('button', { name: '保存字幕' }));
    fireEvent.click(screen.getByLabelText('编辑字幕 2'));
    fireEvent.change(screen.getByLabelText('原文'), { target: { value: 'New second draft' } });
    await act(async () => { complete?.({ success: true, data: { ...job, revision: 8, updatedAt: 8 } }); });
    expect((screen.getByLabelText('原文') as HTMLTextAreaElement).value).toBe('New second draft');
  });

  it('adds at actual paused media time with a positive near-end interval and never persists a blank draft', async () => {
    const job = savedJob(); const { api } = await setup(job);
    const video = document.querySelector('video'); if (!video) throw new Error('Video missing');
    video.currentTime = 3.999;
    fireEvent.click(screen.getByRole('button', { name: '添加画面字幕' }));
    expect((screen.getByLabelText('开始时间（秒）') as HTMLInputElement).value).toBe('3.999');
    expect((screen.getByLabelText('结束时间（秒）') as HTMLInputElement).value).toBe('4.000');
    fireEvent.click(screen.getByRole('button', { name: '保存字幕' }));
    expect(screen.getByRole('alert').textContent).toContain('请填写'); expect(api.jobs.addSegment).not.toHaveBeenCalled();
    vi.mocked(api.jobs.addSegment).mockImplementation(async ({ segment }) => ({ success: true, data: { ...job, revision: 8, updatedAt: 8, segments: [...job.segments, { ...segment, id: 'server-id', translatedText: segment.translatedText ?? '', translationStale: false }] } }));
    fireEvent.change(screen.getByLabelText('原文'), { target: { value: 'Manual line' } });
    fireEvent.click(screen.getByRole('button', { name: '保存字幕' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '添加字幕' })).toBeNull());
    expect(api.jobs.addSegment).toHaveBeenCalledWith({ jobId: job.id, revision: 7, segment: { startMs: 3999, endMs: 4000, sourceText: 'Manual line', translatedText: '' } });
    expect(api.jobs.recognize).not.toHaveBeenCalled(); expect(api.jobs.translate).not.toHaveBeenCalled();
  });

  it('removes selected cues, retains add controls after deleting all, and hides obsolete reference UI/stage', async () => {
    const job = savedJob(); job.previewUrl = 'app-media://local/old-reference'; job.stages.preview = { state: 'failed', progress: 0, message: 'Old reference failed' };
    const { api } = await setup(job);
    vi.mocked(api.jobs.removeSegment).mockResolvedValue({ success: true, data: { ...job, revision: 8, updatedAt: 8, segments: [], style: { ...job.style, emphasisBySegment: [] } } });
    expect(screen.queryByText('渲染当前参考画面')).toBeNull(); expect(document.querySelector('.reference-preview')).toBeNull(); expect(screen.queryByText('Old reference failed')).toBeNull();
    fireEvent.click(screen.getByLabelText('选择字幕 1'));
    fireEvent.click(screen.getByLabelText('删除字幕 1'));
    await screen.findByText('字幕将在这里出现');
    expect(api.jobs.removeSegment).toHaveBeenCalledWith({ jobId: job.id, revision: 7, segmentId: 'old-cue' });
    expect(screen.queryByRole('button', { name: '重译选中（0）' })).toBeNull();
    expect((screen.getByRole('button', { name: '添加字幕' }) as HTMLButtonElement).disabled).toBe(false);
    expect(api.jobs.preview).not.toHaveBeenCalled();
  });

  it('blocks cue/save actions during processing and closes drafts on a job switch', async () => {
    const job = savedJob(); const { api, progress } = await setup(job);
    fireEvent.click(screen.getByLabelText('编辑字幕 1'));
    await act(async () => { progress({ ...job, updatedAt: 8, stages: { ...job.stages, translate: { state: 'running', progress: .5, message: '' } } }); });
    expect((screen.getByRole('button', { name: '保存字幕' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '校对画面字幕：人工校对译文。' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await act(async () => { progress({ ...job, updatedAt: 9 }); });
    fireEvent.click(screen.getByLabelText('编辑字幕 1'));
    vi.mocked(api.jobs.importVideo).mockResolvedValue({ success: true, data: { ...job, id: 'other-job', name: 'Other job' } });
    fireEvent.click(screen.getByRole('button', { name: '导入视频' }));
    fireEvent.click(screen.getByRole('button', { name: '选择视频并导入' }));
    await screen.findByRole('heading', { name: 'Other job' });
    expect(screen.queryByRole('region', { name: '校对字幕' })).toBeNull();
  });
});
