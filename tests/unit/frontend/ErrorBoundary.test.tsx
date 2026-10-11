// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ErrorBoundary } from '../../../src/renderer/src/components/ErrorBoundary';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ErrorBoundary', () => {
  it('shows an actionable reload fallback after a renderer failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Broken(): ReactNode { throw new Error('private provider failure'); }
    render(<ErrorBoundary><Broken /></ErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('历史记录');
    expect(screen.getByRole('button', { name: '重新加载界面' })).toBeTruthy();
    expect(screen.queryByText('private provider failure')).toBeNull();
  });
});
