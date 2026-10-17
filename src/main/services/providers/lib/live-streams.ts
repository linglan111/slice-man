import { diagnosticsLiveInputSchema } from "../../../../shared/provider-diagnostics-contracts";
import type { DiagnosticsLiveInput, ProviderDiagnostic, ProviderLiveSnapshot } from "../../../../shared/provider-diagnostics-contracts";

const CAPACITY = 128;
const TEXT_LIMIT = 32000;
const RETENTION_MS = 10 * 60 * 1000;
type Entry = { snapshot: ProviderLiveSnapshot; endedAt?: number; expiryTimer?: ReturnType<typeof setTimeout> };

/** Per-repository session memory. Never serialized, logged or restored from disk. */
export class LiveProviderStreams {
  private readonly entries = new Map<string, Entry>();
  private prune(now: number): void {
    for (const [id, entry] of this.entries) {
      if (entry.endedAt !== undefined && now - entry.endedAt >= RETENTION_MS) this.clear(id);
    }
  }
  start(record: ProviderDiagnostic): void {
    this.prune(Date.now());
    while (this.entries.size >= CAPACITY) {
      const oldest = [...this.entries].find(([, entry]) => entry.endedAt !== undefined) ?? this.entries.entries().next().value;
      if (!oldest) break;
      this.clear(oldest[0]);
    }
    this.entries.set(record.id, { snapshot: {
      requestId: record.id, jobId: record.jobId, operation: record.operation, model: record.model,
      runId: record.runId, chapterId: record.chapterId,
      state: record.state, phase: "waiting", startedAt: record.startedAt, updatedAt: record.startedAt,
      elapsedMs: 0, wireBytes: 0, answerBytes: 0, thinkingText: "", answerText: "",
      thinkingTruncated: false, answerTruncated: false,
    } });
  }
  append(id: string, kind: "thinking" | "answer", text: string): void {
    const entry = this.entries.get(id);
    if (!entry || !text) return;
    const field = kind === "thinking" ? "thinkingText" : "answerText";
    const truncated = kind === "thinking" ? "thinkingTruncated" : "answerTruncated";
    const value = entry.snapshot[field] + text;
    // Avoid splitting a Unicode surrogate pair at the retained suffix boundary.
    let offset = Math.max(0, value.length - TEXT_LIMIT);
    if (offset && /[\uDC00-\uDFFF]/.test(value[offset] ?? "")) offset++;
    entry.snapshot[field] = value.slice(offset);
    entry.snapshot[truncated] ||= offset > 0;
    entry.snapshot.phase = kind;
    entry.snapshot.updatedAt = Date.now();
  }
  update(record: ProviderDiagnostic): void {
    const entry = this.entries.get(record.id);
    if (!entry) return;
    Object.assign(entry.snapshot, { state: record.state, elapsedMs: record.elapsedMs,
      wireBytes: record.wireBytes, answerBytes: record.textBytes, updatedAt: Date.now() });
    if (!["waiting", "receiving"].includes(record.state)) {
      entry.snapshot.phase = record.state === "cancelled" ? "cancelled"
        : ["failed", "interrupted"].includes(record.state) ? "failed" : "complete";
      if (entry.endedAt === undefined) {
        entry.endedAt = Date.now();
        entry.expiryTimer = setTimeout(() => this.clear(record.id), RETENTION_MS);
        entry.expiryTimer.unref();
      }
    }
  }
  list(input: DiagnosticsLiveInput = {}, now = Date.now()): ProviderLiveSnapshot[] {
    const parsed = diagnosticsLiveInputSchema.parse(input);
    this.prune(now);
    return [...this.entries.values()].filter(({ snapshot }) =>
      (!parsed.jobId || snapshot.jobId === parsed.jobId) && (!parsed.requestId || snapshot.requestId === parsed.requestId),
    ).reverse().map(({ snapshot }) => ({ ...snapshot, elapsedMs: Math.max(snapshot.elapsedMs,
      ["waiting", "receiving"].includes(snapshot.state) ? now - snapshot.startedAt : 0) }));
  }
  clear(id: string): void {
    clearTimeout(this.entries.get(id)?.expiryTimer);
    this.entries.delete(id);
  }
}
