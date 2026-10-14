// @vitest-environment jsdom
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { RuntimeDialog } from '../../../src/renderer/src/components/RuntimeDialog';
import type { RuntimeStatus, Result } from '../../../src/shared/contracts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (): void { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const STATUS: RuntimeStatus = { installed: true, cpuReady: true, gpuReady: false, actualBackend: 'cpu', message: 'CPU 已验证可用', installedModels: ['base'], totalMemoryGb: 16, catalog: [{ id: 'base', name: 'Base', sizeBytes: 147951465 }] };
beforeEach(() => { vi.stubGlobal('api', { runtime: { status: vi.fn().mockResolvedValue({ success: true, data: STATUS }) } }); });

describe('Runtime installation status and cancellation', () => {
  it('renders normalized half-progress as 50% and exposes cancellation while install is busy', async () => {
    let complete: (() => void) | undefined;
    const onInstall = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const onCancel = vi.fn();
    render(<RuntimeDialog runtime={STATUS} progress={{ progress: .5, message: '正在校验模型' }} onInstall={onInstall} onCancel={onCancel} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '一键安装所选模型' }));
    expect((screen.getByRole('progressbar') as HTMLProgressElement).position).toBe(.5);
    expect((screen.getByRole('button', { name: '安装中…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '取消安装（保留下载）' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onInstall).toHaveBeenCalledWith('base', true);
    await act(async () => { complete?.(); });
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  });

  it('retains the working backend status after a failed install and offers retry', async () => {
    render(<RuntimeDialog runtime={STATUS} progress={null} onInstall={vi.fn().mockRejectedValue(new Error('下载校验失败，请重试。'))} onCancel={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '一键安装所选模型' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('校验失败'));
    expect(screen.getByText('CPU 已验证可用')).toBeTruthy();
    expect((screen.getByRole('button', { name: '一键安装所选模型' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('reads persisted download bytes on open without starting work, and explicitly clears only the cache', async () => {
    const cached: RuntimeStatus = { ...STATUS, downloadCache: { totalBytes: 4096, assets: [{ id: 'model-base', name: 'Base', downloadedBytes: 4096, totalBytes: 147951465, state: 'partial', resumable: true }] } };
    const onInstall = vi.fn(); const clear = vi.fn().mockResolvedValue({ success: true, data: { ...STATUS, downloadCache: { assets: [], totalBytes: 0 } } });
    vi.stubGlobal('api', { runtime: { status: vi.fn().mockResolvedValue({ success: true, data: cached }), clearDownloadCache: clear } });
    render(<RuntimeDialog runtime={STATUS} progress={null} onInstall={onInstall} onCancel={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: '继续安装所选模型' });
    expect(screen.getByText(/Base · 4.0 KB/)).toBeTruthy(); expect(onInstall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '清除下载缓存' }));
    await screen.findByRole('button', { name: '一键安装所选模型' });
    expect(clear).toHaveBeenCalledOnce(); expect(screen.getByText('CPU 已验证可用')).toBeTruthy(); expect(onInstall).not.toHaveBeenCalled();
  });
  it('does not restore old cached bytes when an initial status read arrives after explicit clear', async () => {
    const cached: RuntimeStatus = { ...STATUS, downloadCache: { totalBytes: 100, assets: [{ id: 'model-base', name: 'Base', downloadedBytes: 100, totalBytes: 1000, state: 'partial', resumable: true }] } };
    let respond: ((value: Result<RuntimeStatus>) => void) | undefined;
    vi.stubGlobal('api', { runtime: { status: vi.fn(() => new Promise<Result<RuntimeStatus>>((resolve) => { respond = resolve; })), clearDownloadCache: vi.fn().mockResolvedValue({ success: true, data: { ...STATUS, downloadCache: { assets: [], totalBytes: 0 } } }) } });
    render(<RuntimeDialog runtime={cached} progress={null} onInstall={vi.fn()} onCancel={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '清除下载缓存' }));
    await screen.findByRole('button', { name: '一键安装所选模型' });
    await act(async () => { respond?.({ success: true, data: cached }); });
    expect(screen.queryByLabelText('保留的工具下载')).toBeNull();
  });
});
