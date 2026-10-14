import type { Profile } from "../../../../shared/contracts";
import type { ProviderUsage } from "../../../../shared/provider-diagnostics-contracts";
import { AppError } from "../../../lib/errors";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as ObjectValue;
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) fail(); return value; }
function fail(): never { throw new AppError("STREAM_PROTOCOL", "AI 流式响应格式无效，请检查协议或更换模型。"); }
function text(value: unknown): string { if (typeof value !== "string") fail(); return value; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
export function normalizedUsage(raw: unknown, protocol: Profile["protocol"]): ProviderUsage | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const u = raw as ObjectValue;
  const completionDetails = u.completion_tokens_details ?? u.output_tokens_details;
  const promptDetails = u.prompt_tokens_details ?? u.input_tokens_details;
  const details = completionDetails && typeof completionDetails === "object" ? completionDetails as ObjectValue : {};
  const inputDetails = promptDetails && typeof promptDetails === "object" ? promptDetails as ObjectValue : {};
  const pairs: ProviderUsage = protocol === "gemini" ? {
    inputTokens: number(u.promptTokenCount), outputTokens: number(u.candidatesTokenCount), totalTokens: number(u.totalTokenCount), cachedTokens: number(u.cachedContentTokenCount), reasoningTokens: number(u.thoughtsTokenCount),
  } : {
    inputTokens: number(u.prompt_tokens ?? u.input_tokens), outputTokens: number(u.completion_tokens ?? u.output_tokens), totalTokens: number(u.total_tokens), cachedTokens: number(u.prompt_cache_hit_tokens ?? u.cache_read_input_tokens ?? inputDetails.cached_tokens), reasoningTokens: number(details.reasoning_tokens),
  };
  const entries = Object.entries(pairs).filter(([, value]) => value !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}
function stop(value: unknown, good: string, truncated: string): string {
  if (value === truncated) throw new AppError("TRUNCATED", "AI 返回内容被截断，请减小批次或更换模型。");
  if (value !== good) throw new AppError("REFUSAL", "AI 未完成正常文本输出，请检查模型能力。");
  return good;
}
export type ProtocolDelta = { text?: string; heartbeat?: boolean; usage?: ProviderUsage; error?: AppError };

/** Protocol semantics are independent of network/SSE chunk boundaries. */
export class StreamProtocol {
  done = false;
  finishReason?: string;
  usage?: ProviderUsage;
  private chatFinished = false;
  private identity?: string;
  private anthropicStarted = false;
  private anthropicStopped = false;
  private blocks = new Map<number, string>();
  private responseParts = new Map<string, string>();
  private completedResponseParts = new Set<string>();
  private geminiFinished = false;
  constructor(private readonly profile: Profile) {}
  event(data: string, event = ""): ProtocolDelta {
    if (data === "[DONE]") {
      if (this.profile.protocol !== "openai" || this.profile.mode === "responses" || !this.chatFinished || this.done) fail();
      this.done = true; return { heartbeat: true };
    }
    let raw: unknown;
    try { raw = JSON.parse(data); } catch { fail(); }
    const r = object(raw);
    if (this.done) fail();
    if (r.error || event === "error" || r.type === "error") throw new AppError("PROVIDER_STREAM_ERROR", "AI 服务在输出过程中报告错误；已收到内容已保留，请手动重试。");
    if (typeof r.id === "string") {
      if (this.identity && this.identity !== r.id) fail();
      this.identity = r.id;
    }
    if (this.profile.protocol === "anthropic") return this.anthropic(r, event);
    if (this.profile.protocol === "gemini") return this.gemini(r);
    if (this.profile.mode === "responses") return this.responses(r);
    const usage = normalizedUsage(r.usage, "openai");
    if (usage) this.usage = { ...this.usage, ...usage };
    const choices = array(r.choices);
    if (!choices.length) return { heartbeat: true, usage };
    if (choices.length !== 1) fail();
    const first = object(choices[0]);
    if (first.index !== undefined && first.index !== 0) fail();
    const delta = object(first.delta ?? {});
    if (delta.tool_calls || delta.function_call || delta.refusal) throw new AppError("REFUSAL", "AI 未返回可用文本内容");
    if (this.chatFinished && (delta.content || delta.reasoning_content)) fail();
    if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) text(delta.reasoning_content);
    const answer = delta.content === undefined || delta.content === null ? "" : text(delta.content);
    if (first.finish_reason !== undefined && first.finish_reason !== null) {
      if (this.chatFinished) fail();
      // A terminal truncation can accompany the last valid text delta. Preserve it
      // in the diagnostic file before rejecting the operation, never publish it.
      try { this.finishReason = stop(first.finish_reason, "stop", "length"); }
      catch (error) { if (error instanceof AppError) return { text: answer, error }; throw error; }
      this.chatFinished = true;
    }
    return { text: answer, heartbeat: !answer, usage };
  }
  private responses(r: ObjectValue): ProtocolDelta {
    const type = text(r.type);
    if (["response.failed", "response.incomplete", "response.refusal.delta", "response.refusal.done"].includes(type)) throw new AppError(type === "response.incomplete" ? "TRUNCATED" : "REFUSAL", "AI 未完成正常输出");
    if (type.includes("function_call") || type.includes("tool_call")) throw new AppError("REFUSAL", "AI 返回了工具调用，未返回可用文本");
    if (type === "response.output_text.delta") {
      if (r.output_index !== 0 || !Number.isInteger(r.content_index) || Number(r.content_index) < 0 || Number(r.content_index) > 32) fail();
      const key = `${r.output_index}:${r.content_index}`;
      if (this.completedResponseParts.has(key)) fail();
      const answer = text(r.delta); this.responseParts.set(key, (this.responseParts.get(key) ?? "") + answer);
      return { text: answer };
    }
    if (type === "response.output_text.done") {
      const key = `${r.output_index}:${r.content_index}`;
      if (this.completedResponseParts.has(key) || text(r.text) !== this.responseParts.get(key)) fail();
      this.completedResponseParts.add(key);
    }
    if (type === "response.completed") {
      const response = object(r.response);
      stop(response.status, "completed", "incomplete");
      if (response.error || response.incomplete_details) fail();
      if (response.output !== undefined) {
        const output = array(response.output);
        let finalText = "";
        for (const item of output) {
          const value = object(item);
          if (value.type === "reasoning") continue;
          if (value.type !== "message") throw new AppError("REFUSAL", "AI 返回了工具调用，未返回可用文本");
          for (const part of array(value.content)) {
            const content = object(part);
            if (content.type !== "output_text") throw new AppError("REFUSAL", "AI 未完成正常文本输出");
            finalText += text(content.text);
          }
        }
        if (finalText !== [...this.responseParts.values()].join("")) fail();
      }
      this.usage = normalizedUsage(response.usage, "openai");
      this.finishReason = "completed"; this.done = true;
    }
    if (!["response.output_text.done", "response.completed", "response.created", "response.in_progress", "response.output_item.added", "response.output_item.done", "response.content_part.added", "response.content_part.done", "response.reasoning_summary_part.added", "response.reasoning_summary_part.done", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done", "response.reasoning_text.delta", "response.reasoning_text.done"].includes(type)) fail();
    if (r.item && object(r.item).type !== "message" && object(r.item).type !== "reasoning") throw new AppError("REFUSAL", "AI 返回了工具调用");
    return { heartbeat: true, usage: this.usage };
  }
  private anthropic(r: ObjectValue, event: string): ProtocolDelta {
    const type = text(r.type);
    if (event && event !== type) fail();
    if (type === "ping") return { heartbeat: true };
    if (type === "message_start") {
      if (this.anthropicStarted) fail();
      this.anthropicStarted = true; const message = object(r.message);
      this.usage = normalizedUsage(message.usage, "anthropic");
    } else if (!this.anthropicStarted) fail();
    if (type === "content_block_start") {
      const index = number(r.index); if (index === undefined || index > 32 || this.blocks.has(index)) fail();
      const block = object(r.content_block); const kind = text(block.type);
      if (kind === "tool_use") throw new AppError("REFUSAL", "AI 返回了工具调用");
      if (!["text", "thinking", "redacted_thinking"].includes(kind)) fail();
      this.blocks.set(index, kind);
      return { text: kind === "text" ? text(block.text) : "", heartbeat: kind !== "text" };
    }
    if (type === "content_block_delta") {
      const index = number(r.index); if (index === undefined || !this.blocks.has(index)) fail();
      const delta = object(r.delta);
      if (delta.type === "text_delta") { if (this.blocks.get(index) !== "text") fail(); return { text: text(delta.text) }; }
      if (!["thinking_delta", "signature_delta"].includes(String(delta.type)) || this.blocks.get(index) !== "thinking") fail();
      text(delta.type === "thinking_delta" ? delta.thinking : delta.signature);
      return { heartbeat: true };
    }
    if (type === "content_block_stop") { const index = number(r.index); if (index === undefined || !this.blocks.delete(index)) fail(); }
    if (type === "message_delta") {
      if (this.blocks.size) fail();
      const delta = object(r.delta);
      if (delta.stop_reason !== undefined && delta.stop_reason !== null) { this.finishReason = stop(delta.stop_reason, "end_turn", "max_tokens"); this.anthropicStopped = true; }
      const usage = normalizedUsage(r.usage, "anthropic"); this.usage = { ...this.usage, ...usage };
    }
    if (type === "message_stop") { if (!this.anthropicStopped || this.blocks.size) fail(); this.done = true; }
    if (!["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"].includes(type)) fail();
    return { heartbeat: true, usage: this.usage };
  }
  private gemini(r: ObjectValue): ProtocolDelta {
    this.usage = normalizedUsage(r.usageMetadata, "gemini") ?? this.usage;
    const candidates = array(r.candidates ?? []);
    if (!candidates.length) {
      if (r.promptFeedback) throw new AppError("REFUSAL", "AI 未返回可用文本");
      return { heartbeat: true, usage: this.usage };
    }
    if (candidates.length !== 1) fail();
    const first = object(candidates[0]); if (first.index !== undefined && first.index !== 0) fail();
    if (this.geminiFinished) fail();
    const parts = first.content ? array(object(first.content).parts) : [];
    const answer = parts.map((part) => {
      const p = object(part); if (p.functionCall) throw new AppError("REFUSAL", "AI 返回了工具调用");
      return p.thought ? "" : p.text === undefined ? "" : text(p.text);
    }).join("");
    if (first.finishReason !== undefined) {
      try { this.finishReason = stop(first.finishReason, "STOP", "MAX_TOKENS"); }
      catch (error) { if (error instanceof AppError) return { text: answer, error }; throw error; }
      this.geminiFinished = true;
    }
    return { text: answer, heartbeat: !answer, usage: this.usage };
  }
  eof(): void {
    if (this.profile.protocol === "gemini" && this.geminiFinished) this.done = true;
    if (!this.done) throw new AppError("STREAM_INCOMPLETE", "AI 响应在完成前中断；已收到内容已保留，请手动重试。");
  }
}

/** Bounded UTF8 SSE framing; comments signal liveness but never become saved text. */
export class SseFramer {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private pending = "";
  private data: string[] = [];
  private event = "";
  private frameBytes = 0;
  private count = 0;
  constructor(private readonly dispatch: (data: string, event: string) => Promise<void>, private readonly heartbeat: () => void) {}
  async push(bytes: Uint8Array, final = false): Promise<void> {
    try { this.pending += this.decoder.decode(bytes, { stream: !final }); } catch { fail(); }
    for (;;) {
      const match = /[\r\n]/.exec(this.pending); if (!match) break;
      if (this.pending[match.index] === "\r" && match.index === this.pending.length - 1 && !final) break;
      const line = this.pending.slice(0, match.index);
      const width = this.pending[match.index] === "\r" && this.pending[match.index + 1] === "\n" ? 2 : 1;
      this.pending = this.pending.slice(match.index + width);
      if (!line) {
        if (this.data.length) { if (++this.count > 100000) throw new AppError("RESPONSE_LIMIT", "AI 流式事件过多"); await this.dispatch(this.data.join("\n"), this.event); }
        this.data = []; this.event = ""; this.frameBytes = 0; continue;
      }
      this.frameBytes += Buffer.byteLength(line);
      if (this.frameBytes > 262144) throw new AppError("RESPONSE_LIMIT", "AI 流式响应帧过大");
      if (line.startsWith(":")) { this.heartbeat(); continue; }
      const colon = line.indexOf(":"); const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "data") this.data.push(value);
      if (field === "event") this.event = value;
    }
    if (Buffer.byteLength(this.pending) > 262144) throw new AppError("RESPONSE_LIMIT", "AI 流式响应帧过大");
    if (final && (this.pending.trim() || this.data.length)) throw new AppError("STREAM_INCOMPLETE", "AI 流式响应缺少完整终止帧");
  }
}
