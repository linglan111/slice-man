import type { Profile } from "../../../../shared/contracts";
import { AppError, checkAbort } from "../../../lib/errors";

type Waiter = { limit: number; signal?: AbortSignal; resolve: (release: () => void) => void; reject: (error: unknown) => void; abort: () => void };
type ServiceQueue = { active: number; waiting: Waiter[] };
const services = new Map<string, ServiceQueue>();

/** All text operations, including corrections and capability tests, share service slots. */
export function acquireTextSlot(profile: Profile, signal?: AbortSignal): Promise<() => void> {
  checkAbort(signal);
  const limit = Math.max(1, Math.min(16, profile.textConcurrency ?? 2));
  let queue = services.get(profile.id);
  if (!queue) { queue = { active: 0, waiting: [] }; services.set(profile.id, queue); }
  const service = queue;
  const drain = (): void => {
    for (;;) {
      const waiter = service.waiting[0];
      if (!waiter || service.active >= waiter.limit) break;
      service.waiting.shift();
      waiter.signal?.removeEventListener("abort", waiter.abort);
      if (waiter.signal?.aborted) { waiter.reject(new AppError("CANCELLED", "操作已取消")); continue; }
      service.active++;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        service.active--;
        drain();
      });
    }
    if (!service.active && !service.waiting.length) services.delete(profile.id);
  };
  return new Promise((resolve, reject) => {
    const waiter: Waiter = { limit, signal, resolve, reject, abort: () => {
      const index = service.waiting.indexOf(waiter);
      if (index >= 0) service.waiting.splice(index, 1);
      reject(new AppError("CANCELLED", "操作已取消"));
      drain();
    } };
    service.waiting.push(waiter);
    signal?.addEventListener("abort", waiter.abort, { once: true });
    drain();
  });
}
