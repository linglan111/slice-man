// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../../src/renderer/src/App';
import type { Job } from '../../../src/shared/contracts';
import { savedJob, stubApi } from './app-fixtures';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (): void { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openConfirmation(): Promise<void> {
  const disclosure = await screen.findByRole('button', { name: /生成、样式与导出/ });
  if (disclosure.getAttribute('aria-expanded') === 'false') fireEvent.click(disclosure);
  const trigger = await screen.findByRole('button', { name: '重新识别原片' });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(trigger);
}

describe('App explicit recognition rerun integration', () => {
  it('dismisses without calling either recognition API or translation', async () => {
    const { api } = stubApi(savedJob());
    render(<App />);
    await openConfirmation();
    fireEvent.click(screen.getByRole('button', { name: '保留现有字幕' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('人工校对译文。')).toBeTruthy();
    expect(api.jobs.recognizeAgain).not.toHaveBeenCalled();
    expect(api.jobs.recognize).not.toHaveBeenCalled();
    expect(api.jobs.translate).not.toHaveBeenCalled();
  });

  it('commits fresh source, clears selection and asks for separate translation', async () => {
    const previous = savedJob();
    const { api } = stubApi(previous);
    const next: Job = { ...previous, revision: 8, updatedAt: 8, segments: [{ ...previous.segments[0], id: 'fresh-cue', startMs: 100, endMs: 1800, sourceText: 'Fresh source.', translatedText: '', translationStale: false }], style: { ...previous.style, emphasisBySegment: [] } };
    vi.mocked(api.jobs.recognizeAgain).mockResolvedValue({ success: true, data: next });
    render(<App />);
    await screen.findByText('人工校对译文。');
    fireEvent.click(screen.getByLabelText('选择字幕 1'));
    await openConfirmation();
    fireEvent.click(screen.getByRole('button', { name: '确认重新识别' }));
    await screen.findByText('Fresh source.');
    expect(api.jobs.recognizeAgain).toHaveBeenCalledExactlyOnceWith({ jobId: previous.id, revision: 7 });
    expect((screen.getByLabelText('选择字幕 1') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText('人工校对译文。')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('不会自动翻译');
    expect(screen.getByRole('status').textContent).toContain('翻译全部字幕');
    expect(api.jobs.recognize).not.toHaveBeenCalled();
    expect(api.jobs.translate).not.toHaveBeenCalled();
    expect(screen.getByText('previous-export.srt')).toBeTruthy();
  });

  it.each(['AUTH_ERROR', 'CANCELLED'])('retains corrected text and output history on %s', async (code) => {
    const { api } = stubApi(savedJob());
    vi.mocked(api.jobs.recognizeAgain).mockResolvedValue({ success: false, error: 'Attempt failed.', code });
    render(<App />);
    await openConfirmation();
    fireEvent.click(screen.getByRole('button', { name: '确认重新识别' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('未替换已有字幕和校对结果');
    expect(alert.textContent).toContain(code);
    expect(screen.getByText('Corrected original.')).toBeTruthy();
    expect(screen.getByText('人工校对译文。')).toBeTruthy();
    expect(screen.getByText('previous-export.srt')).toBeTruthy();
    expect(api.jobs.translate).not.toHaveBeenCalled();
  });

  it('sends the revision captured at dialog open and retains newer corrections after stale rejection', async () => {
    const previous = savedJob();
    const { api, progress } = stubApi(previous);
    vi.mocked(api.jobs.recognizeAgain).mockResolvedValue({ success: false, error: 'Job changed.', code: 'STALE_REVISION' });
    render(<App />);
    await openConfirmation();
    await act(async () => { progress({ ...previous, revision: 8, updatedAt: 8, segments: [{ ...previous.segments[0], id: 'old-cue', startMs: 100, endMs: 1800, sourceText: 'Newer correction.', translatedText: '更新后的译文。', translationStale: false }] }); });
    fireEvent.click(screen.getByRole('button', { name: '确认重新识别' }));
    expect((await screen.findByRole('alert')).textContent).toContain('STALE_REVISION');
    expect(api.jobs.recognizeAgain).toHaveBeenCalledExactlyOnceWith({ jobId: previous.id, revision: 7 });
    expect(screen.getByText('Newer correction.')).toBeTruthy();
    expect(screen.getByText('更新后的译文。')).toBeTruthy();
  });

  it('disables an open confirmation if a stage starts through progress events', async () => {
    const previous = savedJob();
    const { api, progress } = stubApi(previous);
    render(<App />);
    await openConfirmation();
    await act(async () => { progress({ ...previous, updatedAt: 8, stages: { ...previous.stages, translate: { state: 'running', progress: .5, message: 'Translating' } } }); });
    const confirm = screen.getByRole('button', { name: '确认重新识别' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(api.jobs.recognizeAgain).not.toHaveBeenCalled();
  });
});
