import { describe, expect, it } from "vitest";
import { StreamProtocol, SseFramer } from "../../../src/main/services/providers/lib/stream-protocol";
import type { Profile } from "../../../src/shared/contracts";
import { reasoningFirstResponses } from "../../fixtures/reasoning-first-responses";

const base: Profile = { id: "p", name: "fixture", baseUrl: "http://127.0.0.1", protocol: "openai", mode: "chat", model: "fixture", timeoutMs: 1000, maxUploadBytes: 1000, structuredOutput: true, sessionOnly: true, hasKey: true };
const chat = (delta: unknown, finish_reason: unknown = null, index = 0): string => JSON.stringify({ id: "one", choices: [{ index, delta, finish_reason }] });
describe("strict streamed protocol completion", () => {
  it("separates provider-visible thinking for all protocols and hides signatures", () => {
    expect(new StreamProtocol(base).event(chat({ reasoning_content: "thought", content: "answer" })))
      .toMatchObject({ thinking: "thought", text: "answer" });
    const responses = new StreamProtocol({ ...base, mode: "responses" });
    expect(responses.event(JSON.stringify({ type: "response.reasoning_text.delta", delta: "thought" })))
      .toMatchObject({ thinking: "thought", heartbeat: true });
    const anthropic = new StreamProtocol({ ...base, protocol: "anthropic" });
    anthropic.event(JSON.stringify({ type: "message_start", message: {} }));
    anthropic.event(JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    expect(anthropic.event(JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "thought" } }))).toMatchObject({ thinking: "thought" });
    expect(anthropic.event(JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "not-visible" } }))).not.toHaveProperty("thinking", "not-visible");
    const gemini = new StreamProtocol({ ...base, protocol: "gemini" });
    expect(gemini.event(JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: "thought" }, { text: "answer" }] } }] })))
      .toMatchObject({ thinking: "thought", text: "answer" });
  });

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
  it("accepts official reasoning-first Responses output indexes without emitting reasoning", () => {
    const p = new StreamProtocol({ ...base, mode: "responses" });
    const received = reasoningFirstResponses('{"name":"猫"}').map((value) => p.event(JSON.stringify(value)).text ?? "").join("");
    p.eof(); expect(received).toBe('{"name":"猫"}');
    expect(p.usage).toEqual({ inputTokens: 12, outputTokens: 7, reasoningTokens: 3 });
  });
  it("treats reasoning content and summary part lifecycles as heartbeat only", () => {
    const p = new StreamProtocol({ ...base, mode: "responses" });
    const frames = [
      { type: "response.output_item.added", output_index: 0, item: { id: "reasoning", type: "reasoning", content: [] } },
      { type: "response.content_part.added", output_index: 0, content_index: 0, item_id: "reasoning", part: { type: "reasoning_text", text: "" } },
      { type: "response.reasoning_text.delta", output_index: 0, content_index: 0, item_id: "reasoning", delta: "private" },
      { type: "response.reasoning_text.done", output_index: 0, content_index: 0, item_id: "reasoning", text: "private" },
      { type: "response.content_part.done", output_index: 0, content_index: 0, item_id: "reasoning", part: { type: "reasoning_text", text: "private" } },
      { type: "response.reasoning_summary_part.added", output_index: 0, summary_index: 0, item_id: "reasoning", part: { type: "summary_text", text: "" } },
      { type: "response.reasoning_summary_text.delta", output_index: 0, summary_index: 0, item_id: "reasoning", delta: "private summary" },
      { type: "response.reasoning_summary_text.done", output_index: 0, summary_index: 0, item_id: "reasoning", text: "private summary" },
      { type: "response.reasoning_summary_part.done", output_index: 0, summary_index: 0, item_id: "reasoning", part: { type: "summary_text", text: "private summary" } },
    ];
    for (const frame of frames) expect(p.event(JSON.stringify(frame))).toMatchObject({ heartbeat: true });
    p.event(JSON.stringify({ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "{}" }));
    p.event(JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ id: "reasoning", type: "reasoning", content: [{ type: "reasoning_text", text: "private" }], summary: [{ type: "summary_text", text: "private summary" }] }, { type: "message", content: [{ type: "output_text", text: "{}" }] }] } }));
    p.eof();
  });
  it("assembles multiple message/content parts in canonical order", () => {
    const p = new StreamProtocol({ ...base, mode: "responses" });
    let result = "";
    for (const [output, content, delta] of [[1, 0, "{"], [1, 1, '"ok":'], [2, 0, "true}"]] as const) {
      result += p.event(JSON.stringify({ type: "response.output_text.delta", output_index: output, content_index: content, item_id: `message-${output}`, delta })).text;
      p.event(JSON.stringify({ type: "response.output_text.done", output_index: output, content_index: content, item_id: `message-${output}`, text: delta }));
    }
    p.event(JSON.stringify({ type: "response.completed", response: { status: "completed", output: [
      { type: "reasoning" },
      { id: "message-1", type: "message", content: [{ type: "output_text", text: "{" }, { type: "output_text", text: '"ok":' }] },
      { id: "message-2", type: "message", content: [{ type: "output_text", text: "true}" }] },
    ] } }));
    p.eof(); expect(result).toBe('{"ok":true}');
  });
  it.each([undefined, null, -1, 0.5, "1", 33, Number.MAX_SAFE_INTEGER])("rejects invalid Responses item and content indexes %s", (index) => {
    for (const type of ["response.output_text.delta", "response.output_text.done", "response.content_part.added", "response.content_part.done", "response.output_item.added", "response.output_item.done"]) {
      for (const field of type.includes("output_item") ? ["output_index"] : ["output_index", "content_index"]) {
        const p = new StreamProtocol({ ...base, mode: "responses" });
        expect(() => p.event(JSON.stringify({ type, output_index: 1, content_index: 0, [field]: index, delta: "{}", text: "{}", item: { type: "message", content: [] }, part: { type: "output_text", text: "" } }))).toThrowError(expect.objectContaining({ code: "STREAM_PROTOCOL" }));
      }
    }
  });
  it.each([
    { output_index: 0, content_index: 0, item_id: "other" },
    { output_index: 1, content_index: 0, item_id: "changed" },
    { output_index: 2, content_index: 0, item_id: "message" },
  ])("rejects text reordering and inconsistent item IDs %#", (fields) => {
    const p = new StreamProtocol({ ...base, mode: "responses" });
    p.event(JSON.stringify({ type: "response.output_text.delta", output_index: 1, content_index: 1, item_id: "message", delta: "{" }));
    expect(() => p.event(JSON.stringify({ type: "response.output_text.delta", ...fields, delta: "}" }))).toThrow();
  });
  it("compares final Responses text by item and part indexes, not merely concatenated text", () => {
    const p = new StreamProtocol({ ...base, mode: "responses" });
    p.event(JSON.stringify({ type: "response.output_text.delta", output_index: 1, content_index: 1, delta: "{}" }));
    expect(() => p.event(JSON.stringify({ type: "response.completed", response: { status: "completed", output: [
      { type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: "{}" }] },
    ] } }))).toThrow();
  });
  it("rejects text emitted under reasoning or after part/item completion", () => {
    for (const terminal of ["response.output_text.done", "response.content_part.done", "response.output_item.done"]) {
      const p = new StreamProtocol({ ...base, mode: "responses" });
      p.event(JSON.stringify({ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "{}" }));
      p.event(JSON.stringify({ type: terminal, output_index: 1, content_index: 0, text: "{}", part: { type: "output_text", text: "{}" }, item: { type: "message", status: "completed", content: [{ type: "output_text", text: "{}" }] } }));
      expect(() => p.event(JSON.stringify({ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "late" }))).toThrow();
    }
    const p = new StreamProtocol({ ...base, mode: "responses" });
    p.event(JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "reasoning" } }));
    expect(() => p.event(JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "{}" }))).toThrow();
  });
  it("rejects malformed reasoning indexes without retaining their text", () => {
    for (const field of ["output_index", "content_index", "summary_index"]) {
      const p = new StreamProtocol({ ...base, mode: "responses" });
      expect(() => p.event(JSON.stringify({ type: "response.reasoning_text.delta", output_index: 0, [field]: -1, delta: "private" }))).toThrow();
    }
  });
  it("rejects unfinished final message items even if the response claims completion", () => {
    const p = new StreamProtocol({ ...base, mode: "responses" });
    p.event(JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "{}" }));
    expect(() => p.event(JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "message", status: "incomplete", content: [{ type: "output_text", text: "{}" }] }] } }))).toThrowError(expect.objectContaining({ code: "TRUNCATED" }));
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
