import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../../../src/main/db/migrations";
import { ProviderDiagnosticsRepository } from "../../../src/main/db/provider-diagnostics";
import { generateText, translateBatch } from "../../../src/main/services/providers/lib/text-provider";
import { SseFramer } from "../../../src/main/services/providers/lib/stream-protocol";
import { cancelAllTextRequests, waitForTextRequestsIdle } from "../../../src/main/services/providers/lib/text-request";
import type { Profile } from "../../../src/shared/contracts";
import { AppError } from "../../../src/main/lib/errors";

const servers: Server[] = [];
const roots: string[] = [];
const databases: Database.Database[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
  for (const db of databases.splice(0)) db.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(handler: (response: ServerResponse, body: Record<string, unknown>, url: string) => void): Promise<string> {
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += String(chunk);
    handler(res, JSON.parse(body) as Record<string, unknown>, req.url ?? "");
  }); servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("address");
  return `http://127.0.0.1:${address.port}/v1`;
}
function profile(url: string, protocol: Profile["protocol"] = "openai", mode: Profile["mode"] = "chat"): Profile {
  return { id: "profile", name: "test", protocol, mode, baseUrl: url, model: "test", sessionOnly: true, hasKey: true, timeoutMs: 5000, maxUploadBytes: 100000, structuredOutput: true };
}
async function diagnostics(): Promise<ProviderDiagnosticsRepository> {
  const root = await mkdtemp(join(tmpdir(), "slice-stream-")); roots.push(root);
  const db = new Database(join(root, "app.db")); databases.push(db);
  for (const sql of MIGRATIONS) db.exec(sql);
  return new ProviderDiagnosticsRepository(db, root);
}
function event(value: unknown): string { return `data: ${JSON.stringify(value)}\n\n`; }
function chat(content: string, finish: string | null = null): string { return event({ id: "reply", choices: [{ index: 0, delta: { content }, finish_reason: finish }] }); }
function sse(res: ServerResponse): void { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders(); }

describe("streamed text protocol integrity and diagnostics", () => {
  it("writes normalized Chat answer, not reasoning, raw frames, prompt or key; keeps final usage and lifecycle", async () => {
    const repo = await diagnostics(); let requests = 0;
    const url = await fixture((res, body) => {
      requests++; expect(body.stream).toBe(true); sse(res);
      res.write(": keep-alive\r\n\r\n");
      res.write(event({ id: "reply", choices: [{ index: 0, delta: { reasoning_content: "SECRET_PRIVATE_REASONING" } }] }));
      res.write(chat('{"name":"猫"}'));
      res.write(event({ id: "reply", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } }));
      res.end("data: [DONE]\n\n");
    });
    let requestId = "";
    const value = await generateText(profile(url), "SECRET_KEY", "SECRET_PROMPT", undefined, { diagnostics: repo, operation: "names", jobId: "job", targetCount: 200, onRequestComplete: (id) => { requestId = id; } });
    expect(value).toBe('{"name":"猫"}'); expect(requests).toBe(1);
    const record = repo.detail(requestId);
    expect(record).toMatchObject({ state: "transport_complete", streamRequested: true, streamActual: true, targetCount: 200, usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 } });
    expect(record.firstAnswerAt).toBeGreaterThanOrEqual(record.headersAt ?? 0);
    expect(record.textBytes).toBe(Buffer.byteLength(value)); expect(record.promptBytes).toBe(Buffer.byteLength("SECRET_PROMPT"));
    expect(await repo.readAnswer(requestId)).toBe(value);
    expect(JSON.stringify(record)).not.toMatch(/SECRET|keep-alive|reasoning_content|authorization/);
    expect(() => repo.markPublished(requestId)).toThrow(); repo.markValidated(requestId); repo.markPublished(requestId);
    expect(repo.detail(requestId).state).toBe("published");
  });
  it.each(["responses", "anthropic", "gemini"] as const)("accepts %s semantic completion and discards thinking", async (kind) => {
    const url = await fixture((res, body, path) => {
      sse(res);
      if (kind === "responses") {
        expect(body.stream).toBe(true);
        res.write(event({ type: "response.reasoning_text.delta", delta: "private" }));
        res.write(event({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: '{"ok":true}' }));
        res.write(event({ type: "response.output_text.done", output_index: 0, content_index: 0, text: '{"ok":true}' }));
        res.end(event({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 4, output_tokens: 3 } } }));
      } else if (kind === "anthropic") {
        res.write(event({ type: "message_start", message: { usage: { input_tokens: 4 } } }));
        res.write(event({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }));
        res.write(event({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "private" } }));
        res.write(event({ type: "content_block_stop", index: 0 }));
        res.write(event({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }));
        res.write(event({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: '{"ok":true}' } }));
        res.write(event({ type: "content_block_stop", index: 1 }));
        res.write(event({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } }));
        res.end(event({ type: "message_stop" }));
      } else {
        expect(path).toBe("/v1/models/test:streamGenerateContent?alt=sse");
        res.write(event({ candidates: [{ index: 0, content: { parts: [{ thought: true, text: "private" }, { text: '{"ok":' }] } }] }));
        res.end(event({ candidates: [{ index: 0, content: { parts: [{ text: "true}" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 7 } }));
      }
    });
    const p = kind === "responses" ? profile(url, "openai", "responses") : profile(url, kind);
    expect(await generateText(p, "secret", "prompt")).toBe('{"ok":true}');
  });
  it("auto compatibility consumes the same 200 JSON response, explicit disabled sends no stream", async () => {
    let requests = 0;
    const url = await fixture((res, body) => { requests++; expect(body.stream).toBe(requests === 1 ? true : undefined); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{}' } }] })); });
    expect(await generateText(profile(url), "secret", "prompt")).toBe("{}");
    expect(await generateText({ ...profile(url), streaming: "disabled" }, "secret", "prompt")).toBe("{}"); expect(requests).toBe(2);
  });
  it.each([
    [chat("{}"), "STREAM_INCOMPLETE", "{}"],
    [chat("{}", "length"), "TRUNCATED", "{}"],
    [chat("{}", "tool_calls"), "REFUSAL", "{}"],
    [chat("{") + "data: bad-json\n\n", "STREAM_PROTOCOL", "{"],
    [chat("{}", "stop") + "data: [DONE]", "STREAM_INCOMPLETE", "{}"],
    [chat("{") + event({ error: { message: "SECRET" } }), "PROVIDER_STREAM_ERROR", "{"],
  ])("retains partial content and never replays failed stream %#", async (body, code, expected) => {
    const repo = await diagnostics(); let count = 0;
    const url = await fixture((res) => { count++; sse(res); res.end(body); });
    await expect(generateText(profile(url), "secret", "prompt", undefined, { diagnostics: repo, operation: "review" })).rejects.toMatchObject({ code });
    expect(count).toBe(1); const record = repo.list()[0]; expect(record?.state).toBe("failed"); expect(record?.errorCode).toBe(code);
    if (!record) throw new Error("record"); expect(record.artifact).toContain("partial"); expect(JSON.stringify(record)).not.toContain("SECRET");
    expect(await repo.readAnswer(record.id)).toBe(expected);
  });
  it.each(["headers", "idle", "overall"] as const)("separately reports %s timeout without replay", async (kind) => {
    const repo = await diagnostics(); let count = 0;
    const url = await fixture((res) => { count++; if (kind !== "headers") sse(res); if (kind === "overall") { const timer = setInterval(() => res.write(": keep-alive\n\n"), 10); res.on("close", () => clearInterval(timer)); } });
    const p = { ...profile(url), timeoutMs: kind === "overall" ? 200 : 120, textTimeoutMs: kind === "overall" ? 350 : 3000 };
    await expect(generateText(p, "secret", "prompt", undefined, { diagnostics: repo, operation: "review" })).rejects.toMatchObject({ code: `PROVIDER_${kind === "headers" ? "HEADER" : kind.toUpperCase()}_TIMEOUT` });
    expect(count).toBe(1); expect(repo.list()[0]?.errorPhase).toBe(kind);
  });
  it("valid keepalive avoids short idle timeout while awaiting answer, but transport garbage does not", async () => {
    const url = await fixture((res) => { sse(res); let count = 0; const timer = setInterval(() => { res.write(": keep-alive\n\n"); if (++count === 8) { clearInterval(timer); res.end(chat("{}", "stop") + "data: [DONE]\n\n"); } }, 30); res.on("close", () => clearInterval(timer)); });
    expect(await generateText({ ...profile(url), timeoutMs: 150 }, "key", "prompt")).toBe("{}");
    const invalid = await fixture((res) => { sse(res); const timer = setInterval(() => res.write(" "), 5); res.on("close", () => clearInterval(timer)); });
    await expect(generateText({ ...profile(invalid), timeoutMs: 150 }, "key", "prompt")).rejects.toMatchObject({ code: "PROVIDER_IDLE_TIMEOUT" });
  });
  it("persists and announces a lone answer delta after an earlier heartbeat even when no later bytes arrive", async () => {
    const repo = await diagnostics(); const controller = new AbortController(); const updates = vi.fn(); let live: ServerResponse | undefined;
    const url = await fixture((res) => { live = res; sse(res); res.write(": keep-alive\n\n"); });
    const failure = expect(generateText(profile(url), "key", "prompt", controller.signal, { diagnostics: repo, operation: "review", onProgress: updates })).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(repo.list()[0]?.wireBytes).toBeGreaterThan(0));
    live?.write(chat("{lone"));
    await vi.waitFor(() => expect(repo.list()[0]?.textBytes).toBe(Buffer.byteLength("{lone")), { timeout: 2500, interval: 50 });
    const record = repo.list()[0]; if (!record) throw new Error("missing diagnostic");
    expect(record.state).toBe("receiving"); expect(await repo.readAnswer(record.id)).toBe("{lone");
    expect(updates.mock.calls.some(([value]) => value.textBytes === Buffer.byteLength("{lone") && value.state === "receiving")).toBe(true);
    controller.abort(); await failure; await waitForTextRequestsIdle();
  });
  it("cancellation settles reads and retains written text before returning", async () => {
    const repo = await diagnostics(); const controller = new AbortController();
    const url = await fixture((res) => { sse(res); res.write(chat('{"partial":')); });
    const pending = generateText(profile(url), "secret", "prompt", controller.signal, { diagnostics: repo, operation: "names" });
    const rejection = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    // Wait for an independently observable persisted prefix, then cancel the read.
    await vi.waitFor(() => expect(repo.list()[0]?.textBytes).toBeGreaterThan(0));
    controller.abort(); await rejection;
    const record = repo.list()[0]; if (!record) throw new Error("record");
    expect(record.state).toBe("cancelled"); expect(await repo.readAnswer(record.id)).toBe('{"partial":');
    await waitForTextRequestsIdle();
  });
  it("accepts a semantic terminal without waiting for the server to close its SSE connection", async () => {
    const url = await fixture((res) => { sse(res); res.write(chat("{}", "stop") + "data: [DONE]\n\n"); });
    expect(await generateText({ ...profile(url), timeoutMs: 100 }, "key", "prompt")).toBe("{}");
  });
  it("cancels standalone capability requests before shutdown waits for disk/network finalizers", async () => {
    let requests = 0;
    const url = await fixture((res) => { requests++; sse(res); res.write(chat("{partial")); });
    const failure = expect(generateText(profile(url), "key", "prompt")).rejects.toMatchObject({ code: "CANCELLED" });
    await vi.waitFor(() => expect(requests).toBe(1));
    cancelAllTextRequests(); await waitForTextRequestsIdle(); await failure;
    expect(requests).toBe(1);
  });
  it("does not hide an unsupported-stream HTTP error behind a second billable POST", async () => {
    let requests = 0;
    const url = await fixture((res) => { requests++; res.writeHead(400, { "Content-Type": "application/json" }); res.end('{"error":"stream unsupported"}'); });
    await expect(generateText(profile(url), "secret", "prompt")).rejects.toMatchObject({ code: "PROVIDER_HTTP" });
    expect(requests).toBe(1);
  });
  it("logs an invalid translation attempt before its single correction, includes chapter data once", async () => {
    const repo = await diagnostics(); let requests = 0; const ids: string[] = [];
    const cue = { id: "target", sourceText: "原文", translatedText: "", translationStale: false, startMs: 0, endMs: 1000 };
    const neighbour = { ...cue, id: "context", sourceText: "上下文" };
    const url = await fixture((res, body) => {
      requests++;
      const messages = body.messages as { content: string }[]; const prompt = messages[0]?.content ?? "";
      const payload = JSON.parse(prompt.split("\n")[1] ?? "{}") as Record<string, unknown>;
      expect(payload.chapter).toEqual({ title: "章节", summary: "章节摘要" });
      expect(payload.context).toEqual([{ id: "context", text: "上下文" }]);
      sse(res); res.end(chat(JSON.stringify({ translations: requests === 1 ? [] : [{ id: "target", text: "译文" }] }), "stop") + "data: [DONE]\n\n");
    });
    expect(await translateBatch(profile(url), "key", [cue], [cue, neighbour, neighbour], "ja", "zh", undefined, { diagnostics: repo, operation: "translate", onRequestComplete: (id) => ids.push(id) }, { title: "章节", summary: "章节摘要" })).toEqual([{ id: "target", text: "译文" }]);
    expect(requests).toBe(2); expect(ids).toHaveLength(2);
    const [first, second] = ids; if (!first || !second) throw new Error("missing request ids");
    expect(repo.detail(first)).toMatchObject({ state: "failed", errorCode: "TRANSLATION_INCOMPLETE", errorPhase: "validation", attempt: 0 });
    expect(repo.detail(second)).toMatchObject({ state: "transport_complete", attempt: 1 });
  });
  it("retains a prefix after a dropped connection and never retries the generation", async () => {
    const repo = await diagnostics(); let requests = 0; let live: ServerResponse | undefined;
    const url = await fixture((res) => { requests++; live = res; sse(res); res.write(chat("{prefix")); });
    const failure = expect(generateText(profile(url), "secret", "prompt", undefined, { diagnostics: repo, operation: "review" })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    await vi.waitFor(() => expect(repo.list()[0]?.textBytes).toBeGreaterThan(0)); live?.destroy(); await failure;
    const record = repo.list()[0]; if (!record) throw new Error("record");
    expect(requests).toBe(1); expect(await repo.readAnswer(record.id)).toBe("{prefix");
  });
  it("awaits ordered disk backpressure without confusing it with provider idle time", async () => {
    const repo = await diagnostics(); const begin = repo.begin.bind(repo);
    vi.spyOn(repo, "begin").mockImplementation(async (input) => {
      const writer = await begin(input); const append = writer.append.bind(writer);
      vi.spyOn(writer, "append").mockImplementation(async (value) => { await new Promise<void>((resolve) => setTimeout(resolve, 150)); await append(value); });
      return writer;
    });
    const url = await fixture((res) => { sse(res); res.end(chat("{") + chat("}", "stop") + "data: [DONE]\n\n"); });
    expect(await generateText({ ...profile(url), timeoutMs: 100 }, "key", "prompt", undefined, { diagnostics: repo, operation: "translate" })).toBe("{}");
    const record = repo.list()[0]; if (!record) throw new Error("record");
    expect(await repo.readAnswer(record.id)).toBe("{}"); expect(record.elapsedMs).toBeGreaterThanOrEqual(300);
  });
  it("reports final storage failure as storage without replay or success callback", async () => {
    const repo = await diagnostics(); const begin = repo.begin.bind(repo); const complete = vi.fn(); let requests = 0;
    vi.spyOn(repo, "begin").mockImplementation(async (input) => {
      const writer = await begin(input); const finish = writer.finish.bind(writer);
      vi.spyOn(writer, "finish").mockImplementation(async (state, code, phase) => {
        if (state === "transport_complete") throw new AppError("DIAGNOSTIC_STORAGE", "disk full");
        await finish(state, code, phase);
      }); return writer;
    });
    const url = await fixture((res) => { requests++; sse(res); res.end(chat("{}", "stop") + "data: [DONE]\n\n"); });
    await expect(generateText(profile(url), "key", "prompt", undefined, { diagnostics: repo, operation: "review", onRequestComplete: complete })).rejects.toMatchObject({ code: "DIAGNOSTIC_STORAGE" });
    expect(requests).toBe(1); expect(complete).not.toHaveBeenCalled();
  });
  it("SSE handles every UTF8 split, BOM, CRLF/CR/LF, multiline data and terminal delimiter", async () => {
    const collected: string[] = []; let heartbeat = 0;
    const bytes = Buffer.from('\ufeff: alive\r\ndata: {"猫":\rdata: true}\n\ndata: [DONE]\r\n\r\n');
    const parser = new SseFramer(async (data) => { collected.push(data); }, () => heartbeat++);
    for (const byte of bytes) await parser.push(new Uint8Array([byte])); await parser.push(new Uint8Array(), true);
    expect(collected).toEqual(['{"猫":\ntrue}', "[DONE]"]); expect(heartbeat).toBe(1);
    const broken = new SseFramer(async () => {}, () => {});
    await expect(broken.push(new Uint8Array([0xff]))).rejects.toMatchObject({ code: "STREAM_PROTOCOL" });
  });
  it("logs storage creation failure actionably without sending provider request", async () => {
    const repo = await diagnostics(); const spy = vi.spyOn(repo, "begin").mockRejectedValue(Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(generateText(profile("http://127.0.0.1:1"), "secret", "prompt", undefined, { diagnostics: repo, operation: "style" })).rejects.toBeDefined();
    expect(spy).toHaveBeenCalledOnce(); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("partial writes and backpressure preserve order and fail closed on ENOSPC", async () => {
    const repo = await diagnostics(); const writer = await repo.begin({ runId: "run", operation: "review", profileId: "profile", model: "model", protocol: "openai", mode: "chat", attempt: 0, targetCount: 1, promptBytes: 4, streamRequested: true, timeoutMs: 1000, textTimeoutMs: 1800000, startedAt: Date.now() });
    await writer.append("猫"); await writer.append("犬"); await writer.finish("cancelled", "CANCELLED", "cancel");
    expect(await readFile(await repo.artifactPath(writer.record.id), "utf8")).toBe("猫犬");
    expect((await readdir(repo.root)).length).toBe(1);
  });
});
