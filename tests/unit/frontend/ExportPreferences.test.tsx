// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../../src/renderer/src/App';
import { ExportDialog } from '../../../src/renderer/src/components/ExportDialog';
import { ExportSettingsDialog } from '../../../src/renderer/src/components/ExportSettingsDialog';
import { SAVED_EXPORT_SETTINGS, savedJob, stubApi } from './app-fixtures';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (): void { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('independent export preferences and operation choices', () => {
  it('initializes video defaults and sends local overrides without changing persisted defaults', async () => {
    const { api } = stubApi(savedJob()); const onExport = vi.fn().mockResolvedValue(true); const onClose = vi.fn();
    render(<ExportDialog jobId="saved-job" onExport={onExport} onClose={onClose} />);
    await waitFor(() => expect((screen.getByLabelText('导出分辨率') as HTMLSelectElement).value).toBe('1080p'));
    fireEvent.change(screen.getByLabelText('导出格式'), { target: { value: 'mkv' } });
    fireEvent.change(screen.getByLabelText('视频编码'), { target: { value: 'h265' } });
    fireEvent.change(screen.getByLabelText('导出分辨率'), { target: { value: '720p' } });
    fireEvent.change(screen.getByLabelText('画质'), { target: { value: 'small' } });
    fireEvent.click(screen.getByRole('button', { name: '选择保存位置并导出' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onExport).toHaveBeenCalledWith({ jobId: 'saved-job', format: 'mkv', videoCodec: 'h265', resolution: '720p', quality: 'small' });
    expect(api.exportSettings.saveSettings).not.toHaveBeenCalled();
  });

  it('subtitle shortcut uses the saved subtitle format and omits every video processing option', async () => {
    const { api } = stubApi(savedJob());
    vi.mocked(api.exportSettings.status).mockResolvedValue({ success: true, data: { ...SAVED_EXPORT_SETTINGS, videoCodec: 'h265', subtitleFormat: 'ass' } });
    const onExport = vi.fn().mockResolvedValue(true);
    render(<ExportDialog jobId="saved-job" initialKind="subtitle" onExport={onExport} onClose={vi.fn()} />);
    await waitFor(() => expect((screen.getByLabelText('导出格式') as HTMLSelectElement).value).toBe('ass'));
    expect(screen.queryByLabelText('视频编码')).toBeNull(); expect(screen.queryByLabelText('导出分辨率')).toBeNull(); expect(screen.queryByLabelText('画质')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '选择保存位置并导出' }));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith({ jobId: 'saved-job', format: 'ass' }));
    expect(api.jobs.recognize).not.toHaveBeenCalled(); expect(api.jobs.translate).not.toHaveBeenCalled();
  });

  it('cancelled or failed video export preserves choices and allows a safe retry', async () => {
    stubApi(savedJob()); const onClose = vi.fn();
    const onExport = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('请选择 H.264 或 H.265。'));
    render(<ExportDialog jobId="saved-job" onExport={onExport} onClose={onClose} />);
    await screen.findByLabelText('视频编码');
    fireEvent.change(screen.getByLabelText('导出分辨率'), { target: { value: '480p' } });
    fireEvent.click(screen.getByRole('button', { name: '选择保存位置并导出' }));
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: '选择保存位置并导出' }).hasAttribute('disabled')).toBe(false));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '选择保存位置并导出' }));
    await screen.findByRole('alert'); expect(screen.getByRole('alert').textContent).toContain('H.264');
    expect((screen.getByLabelText('导出分辨率') as HTMLSelectElement).value).toBe('480p');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('native directory choice preserves other unsaved defaults and cancelled choice preserves the draft', async () => {
    const { api } = stubApi(savedJob());
    vi.mocked(api.exportSettings.chooseDirectory).mockResolvedValueOnce({ success: true, data: null }).mockResolvedValueOnce({ success: true, data: { ...SAVED_EXPORT_SETTINGS, directory: 'F:/chosen-export-location' } });
    vi.mocked(api.exportSettings.saveSettings).mockImplementation(async (settings) => ({ success: true, data: settings }));
    render(<ExportSettingsDialog onClose={vi.fn()} />); await screen.findByLabelText('默认视频格式');
    fireEvent.change(screen.getByLabelText('默认视频格式'), { target: { value: 'mkv' } });
    fireEvent.change(screen.getByLabelText('视频编码'), { target: { value: 'h265' } });
    fireEvent.change(screen.getByLabelText('导出分辨率'), { target: { value: '360p' } });
    fireEvent.change(screen.getByLabelText('默认字幕格式'), { target: { value: 'vtt' } });
    fireEvent.click(screen.getByRole('button', { name: '选择默认导出位置' }));
    await waitFor(() => expect(api.exportSettings.chooseDirectory).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: '选择默认导出位置' }).hasAttribute('disabled')).toBe(false));
    expect((screen.getByLabelText('默认导出位置') as HTMLInputElement).value).toBe(SAVED_EXPORT_SETTINGS.directory);
    fireEvent.click(screen.getByRole('button', { name: '选择默认导出位置' }));
    await waitFor(() => expect((screen.getByLabelText('默认导出位置') as HTMLInputElement).value).toBe('F:/chosen-export-location'));
    fireEvent.click(screen.getByRole('button', { name: '保存导出设置' }));
    await screen.findByText('导出默认设置已保存。');
    expect(api.exportSettings.saveSettings).toHaveBeenCalledWith({ ...SAVED_EXPORT_SETTINGS, directory: 'F:/chosen-export-location', videoFormat: 'mkv', videoCodec: 'h265', resolution: '360p', subtitleFormat: 'vtt' });
  });

  it('failed settings save retains draft values and disables changes during persistence', async () => {
    const { api } = stubApi(savedJob());
    let rejectSave: ((reason: Error) => void) | undefined;
    vi.mocked(api.exportSettings.saveSettings).mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    render(<ExportSettingsDialog onClose={vi.fn()} />); await screen.findByLabelText('默认视频格式');
    fireEvent.change(screen.getByLabelText('画质'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: '保存导出设置' }));
    expect(screen.getByLabelText('画质').hasAttribute('disabled')).toBe(true);
    rejectSave?.(new Error('目录无法写入')); await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('目录无法写入');
    expect((screen.getByLabelText('画质') as HTMLSelectElement).value).toBe('high');
  });

  it('App exposes separate settings and inline export types with the correct captured job', async () => {
    const job = savedJob(); const { api } = stubApi(job);
    vi.mocked(api.jobs.export).mockResolvedValue({ success: true, data: { path: 'anonymous.srt' } });
    vi.mocked(api.jobs.get).mockResolvedValue({ success: true, data: job });
    // Finish the initial job-selection effect before opening a user operation.
    await act(async () => { render(<App />); });
    expect(api.jobs.playback).toHaveBeenCalledWith(job.id);
    await screen.findByLabelText('选择字幕 1');
    expect(screen.getByRole('button', { name: '导出设置' }).closest('.sidebar__footer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '导出作品' }));
    await screen.findByLabelText('导出格式');
    fireEvent.click(screen.getByRole('button', { name: '独立字幕文件' }));
    await waitFor(() => expect((screen.getByLabelText('导出格式') as HTMLSelectElement).value).toBe('srt'));
    fireEvent.click(screen.getByRole('button', { name: '选择保存位置并导出' }));
    await waitFor(() => expect(api.jobs.export).toHaveBeenCalledWith({ jobId: job.id, format: 'srt' }));
  });

  it('late completion of a closed export keeps a newer settings dialog open', async () => {
    const job = savedJob(); const { api } = stubApi(job);
    let complete: ((value: { success: true; data: { path: string } }) => void) | undefined;
    vi.mocked(api.jobs.export).mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    vi.mocked(api.jobs.get).mockResolvedValue({ success: true, data: job });
    await act(async () => { render(<App />); });
    expect(api.jobs.playback).toHaveBeenCalledWith(job.id);
    await screen.findByLabelText('选择字幕 1');
    fireEvent.click(screen.getByRole('button', { name: '导出作品' })); await screen.findByLabelText('视频编码');
    fireEvent.click(screen.getByRole('button', { name: '选择保存位置并导出' }));
    fireEvent.click(screen.getByRole('button', { name: '返回工作区' }));
    fireEvent.click(screen.getByRole('button', { name: '导出设置' })); await screen.findByLabelText('默认视频格式');
    await act(async () => { complete?.({ success: true, data: { path: 'anonymous.mp4' } }); });
    await screen.findByText('导出完成：anonymous.mp4');
    expect(screen.getByRole('dialog', { name: '导出设置' })).toBeTruthy();
  });
});
