import type { Segment } from "../../../../shared/contracts";
import { AppError, checkAbort } from "../../../lib/errors";

/** Input and expected output are bounded independently of the 20 minute chapter cap. */
export function boundedChapterPieces(targets: Segment[]): Segment[][] {
  const pieces: Segment[][] = [];
  let current: Segment[] = [];
  let bytes = 0;
  for (const cue of targets) {
    const size = Buffer.byteLength(JSON.stringify(cue), "utf8");
    if (size > 160 * 1024)
      throw new AppError(
        "TEXT_LIMIT",
        "单条字幕超过章节处理容量，请缩短该条字幕",
      );
    if (current.length && (current.length >= 150 || bytes + size > 96 * 1024)) {
      pieces.push(current);
      current = [];
      bytes = 0;
    }
    current.push(cue);
    bytes += size;
  }
  if (current.length) pieces.push(current);
  return pieces;
}

/** Atomic owners collect in timeline order; incremental owners retain each complete chapter immediately. */
export async function orderedChapterWorkers<T, R>(
  items: T[],
  concurrency: number,
  signal: AbortSignal,
  prepare: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  commit: (result: R, item: T, index: number) => void,
  publication: 'ordered' | 'ready' = 'ordered',
): Promise<void> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  let cursor = 0;
  let failure: unknown;
  const ready = new Map<number, R>();
  let nextCommit = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length && failure === undefined) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) return;
      try {
        checkAbort(controller.signal);
        const result = await prepare(item, index, controller.signal);
        checkAbort(controller.signal);
        if (publication === 'ready') {
          // The callback is synchronous: expected revisions and canonical cue order
          // still serialize even when independent chapters finish out of order.
          commit(result, item, index);
          continue;
        }
        ready.set(index, result);
        while (ready.has(nextCommit)) {
          const prepared = ready.get(nextCommit);
          const source = items[nextCommit];
          if (prepared === undefined || source === undefined)
            throw new AppError("CHAPTER_INVALID", "章节协调状态无效");
          checkAbort(controller.signal);
          commit(prepared, source, nextCommit);
          ready.delete(nextCommit++);
        }
      } catch (error) {
        failure ??= error;
        controller.abort();
      }
    }
  };
  try {
    await Promise.all(
      Array.from(
        {
          length: Math.min(items.length, Math.max(1, Math.min(3, concurrency))),
        },
        () => worker(),
      ),
    );
    if (failure !== undefined) throw failure;
    checkAbort(signal);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
