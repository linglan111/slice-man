// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/src/App';
import { ONBOARDING_STORAGE_KEY } from '../../../src/renderer/src/lib/onboarding-preferences';
import { savedJob, stubApi } from './app-fixtures';
import type { Job, Result } from '../../../src/shared/contracts';

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (): void { this.open = false; };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('App first-run guide lifecycle', () => {
  it('opens once after successful empty startup under StrictMode and replays without project actions', async () => {
    const user = userEvent.setup();
    const { api } = stubApi(savedJob(), { firstRun: true });
    vi.mocked(api.jobs.list).mockResolvedValue({ success: true, data: [] });
    const view = render(<StrictMode><App /></StrictMode>);
    const guide = await screen.findByRole('dialog', { name: '功能导航' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
    await user.click(within(guide).getByRole('button', { name: '稍后再看' }));
    expect(view.container.querySelector('[data-onboarding-state]')?.getAttribute('data-onboarding-state')).toBe('settled');
    await user.click(screen.getByRole('button', { name: '收起侧边栏' }));
    const utilities = screen.getByRole('navigation', { name: '工作区快捷操作' });
    expect(within(utilities).getAllByRole('button')).toHaveLength(3);
    expect(within(utilities).getByRole('button', { name: '重置布局' }).querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: '功能导航' }).closest('.sidebar__footer')).toBeNull();
    expect(screen.getByRole('button', { name: '重置布局' }).closest('.sidebar__footer')).toBeNull();
    await user.click(screen.getByRole('button', { name: '功能导航' }));
    expect(screen.getByRole('status').textContent).toContain('第 1 / 6 步');
    expect(api.jobs.importVideo).not.toHaveBeenCalled();
    expect(api.jobs.reviewSubtitles).not.toHaveBeenCalled();
    expect(api.jobs.repairLoop).not.toHaveBeenCalled();
    expect(api.jobs.export).not.toHaveBeenCalled();
    expect(api.jobs.cancel).not.toHaveBeenCalled();
  });
  it('defers the guide until a dialog opened during slow initialization is closed', async () => {
    const user = userEvent.setup();
    const job = savedJob();
    const { api } = stubApi(job, { firstRun: true });
    let completeLoad: ((value: Result<Job[]>) => void) | undefined;
    vi.mocked(api.jobs.list).mockImplementation(() => new Promise((resolve) => { completeLoad = resolve; }));
    render(<App />);
    expect(screen.queryByRole('dialog', { name: '功能导航' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '导入视频' }));
    const importing = screen.getByRole('dialog', { name: '导入视频' });
    await act(async () => { completeLoad?.({ success: true, data: [job] }); });
    await screen.findByText('Corrected original.');
    expect(screen.queryByRole('dialog', { name: '功能导航' })).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(within(importing).getByRole('button', { name: '取消' }));
    await screen.findByRole('dialog', { name: '功能导航' });
    expect(api.jobs.importVideo).not.toHaveBeenCalled();
  });
  it('preserves startup errors and still allows manual help', async () => {
    const user = userEvent.setup();
    const { api } = stubApi(savedJob(), { firstRun: true });
    vi.mocked(api.jobs.list).mockResolvedValue({ success: false, code: 'DB_ERROR', error: '本地项目暂时无法读取' });
    const view = render(<App />);
    await screen.findByText('本地项目暂时无法读取 (DB_ERROR)');
    expect(screen.queryByRole('dialog', { name: '功能导航' })).toBeNull();
    expect(view.container.querySelector('[data-onboarding-state]')?.getAttribute('data-onboarding-state')).toBe('settled');
    await user.click(screen.getByRole('button', { name: '功能导航' }));
    await screen.findByRole('dialog', { name: '功能导航' });
    await user.click(screen.getByRole('button', { name: '稍后再看' }));
    expect(screen.getByText('本地项目暂时无法读取 (DB_ERROR)')).toBeTruthy();
  });
  it('keeps dismissal in memory when the onboarding preference cannot be written', async () => {
    const user = userEvent.setup();
    stubApi(savedJob(), { firstRun: true });
    const originalWrite = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === ONBOARDING_STORAGE_KEY) throw new Error('quota');
      originalWrite.call(this, key, value);
    });
    render(<App />);
    await screen.findByRole('dialog', { name: '功能导航' });
    await user.click(screen.getByRole('button', { name: '稍后再看' }));
    await user.click(screen.getByRole('button', { name: '收起侧边栏' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '功能导航' })).toBeNull());
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
    await user.click(screen.getByRole('button', { name: '功能导航' }));
    expect(screen.getByRole('status').textContent).toContain('第 1 / 6 步');
  });
  it('can start and dismiss when all browser storage reads and writes are unavailable', async () => {
    const user = userEvent.setup();
    stubApi(savedJob(), { firstRun: true });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    render(<App />);
    await screen.findByRole('dialog', { name: '功能导航' });
    await user.click(screen.getByRole('button', { name: '稍后再看' }));
    await user.click(screen.getByRole('button', { name: '收起侧边栏' }));
    expect(screen.queryByRole('dialog', { name: '功能导航' })).toBeNull();
    expect(screen.getByText('Corrected original.')).toBeTruthy();
  });
  it('defers automatic guide during running work and preserves the job when help is replayed', async () => {
    const user = userEvent.setup();
    const job = savedJob();
    job.stages.recognize.state = 'running';
    const { api, progress } = stubApi(job, { firstRun: true });
    render(<App />);
    await screen.findByText('Corrected original.');
    expect(screen.queryByRole('dialog', { name: '功能导航' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '功能导航' }));
    await user.click(screen.getByRole('button', { name: '稍后再看' }));
    const finished = structuredClone(job);
    finished.stages.recognize.state = 'succeeded'; finished.updatedAt++;
    await act(async () => progress(finished));
    expect(screen.queryByRole('dialog', { name: '功能导航' })).toBeNull();
    expect(screen.getByText('Corrected original.')).toBeTruthy();
    expect(api.jobs.cancel).not.toHaveBeenCalled();
    expect(api.jobs.updateOptions).not.toHaveBeenCalled();
    expect(api.jobs.repairLoop).not.toHaveBeenCalled();
  });
});
