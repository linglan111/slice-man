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
});
