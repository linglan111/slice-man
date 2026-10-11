// @vitest-environment jsdom
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { RuntimeDialog } from '../../../src/renderer/src/components/RuntimeDialog';
import type { RuntimeStatus } from '../../../src/shared/contracts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (): void { this.open = false; };
});
afterEach(cleanup);
const STATUS: RuntimeStatus = { installed: true, cpuReady: true, gpuReady: false, actualBackend: 'cpu', message: 'CPU 已验证可用', installedModels: ['base'], totalMemoryGb: 16, catalog: [{ id: 'base', name: 'Base', sizeBytes: 147951465 }] };

describe('Runtime installation status and cancellation', () => {
  it('renders normalized half-progress as 50% and exposes cancellation while install is busy', async () => {
    let complete: (() => void) | undefined;
    const onInstall = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const onCancel = vi.fn();
    render(<RuntimeDialog runtime={STATUS} progress={{ progress: .5, message: '正在校验模型' }} onInstall={onInstall} onCancel={onCancel} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '一键安装所选模型' }));
    expect((screen.getByRole('progressbar') as HTMLProgressElement).position).toBe(.5);
    expect((screen.getByRole('button', { name: '安装中…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '取消安装' }));
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
});
