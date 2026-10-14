import { randomUUID } from "node:crypto";
import type { Profile } from "../../../../shared/contracts";
import type { ProviderDiagnostic, TextOperation } from "../../../../shared/provider-diagnostics-contracts";
import type { ProviderDiagnosticsRepository, DiagnosticWriter } from "../../../db/provider-diagnostics";
import { AppError, checkAbort } from "../../../lib/errors";
import { StreamProtocol, SseFramer, normalizedUsage } from "./stream-protocol";

export type TextRequestContext = {
  diagnostics: ProviderDiagnosticsRepository; operation: TextOperation; jobId?: string;
  runId?: string; chapterId?: string; targetCount?: number; attempt?: number;
  onProgress?: (record: ProviderDiagnostic) => void;
  onRequestComplete?: (requestId: string) => void;
};
const pendingRequests = new Set<Promise<void>>();
const requestControllers = new Set<AbortController>();
/** Also cancels standalone text capability tests that have no Job lease. */
export function cancelAllTextRequests(): void {
  for (const controller of requestControllers) controller.abort(new AppError("CANCELLED", "操作已取消"));
}
/** After cancelling jobs, await local file/SQL finalizers before closing SQLite. */
export async function waitForTextRequestsIdle(): Promise<void> {
  while (pendingRequests.size) await Promise.all([...pendingRequests]);
}
function codePhase(code: string): ProviderDiagnostic["errorPhase"] {
  if (code === "PROVIDER_HEADER_TIMEOUT") return "headers";
  if (code === "PROVIDER_IDLE_TIMEOUT") return "idle";
  if (code === "PROVIDER_OVERALL_TIMEOUT") return "overall";
  if (code === "CANCELLED") return "cancel";
  if (code === "DIAGNOSTIC_STORAGE") return "storage";
  if (code === "NETWORK_ERROR") return "network";
  if (["PROVIDER_HTTP", "RATE_LIMIT", "AUTH_ERROR"].includes(code)) return "http";
  return "protocol";
}
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** No transport retry after generation starts, or after deadline/network ambiguity. */
export async function requestText(
  profile: Profile, url: string, init: RequestInit,
  extract: (raw: unknown) => string, signal?: AbortSignal, context?: TextRequestContext, promptBytes = 0,
): Promise<string> {
  checkAbort(signal);
  let settle: (() => void) | undefined;
  const completion = new Promise<void>((resolve) => { settle = resolve; });
  pendingRequests.add(completion);
  const startedAt = Date.now();
  const controller = new AbortController();
  requestControllers.add(controller);
  const onCancel = (): void => controller.abort(new AppError("CANCELLED", "操作已取消"));
  signal?.addEventListener("abort", onCancel, { once: true });
  const timeoutMs = profile.timeoutMs;
  const textTimeoutMs = profile.textTimeoutMs ?? 1800000;
  let headerTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const overallTimer = setTimeout(() => controller.abort(new AppError("PROVIDER_OVERALL_TIMEOUT", "AI 生成超过总时限；已收到内容已保留，请调整总时限后手动重试。")), textTimeoutMs);
  let writer: DiagnosticWriter | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let output = "";
  let textBytes = 0;
  let wireBytes = 0;
  let lastProgress = 0;
  let lastActivity = Date.now();
  let sinkTask = Promise.resolve();
  let checkpointTimer: ReturnType<typeof setInterval> | undefined;
  let isCheckpointQueued = false;
  const writeSink = (work: () => Promise<void>): Promise<void> => {
    const next = sinkTask.then(work);
    sinkTask = next.catch(() => {});
    return next;
  };
  const stopCheckpoints = async (): Promise<void> => {
    if (checkpointTimer) clearInterval(checkpointTimer);
    checkpointTimer = undefined;
    await sinkTask;
  };
  const progress = (): void => {
    if (writer && Date.now() - lastProgress >= 500) { lastProgress = Date.now(); context?.onProgress?.({ ...writer.record }); }
  };
  const clearIdle = (): void => { if (idleTimer) clearTimeout(idleTimer); idleTimer = undefined; };
  const armIdle = (): void => {
    clearIdle(); idleTimer = setTimeout(() => controller.abort(new AppError("PROVIDER_IDLE_TIMEOUT", "AI 输出长时间没有有效活动；已收到内容已保留，请手动重试。")), Math.max(1, timeoutMs - (Date.now() - lastActivity)));
  };
  const resetIdle = (): void => { lastActivity = Date.now(); armIdle(); };
  const answer = async (value: string): Promise<void> => {
    checkAbort(signal);
    if (controller.signal.aborted) throw controller.signal.reason;
    textBytes += Buffer.byteLength(value);
    if (textBytes > 4_000_000) throw new AppError("RESPONSE_LIMIT", "AI 返回内容过大");
    if (writer && value) await writeSink(() => writer?.append(value) ?? Promise.resolve());
    output += value;
    progress();
  };
  try {
    if (context) writer = await context.diagnostics.begin({
      runId: context.runId ?? randomUUID(), jobId: context.jobId, chapterId: context.chapterId,
      operation: context.operation, profileId: profile.id, model: profile.model,
      protocol: profile.protocol, mode: profile.mode, attempt: context.attempt ?? 0,
      targetCount: context.targetCount ?? 0, promptBytes,
      streamRequested: profile.streaming !== "disabled", timeoutMs, textTimeoutMs, startedAt,
    });
    if (writer) checkpointTimer = setInterval(() => {
      if (isCheckpointQueued || controller.signal.aborted) return;
      isCheckpointQueued = true;
      void writeSink(async () => { await writer?.checkpoint(); progress(); }).catch((error: unknown) => {
        controller.abort(error instanceof AppError ? error : new AppError("DIAGNOSTIC_STORAGE", "AI 请求日志无法保存，请检查磁盘空间。"));
      }).finally(() => { isCheckpointQueued = false; });
    }, 500);
    progress();
    // Header deadline starts at actual network dispatch, not while awaiting local storage.
    headerTimer = setTimeout(() => controller.abort(new AppError("PROVIDER_HEADER_TIMEOUT", "AI 服务未在时限内返回响应头，请检查接口地址和网络。")), timeoutMs);
    const abortPromise = aborted(controller.signal);
    const response = await Promise.race([fetch(url, { ...init, signal: controller.signal }), abortPromise]);
    clearTimeout(headerTimer); headerTimer = undefined;
    if (writer) Object.assign(writer.record, { headersAt: Date.now(), httpStatus: response.status });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(response.status === 401 || response.status === 403 ? "AUTH_ERROR" : response.status === 429 ? "RATE_LIMIT" : "PROVIDER_HTTP", `AI 接口请求失败（HTTP ${response.status}）。如接口不支持流式输出，请在 API 设置中关闭流式并手动重试。`);
    }
    if (!response.body) throw new AppError("STREAM_INCOMPLETE", "AI 未返回响应内容");
    const sse = (response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream");
    if (writer) Object.assign(writer.record, { streamActual: sse, state: "receiving" });
    reader = response.body.getReader();
    const protocol = new StreamProtocol(profile);
    const framer = new SseFramer(async (data, event) => {
      const delta = protocol.event(data, event);
      if (writer) { writer.record.events++; writer.record.usage = delta.usage ?? writer.record.usage; if (delta.heartbeat) writer.record.heartbeats++; }
      resetIdle();
      // Disk backpressure is local I/O, not a network idle condition; overall still applies.
      clearIdle(); if (delta.text) await answer(delta.text); resetIdle();
      if (delta.error) throw delta.error;
    }, () => { if (writer) writer.record.heartbeats++; resetIdle(); progress(); });
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let json = "";
    resetIdle();
    for (;;) {
      const next = await Promise.race([reader.read(), abortPromise]);
      if (next.done) break;
      wireBytes += next.value.byteLength;
      if (wireBytes > 16_000_000) throw new AppError("RESPONSE_LIMIT", "AI 返回内容过大");
      if (writer) {
        writer.record.wireBytes = wireBytes; writer.record.firstByteAt ??= Date.now(); writer.record.lastByteAt = Date.now();
      }
      if (sse) {
        await framer.push(next.value);
        // SSE completion is semantic: a provider may keep the HTTP connection
        // open after its terminal event. Do not wait for idle timeout or EOF.
        if (protocol.done) { await reader.cancel(); break; }
      }
      else {
        if (wireBytes > 4_000_000) throw new AppError("RESPONSE_LIMIT", "AI 返回内容过大");
        try { json += decoder.decode(next.value, { stream: true }); } catch { throw new AppError("STREAM_PROTOCOL", "AI 响应编码无效"); }
        // Non-stream compatibility queue whitespace is liveness, never claimed answer progress.
        resetIdle();
      }
      const storageStart = Date.now(); clearIdle(); await writeSink(() => writer?.checkpoint() ?? Promise.resolve()); lastActivity += Date.now() - storageStart; progress(); armIdle();
    }
    clearIdle();
    if (sse) {
      await framer.push(new Uint8Array(), true); protocol.eof();
      if (writer) { writer.record.finishReason = protocol.finishReason; writer.record.usage = protocol.usage ?? writer.record.usage; }
    } else {
      let raw: unknown;
      try { json += decoder.decode(); raw = JSON.parse(json); } catch { throw new AppError("INVALID_JSON", "AI 返回的 JSON 不完整或无效"); }
      let text: string;
      try { text = extract(raw); }
      catch (error) { if (error instanceof AppError) throw error; throw new AppError("STREAM_PROTOCOL", "AI 响应不符合所选协议，请检查 API 配置。"); }
      await answer(text);
      if (writer && raw && typeof raw === "object") {
        const value = raw as Record<string, unknown>;
        writer.record.usage = normalizedUsage(value.usage ?? value.usageMetadata, profile.protocol);
      }
    }
    if (!output) throw new AppError("REFUSAL", "AI 未返回可用内容");
    await stopCheckpoints();
    if (controller.signal.aborted) throw controller.signal.reason;
    await writer?.finish("transport_complete");
    if (writer) { context?.onProgress?.({ ...writer.record }); context?.onRequestComplete?.(writer.record.id); }
    return output;
  } catch (error) {
    await stopCheckpoints();
    const failure = signal?.aborted ? new AppError("CANCELLED", "操作已取消") : controller.signal.aborted && controller.signal.reason instanceof AppError ? controller.signal.reason : error instanceof AppError ? error : new AppError("NETWORK_ERROR", "AI 网络连接中断；已收到内容已保留，请检查网络后手动重试。");
    controller.abort(failure);
    try { await reader?.cancel(); } catch { /* fetch cancellation may reject the already failed body */ }
    await writer?.finish(failure.code === "CANCELLED" ? "cancelled" : "failed", failure.code, codePhase(failure.code));
    if (writer) context?.onProgress?.({ ...writer.record });
    throw failure;
  } finally {
    clearTimeout(overallTimer); if (headerTimer) clearTimeout(headerTimer); clearIdle();
    if (checkpointTimer) clearInterval(checkpointTimer);
    signal?.removeEventListener("abort", onCancel);
    try { reader?.releaseLock(); }
    finally { requestControllers.delete(controller); pendingRequests.delete(completion); settle?.(); }
  }
}
