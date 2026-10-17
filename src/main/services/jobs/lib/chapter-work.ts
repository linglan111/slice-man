import type { AiWorkProgress, AiWorkRequest, Chapter, Segment } from "../../../../shared/contracts";
import { AppError, checkAbort } from "../../../lib/errors";

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
          length: Math.min(items.length, Math.max(1, Math.min(16, concurrency))),
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

/** A phase snapshot contains every chapter, including tasks waiting for API slots. */
export class ChapterProgress {
  private readonly startedAt = Date.now();
  private readonly requests: AiWorkRequest[];
  constructor(
    private readonly runId: string,
    private readonly operation: string,
    private readonly phase: string,
    groups: { chapter: Chapter; targets: Segment[] }[],
    private readonly emit: (work: AiWorkProgress) => void,
    private readonly round?: number,
    private readonly maxRounds?: number,
  ) {
    this.requests = groups.map(({ chapter, targets }) => ({
      id: `${runId}:${phase}:${chapter.id}`, chapterId: chapter.id, label: chapter.title,
      state: "queued", targetCount: targets.length,
    }));
    this.publish();
  }
  state(index: number, state: AiWorkRequest["state"], code?: string): void {
    const row = this.requests[index];
    if (!row) return;
    row.state = state;
    if (state === "running") row.startedAt ??= Date.now();
    if (["completed", "failed", "cancelled"].includes(state)) row.endedAt = Date.now();
    row.code = code;
    this.publish();
  }
  finish(error?: unknown): void {
    for (const [index, row] of this.requests.entries())
      if (["queued", "running"].includes(row.state))
        this.state(index, error instanceof AppError && error.code === "CANCELLED" ? "cancelled" : "failed", error instanceof AppError ? error.code : "OPERATION_FAILED");
  }
  private publish(): void {
    const complete = this.requests.filter((row) => row.state === "completed");
    this.emit({ runId: this.runId, operation: this.operation, phase: this.phase, round: this.round, maxRounds: this.maxRounds,
      startedAt: this.startedAt, targetsCompleted: complete.reduce((n, row) => n + row.targetCount, 0),
      targetsTotal: this.requests.reduce((n, row) => n + row.targetCount, 0),
      chaptersCompleted: complete.length, chaptersTotal: this.requests.length, requests: structuredClone(this.requests) });
  }
}
