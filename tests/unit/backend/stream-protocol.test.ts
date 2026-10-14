import { describe, expect, it } from "vitest";
import { StreamProtocol, SseFramer } from "../../../src/main/services/providers/lib/stream-protocol";
import type { Profile } from "../../../src/shared/contracts";

const base: Profile = { id: "p", name: "fixture", baseUrl: "http://127.0.0.1", protocol: "openai", mode: "chat", model: "fixture", timeoutMs: 1000, maxUploadBytes: 1000, structuredOutput: true, sessionOnly: true, hasKey: true };
const chat = (delta: unknown, finish_reason: unknown = null, index = 0): string => JSON.stringify({ id: "one", choices: [{ index, delta, finish_reason }] });
describe("strict streamed protocol completion", () => {
  it("accepts final usage-only chat frames and cumulative counters without adding reasoning text", () => {
    const p = new StreamProtocol(base);
    expect(p.event(chat({ reasoning_content: "private" })).text).toBe("");
    expect(p.event(chat({ content: "{}" })).text).toBe("{}");
    p.event(chat({}, "stop"));
    p.event(JSON.stringify({ id: "one", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_cache_hit_tokens: 4 } }));
    p.event("[DONE]"); p.eof();
    expect(p.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedTokens: 4 });
    expect(() => p.event(chat({ content: "late" }))).toThrow();
  });
  it.each([
    chat({ content: "{}" }, null, 1),
    chat({ content: "{}", tool_calls: [] }),
    chat({ content: "{}", refusal: "blocked" }),
    JSON.stringify({ id: "two", choices: [{ index: 0, delta: { content: "{}" } }] }),
  ])("rejects incompatible chat identity/index/refusal/tool content %#", (invalid) => {
    const p = new StreamProtocol(base); p.event(chat({ content: "{" }));
    expect(() => p.event(invalid)).toThrow();
  });
  it("JSON-looking content without a normal semantic terminal is incomplete", () => {
    const p = new StreamProtocol(base); p.event(chat({ content: "{}" }));
    expect(() => p.eof()).toThrowError(expect.objectContaining({ code: "STREAM_INCOMPLETE" }));
    expect(() => p.event("[DONE]")).toThrow();
  });
  it.each(["response.failed", "response.incomplete", "response.refusal.delta", "response.function_call_arguments.delta"])("rejects %s instead of treating it as success", (type) => {
    const p = new StreamProtocol({ ...base, mode: "responses" });
    expect(() => p.event(JSON.stringify({ type, delta: "{}" }))).toThrow();
  });
  it("checks Responses done text and refuses hidden tools in completed output", () => {
    const p = new StreamProtocol({ ...base, mode: "responses" });
    p.event(JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "{}" }));
    expect(() => p.event(JSON.stringify({ type: "response.output_text.done", output_index: 0, content_index: 0, text: "changed" }))).toThrow();
    expect(() => p.event(JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "function_call", name: "unsafe" }] } }))).toThrow();
  });
  it("requires Anthropic blocks to close and a normal stop reason before message_stop", () => {
    const p = new StreamProtocol({ ...base, protocol: "anthropic" });
    p.event(JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 7 } } }));
    p.event(JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "{}" } }));
    expect(() => p.event(JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } }))).toThrow();
    p.event(JSON.stringify({ type: "content_block_stop", index: 0 }));
    expect(() => p.event(JSON.stringify({ type: "message_stop" }))).toThrow();
    p.event(JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 8 } }));
    p.event(JSON.stringify({ type: "message_delta", delta: {}, usage: { output_tokens: 9 } }));
    p.event(JSON.stringify({ type: "message_stop" })); p.eof();
    expect(p.usage).toEqual({ inputTokens: 7, outputTokens: 9 });
  });
  it("does not save Gemini thought parts and preserves last text when max token termination fails", () => {
    const p = new StreamProtocol({ ...base, protocol: "gemini" });
    const delta = p.event(JSON.stringify({ candidates: [{ index: 0, content: { parts: [{ thought: true, text: "private" }, { text: "{partial" }] }, finishReason: "MAX_TOKENS" }] }));
    expect(delta.text).toBe("{partial"); expect(delta.error?.code).toBe("TRUNCATED");
    expect(() => p.eof()).toThrow();
  });
  it.each(["SAFETY", "RECITATION", "OTHER"])("refuses Gemini %s terminal", (finishReason) => {
    const p = new StreamProtocol({ ...base, protocol: "gemini" });
    expect(p.event(JSON.stringify({ candidates: [{ index: 0, content: { parts: [{ text: "{}" }] }, finishReason }] })).error?.code).toBe("REFUSAL");
  });
  it("bounds individual SSE frames, not a network chunk containing many valid frames", async () => {
    let events = 0;
    const framer = new SseFramer(async () => { events++; }, () => {});
    await framer.push(Buffer.from('data: {"value":"hello world"}\n\n'.repeat(10000)));
    expect(events).toBe(10000);
    await framer.push(new Uint8Array(), true);
    const oversized = new SseFramer(async () => {}, () => {});
    await expect(oversized.push(Buffer.from("data: " + "x".repeat(262145)))).rejects.toMatchObject({ code: "RESPONSE_LIMIT" });
  });
});
