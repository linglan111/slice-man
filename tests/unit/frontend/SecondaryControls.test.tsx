// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecondaryControls } from '../../../src/renderer/src/components/SecondaryControls';
import { App } from '../../../src/renderer/src/App';
import { savedJob, stubApi } from './app-fixtures';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('secondary workflow disclosure', () => {
  it('supports keyboard activation and remembers preference without losing drafts', async () => {
    const view = render(<SecondaryControls initiallyExpanded={false}><input aria-label="Draft style" defaultValue="draft" /></SecondaryControls>);
    const toggle = screen.getByRole('button', { name: /生成、样式与导出/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('textbox')).toBeNull();
    toggle.focus(); await userEvent.keyboard('{Enter}');
    fireEvent.change(screen.getByLabelText('Draft style'), { target: { value: 'unsaved style' } });
    fireEvent.click(toggle); fireEvent.click(toggle);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('unsaved style');
    expect(localStorage.getItem('slice-man.secondary-expanded')).toBe('true');
    view.unmount();
    render(<SecondaryControls initiallyExpanded={false}>Settings</SecondaryControls>);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });

  it.each([true, false])('keeps the initial choice %s when generation state changes', (initiallyExpanded) => {
    const view = render(<SecondaryControls initiallyExpanded={initiallyExpanded}>Settings</SecondaryControls>);
    view.rerender(<SecondaryControls initiallyExpanded={!initiallyExpanded}>Settings</SecondaryControls>);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe(String(initiallyExpanded));
    expect(localStorage.getItem('slice-man.secondary-expanded')).toBeNull();
  });

  it('starts collapsed for saved cues and keeps proofreading outside the disclosure', async () => {
    const job = savedJob(); const { api, progress } = stubApi(job);
    render(<App />);
    const toggle = await screen.findByRole('button', { name: /生成、样式与导出/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: '添加字幕' }).closest('.work-grid__settings')).toBeNull();
    expect(document.querySelector('.subtitle-panel')?.parentElement?.firstElementChild?.className).toBe('work-grid__content');
    fireEvent.click(toggle);
    await act(async () => { progress({ ...job, revision: 8, updatedAt: 8, segments: [] }); });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(api.jobs.updateOptions).not.toHaveBeenCalled();
  });

  it('starts expanded for pending generation and honors an explicit collapse on a new project', async () => {
    const job = { ...savedJob(), segments: [] }; stubApi(job);
    const view = render(<App />);
    const toggle = await screen.findByRole('button', { name: /生成、样式与导出/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle); view.unmount(); stubApi({ ...job, id: 'another-project' });
    render(<App />);
    expect((await screen.findByRole('button', { name: /生成、样式与导出/ })).getAttribute('aria-expanded')).toBe('false');
  });
});
