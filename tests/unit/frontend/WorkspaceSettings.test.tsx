// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/src/App';
import { savedJob, stubApi } from './app-fixtures';

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (): void { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('workspace settings entry points', () => {
  it('ignores old secondary expansion and retains settings through the sidebar', async () => {
    localStorage.setItem('slice-man.secondary-expanded', 'true');
    localStorage.setItem('slice-man.layout', '{"sidebar":230,"columns":0.6,"secondary":0.8,"editor":0.7}');
    const { api } = stubApi(savedJob());
    render(<App />);
    await screen.findByRole('toolbar', { name: '视频操作' });
    expect(screen.queryByRole('button', { name: /生成、样式与导出/ })).toBeNull();
    expect(screen.queryByRole('separator', { name: '调整预览与设置区高度' })).toBeNull();
    expect(document.querySelector('.work-grid__content')?.children).toHaveLength(1);
    expect(document.querySelector('.app-shell')?.getAttribute('style')).toContain('--sidebar-width: 230px');
    fireEvent.click(screen.getByRole('button', { name: '生成设置' }));
    expect(await screen.findByRole('dialog', { name: '生成设置' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回工作区' }));
    fireEvent.click(screen.getByRole('button', { name: '样式设置' }));
    expect(await screen.findByRole('dialog', { name: '样式设置' })).toBeTruthy();
    expect(api.jobs.updateOptions).not.toHaveBeenCalled();
  });

  it('places the project title and metadata above the preview heading and preserves the full title', async () => {
    const job = { ...savedJob(), name: 'A long project name with important details.mp4' };
    stubApi(job); render(<App />);
    const preview = await screen.findByRole('region', { name: '视频预览' });
    const title = within(preview).getByRole('heading', { name: job.name });
    expect(title.getAttribute('title')).toBe(job.name);
    expect(preview.children[0]?.className).toBe('workspace-header');
    expect(preview.children[1]?.className).toContain('preview-heading');
    expect(document.querySelector('.work-grid__proofreading .workspace-header')).toBeNull();
    expect(within(preview).getByText(/640 × 360/)).toBeTruthy();
  });
});
