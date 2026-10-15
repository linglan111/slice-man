// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProviderLive } from '../../../src/renderer/src/hooks/useProviderLive';
import type { AppApi } from '../../../src/shared/contracts';
import { savedJob, stubApi } from './app-fixtures';
import { liveSnapshot } from './provider-live-fixtures';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('live stream polling lifecycle', () => {
  it('polls while watched, refreshes terminal contents once when processing ends, and stops on unmount', async () => {
    const { api } = stubApi(savedJob());
    vi.mocked(api.diagnostics.live).mockResolvedValue({ success: true, data: [liveSnapshot()] });
    const { result, rerender, unmount } = renderHook(({ watching }) => useProviderLive('job', watching), { initialProps: { watching: true } });
    await act(async () => {});
    expect(result.current.items[0]?.phase).toBe('thinking');
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(api.diagnostics.live).toHaveBeenCalledTimes(2);
    vi.mocked(api.diagnostics.live).mockResolvedValue({ success: true, data: [liveSnapshot({ phase: 'complete', state: 'published', answerText: '{}' })] });
    rerender({ watching: false }); await act(async () => {});
    expect(result.current.items[0]?.phase).toBe('complete');
    const calls = vi.mocked(api.diagnostics.live).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(api.diagnostics.live).toHaveBeenCalledTimes(calls);
    rerender({ watching: true }); await act(async () => {}); unmount();
    const afterUnmount = vi.mocked(api.diagnostics.live).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(api.diagnostics.live).toHaveBeenCalledTimes(afterUnmount);
  });
  it('never displays a previous project or a late response after switching projects', async () => {
    const { api } = stubApi(savedJob());
    let finish: ((result: Awaited<ReturnType<AppApi['diagnostics']['live']>>) => void) | undefined;
    vi.mocked(api.diagnostics.live).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ success: true, data: [liveSnapshot({ jobId: 'other', thinkingText: 'Other current content' }), liveSnapshot({ jobId: 'job', thinkingText: 'Foreign stale content' })] });
    const { result, rerender } = renderHook(({ id }) => useProviderLive(id, true), { initialProps: { id: 'job' } });
    rerender({ id: 'other' }); await act(async () => {});
    expect(result.current.items.map((item) => item.thinkingText)).toEqual(['Other current content']);
    await act(async () => { finish?.({ success: true, data: [liveSnapshot({ thinkingText: 'Late previous response' })] }); });
    expect(result.current.items.map((item) => item.thinkingText)).toEqual(['Other current content']);
  });
  it('recovers from a temporary read failure without stopping the active poll', async () => {
    const { api } = stubApi(savedJob());
    vi.mocked(api.diagnostics.live).mockResolvedValueOnce({ success: false, code: 'TEMPORARY', error: '暂时无法读取' }).mockResolvedValue({ success: true, data: [liveSnapshot()] });
    const { result } = renderHook(() => useProviderLive('job', true)); await act(async () => {});
    expect(result.current.error).toContain('暂时无法读取');
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(result.current.error).toBe(''); expect(result.current.items).toHaveLength(1);
  });
});
