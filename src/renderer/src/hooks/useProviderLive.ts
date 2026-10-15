import { useEffect, useState } from 'react';
import type { ProviderLiveSnapshot } from '../../../shared/provider-diagnostics-contracts';
import { requireResult } from '../lib/api-result';

/** Poll transient request buffers only while processing or viewing them. Never persist them. */
export function useProviderLive(jobId: string | undefined, isWatching: boolean): { items: ProviderLiveSnapshot[]; error: string } {
  const [value, setValue] = useState<{ jobId?: string; items: ProviderLiveSnapshot[]; error: string }>({ items: [], error: '' });
  useEffect(() => {
    if (!jobId) return;
    let current = true;
    let timer: number | undefined;
    async function refresh(): Promise<void> {
      try {
        const items = await requireResult(window.api.diagnostics.live({ jobId }));
        if (current) setValue({ jobId, items: items.filter((item) => item.jobId === jobId), error: '' });
      } catch (cause) {
        if (current) setValue((previous) => ({ jobId, items: previous.jobId === jobId ? previous.items : [], error: cause instanceof Error ? cause.message : '无法读取流式信息' }));
      } finally {
        if (current && isWatching) timer = window.setTimeout(() => void refresh(), 750);
      }
    }
    void refresh();
    return () => { current = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [jobId, isWatching]);
  return value.jobId === jobId ? value : { items: [], error: '' };
}
