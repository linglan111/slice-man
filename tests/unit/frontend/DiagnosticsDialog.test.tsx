// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DiagnosticsDialog } from '../../../src/renderer/src/components/DiagnosticsDialog';
import { providerDiagnosticSchema, type ProviderDiagnostic } from '../../../src/shared/provider-diagnostics-contracts';
import { savedJob, stubApi } from './app-fixtures';

beforeAll(() => {HTMLDialogElement.prototype.showModal = function (): void {this.open = true;}; HTMLDialogElement.prototype.close = function (): void {this.open = false;};});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
function record(index: number): ProviderDiagnostic {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  return providerDiagnosticSchema.parse({id, runId: 'run', jobId: 'job', operation: 'review', profileId: 'profile', model: 'fixture', protocol: 'openai', mode: 'chat', state: 'published', attempt: 0, targetCount: 1, promptBytes: 10, streamRequested: true, streamActual: true, timeoutMs: 120000, textTimeoutMs: 1800000, startedAt: 1000, endedAt: 2000, elapsedMs: 1000, wireBytes: 30, textBytes: 2, events: 3, heartbeats: 1, artifact: `${id}/answer.complete.txt`});
}
describe('diagnostics page navigation', () => {
  it('loads older requests with a stable timestamp/ID cursor without losing existing rows', async () => {
    const { api } = stubApi(savedJob());
    const first = Array.from({length: 50}, (_, index) => record(100 - index));
    vi.mocked(api.diagnostics.list).mockResolvedValueOnce({success: true, data: first}).mockResolvedValueOnce({success: true, data: [record(50), record(49)]});
    render(<DiagnosticsDialog jobId="job" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', {name: '加载更早的请求'}));
    await waitFor(() => expect(screen.getAllByRole('button', {name: /字幕检查 · 已应用/})).toHaveLength(52));
    expect(api.diagnostics.list).toHaveBeenLastCalledWith({jobId: 'job', before: 1000, beforeId: first.at(-1)?.id});
    expect(screen.queryByRole('button', {name: '加载更早的请求'})).toBeNull();
    expect(api.diagnostics.readAnswer).not.toHaveBeenCalled(); expect(api.diagnostics.clear).not.toHaveBeenCalled();
  });
  it.each(['failed', 'interrupted'] as const)('offers an explicit setup route for a matching %s request', async (state) => {
    const { api } = stubApi(savedJob()); const item = { ...record(1), state }; const onRetry = vi.fn();
    vi.mocked(api.diagnostics.list).mockResolvedValue({ success: true, data: [item] });
    vi.mocked(api.diagnostics.detail).mockResolvedValue({ success: true, data: item });
    vi.mocked(api.diagnostics.readAnswer).mockResolvedValue({ success: true, data: { text: '{}', truncated: false } });
    render(<DiagnosticsDialog jobId="job" onClose={vi.fn()} onRetry={onRetry} />);
    fireEvent.click(await screen.findByRole('button', { name: /字幕检查/ }));
    fireEvent.click(await screen.findByRole('button', { name: '重新设置并重试' }));
    expect(onRetry).toHaveBeenCalledExactlyOnceWith(item);
    expect(api.jobs.reviewSubtitles).not.toHaveBeenCalled();
  });
  it.each(['published', 'validated', 'cancelled', 'waiting', 'receiving'] as const)('does not offer replay for a %s record', async (state) => {
    const { api } = stubApi(savedJob()); const item = { ...record(1), state };
    vi.mocked(api.diagnostics.list).mockResolvedValue({ success: true, data: [item] });
    vi.mocked(api.diagnostics.detail).mockResolvedValue({ success: true, data: item });
    vi.mocked(api.diagnostics.readAnswer).mockResolvedValue({ success: true, data: { text: '{}', truncated: false } });
    render(<DiagnosticsDialog jobId="job" onClose={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /字幕检查/ }));
    await screen.findByRole('heading', { name: /字幕检查/ });
    expect(screen.queryByRole('button', { name: '重新设置并重试' })).toBeNull();
  });
  it('blocks recovery while work is running and does not recover another project request', async () => {
    const { api } = stubApi(savedJob()); const item = { ...record(1), state: 'failed' as const }; const onRetry = vi.fn();
    vi.mocked(api.diagnostics.list).mockResolvedValue({ success: true, data: [item] });
    vi.mocked(api.diagnostics.detail).mockResolvedValue({ success: true, data: item });
    vi.mocked(api.diagnostics.readAnswer).mockResolvedValue({ success: true, data: { text: '{}', truncated: false } });
    const { rerender } = render(<DiagnosticsDialog jobId="job" onClose={vi.fn()} onRetry={onRetry} isOperationBusy />);
    fireEvent.click(await screen.findByRole('button', { name: /字幕检查/ }));
    const retry = await screen.findByRole('button', { name: '重新设置并重试' });
    expect((retry as HTMLButtonElement).disabled).toBe(true); fireEvent.click(retry); expect(onRetry).not.toHaveBeenCalled();
    rerender(<DiagnosticsDialog jobId="different-job" onClose={vi.fn()} onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: '重新设置并重试' })).toBeNull();
  });
  it('does not offer recovery for a record with no associated project', async () => {
    const { api } = stubApi(savedJob()); const item = { ...record(1), jobId: undefined, state: 'failed' as const };
    vi.mocked(api.diagnostics.list).mockResolvedValue({ success: true, data: [item] });
    vi.mocked(api.diagnostics.detail).mockResolvedValue({ success: true, data: item });
    vi.mocked(api.diagnostics.readAnswer).mockResolvedValue({ success: true, data: { text: '{}', truncated: false } });
    render(<DiagnosticsDialog onClose={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /字幕检查/ }));
    await screen.findByRole('heading', { name: /字幕检查/ });
    expect(screen.queryByRole('button', { name: '重新设置并重试' })).toBeNull();
  });
});
