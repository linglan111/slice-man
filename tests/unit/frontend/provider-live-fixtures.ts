import type { ProviderLiveSnapshot } from '../../../src/shared/provider-diagnostics-contracts';

export function liveSnapshot(overrides: Partial<ProviderLiveSnapshot> = {}): ProviderLiveSnapshot {
  return { requestId: '00000000-0000-4000-8000-000000000001', jobId: 'job', operation: 'review', model: 'fixture', state: 'receiving', phase: 'thinking', startedAt: 1000, updatedAt: 61000, elapsedMs: 60000, wireBytes: 8123, answerBytes: 0, thinkingText: '合成思考：正在核对上下文。', answerText: '', thinkingTruncated: false, answerTruncated: false, ...overrides };
}
