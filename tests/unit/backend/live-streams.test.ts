import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { LiveProviderStreams } from "../../../src/main/services/providers/lib/live-streams";
import { providerDiagnosticSchema, type ProviderDiagnostic } from "../../../src/shared/provider-diagnostics-contracts";

function record(): ProviderDiagnostic {
  const id = randomUUID();
  return providerDiagnosticSchema.parse({ id, runId: "run", jobId: "job", operation: "review",
    model: "test", profileId: "test", protocol: "openai", mode: "responses", state: "waiting",
    attempt: 0, targetCount: 1, promptBytes: 1, streamRequested: true, timeoutMs: 1000,
    textTimeoutMs: 1000, startedAt: Date.now(), elapsedMs: 0, wireBytes: 0, textBytes: 0,
    events: 0, heartbeats: 0, artifact: `${id}/answer.partial.txt` });
}
describe("session-only bounded provider content", () => {
  afterEach(() => vi.useRealTimers());
  it("caps both channels and keeps Unicode suffixes and independent requests", () => {
    const streams = new LiveProviderStreams(); const first = record(); const second = record();
    streams.start(first); streams.start(second);
    streams.append(first.id, "thinking", "😀".repeat(18000));
    streams.append(first.id, "answer", "x".repeat(33000));
    const snapshot = streams.list({ requestId: first.id })[0];
    expect(snapshot).toMatchObject({ thinkingTruncated: true, answerTruncated: true, phase: "answer" });
    expect(snapshot?.thinkingText.length).toBeLessThanOrEqual(32000);
    expect(snapshot?.thinkingText.startsWith("😀")).toBe(true);
    expect(snapshot?.answerText).toHaveLength(32000);
    expect(streams.list({ requestId: second.id })[0]).toMatchObject({ phase: "waiting", thinkingText: "", answerText: "" });
    if (snapshot) snapshot.answerText = "mutated renderer copy";
    expect(streams.list({ requestId: first.id })[0]?.answerText).toHaveLength(32000);
  });
  it("expires terminal requests after ten minutes, bounds request count, and retains active streams", () => {
    const streams = new LiveProviderStreams(); const ended = record(); const active = record();
    streams.start(ended); streams.update({ ...ended, state: "cancelled" }); streams.start(active);
    expect(streams.list()[1]?.phase).toBe("cancelled");
    expect(streams.list({}, Date.now() + 600001).map((entry) => entry.requestId)).toEqual([active.id]);
    for (let index = 0; index < 12; index++) streams.start(record());
    expect(streams.list()).toHaveLength(8);
  });
  it("destroys ended content on its timer even without another list request", () => {
    vi.useFakeTimers();
    const streams = new LiveProviderStreams(); const ended = record();
    streams.start(ended); streams.append(ended.id, "thinking", "temporary thought");
    streams.update({ ...ended, state: "transport_complete" });
    vi.advanceTimersByTime(599999);
    expect(streams.list({ requestId: ended.id })).toHaveLength(1);
    // Later validated/published states must not extend the retention deadline.
    streams.update({ ...ended, state: "published" });
    vi.advanceTimersByTime(1);
    // An earlier query clock demonstrates timer cleanup rather than lazy pruning.
    expect(streams.list({}, ended.startedAt)).toEqual([]);
  });
  it.each([
    ["transport_complete", "complete"], ["validated", "complete"], ["published", "complete"],
    ["failed", "failed"], ["interrupted", "failed"], ["cancelled", "cancelled"],
  ] as const)("maps %s to %s while retaining the received content", (state, phase) => {
    const streams = new LiveProviderStreams(); const request = record();
    streams.start(request); streams.append(request.id, "thinking", "thought");
    streams.append(request.id, "answer", "answer prefix");
    streams.update({ ...request, state, wireBytes: 128, textBytes: 13, elapsedMs: 2000 });
    expect(streams.list()[0]).toMatchObject({ state, phase, thinkingText: "thought", answerText: "answer prefix", wireBytes: 128, answerBytes: 13, elapsedMs: 2000 });
  });
  it("applies both filters, rejects unknown filter fields, and never restores cleared or previous-session content", () => {
    const streams = new LiveProviderStreams(); const request = record();
    streams.start(request); streams.append(request.id, "thinking", "private to session");
    expect(streams.list({ requestId: request.id, jobId: "other" })).toEqual([]);
    expect(streams.list({ requestId: request.id, jobId: request.jobId })).toHaveLength(1);
    expect(() => streams.list({ requestId: "not-a-uuid" })).toThrow();
    const unknownFilter = { jobId: "job", unknown: true };
    expect(() => streams.list(unknownFilter)).toThrow();
    expect(new LiveProviderStreams().list()).toEqual([]);
    streams.clear(request.id); streams.append(request.id, "thinking", "late delta");
    streams.update({ ...request, state: "published" });
    expect(streams.list()).toEqual([]);
  });
});
