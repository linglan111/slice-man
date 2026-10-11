import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server, type IncomingMessage } from "node:http";
import type { Profile, Segment } from "../../../src/shared/contracts";
import {
  generateText,
  parseJson,
  requestJson,
  transcribe,
  validateTranslations,
} from "../../../src/main/services/providers/lib/text-provider";
import { normalizeCloud } from "../../../src/main/services/subtitles/lib/timeline";
const servers: Server[] = [];
async function mock(
  handler: (
    url: string,
    headers: IncomingMessage["headers"],
    body: string,
  ) => { status?: number; body: unknown },
): Promise<string> {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += String(chunk);
    const output = handler(req.url ?? "", req.headers, body);
    res.writeHead(output.status ?? 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(output.body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  return `http://127.0.0.1:${address.port}/v1`;
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
});
function profile(
  baseUrl: string,
  protocol: Profile["protocol"] = "openai",
  mode: Profile["mode"] = "chat",
): Profile {
  return {
    id: "p",
    name: "test",
    baseUrl,
    protocol,
    mode,
    model: "test-model",
    sessionOnly: true,
    hasKey: true,
    timeoutMs: 5000,
    maxUploadBytes: 100000,
    structuredOutput: true,
  };
}
const selected: Segment[] = [
  {
    id: "s1",
    startMs: 0,
    endMs: 1000,
    sourceText: "hi",
    translatedText: "",
    translationStale: false,
  },
  {
    id: "s2",
    startMs: 1000,
    endMs: 2000,
    sourceText: "bye",
    translatedText: "",
    translationStale: false,
  },
];
describe("required text protocols use native request/auth/response mappings", () => {
  it.each(["chat", "responses"] as const)("OpenAI %s", async (mode) => {
    const url = await mock((path, headers, text) => {
      expect(headers.authorization).toBe("Bearer secret");
      const body = JSON.parse(text);
      expect(body.model).toBe("test-model");
      if (mode === "chat") {
        expect(path).toBe("/v1/chat/completions");
        expect(body.messages[0].content).toBe("hello");
        return {
          body: {
            choices: [
              { finish_reason: "stop", message: { content: '{"ok":true}' } },
            ],
          },
        };
      }
      expect(path).toBe("/v1/responses");
      expect(body.input).toBe("hello");
      return {
        body: {
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: '{"ok":true}' }],
            },
          ],
        },
      };
    });
    expect(
      parseJson(
        await generateText(profile(url, "openai", mode), "secret", "hello"),
      ),
    ).toEqual({ ok: true });
  });
  it("Anthropic messages", async () => {
    const url = await mock((path, headers, text) => {
      expect(path).toBe("/v1/messages");
      expect(headers["x-api-key"]).toBe("secret");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      expect(JSON.parse(text).max_tokens).toBe(8192);
      return {
        body: {
          stop_reason: "end_turn",
          content: [{ type: "text", text: '{"ok":true}' }],
        },
      };
    });
    expect(
      await generateText(profile(url, "anthropic"), "secret", "hello"),
    ).toBe('{"ok":true}');
  });
  it("Gemini native content generation", async () => {
    const url = await mock((path, headers, text) => {
      expect(path).toBe("/v1/models/test-model:generateContent");
      expect(headers["x-goog-api-key"]).toBe("secret");
      expect(JSON.parse(text).contents[0].parts[0].text).toBe("hello");
      return {
        body: {
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: '{"ok":true}' }] },
            },
          ],
        },
      };
    });
    expect(await generateText(profile(url, "gemini"), "secret", "hello")).toBe(
      '{"ok":true}',
    );
  });
});
describe("recoverable errors and timing capability", () => {
  it.each(["auto", "zh-CN", "zh-TW", "en"])(
    "passes normalized cloud source language %s, omitting auto",
    async (language) => {
      const url = await mock((_path, _headers, body) => {
        if (language === "auto") expect(body).not.toContain('name="language"');
        else
          expect(body).toContain(
            `name="language"\r\n\r\n${language.split("-")[0]}\r\n`,
          );
        return { body: { segments: [] } };
      });
      await transcribe(
        profile(url),
        "test-only",
        new Uint8Array(32044),
        undefined,
        language,
      );
    },
  );
  it("bounds transient retry and sanitizes provider error text", async () => {
    let count = 0;
    const url = await mock(() => ({
      status: ++count < 3 ? 429 : 200,
      body: count < 3 ? { error: "secret" } : { ok: true },
    }));
    expect(await requestJson(url, {}, 5000)).toEqual({ ok: true });
    expect(count).toBe(3);
    const denied = await mock(() => ({
      status: 401,
      body: { error: "secret-key" },
    }));
    await expect(requestJson(denied, {}, 5000)).rejects.toThrow("HTTP 401");
    await expect(requestJson(denied, {}, 5000)).rejects.not.toThrow(
      "secret-key",
    );
  });
  it("reports truncation rather than accepting partial output", async () => {
    const url = await mock(() => ({
      body: {
        choices: [
          {
            finish_reason: "length",
            message: { content: '{"translations":[' },
          },
        ],
      },
    }));
    await expect(
      generateText(profile(url), "secret", "test"),
    ).rejects.toMatchObject({ code: "TRUNCATED" });
  });
  it("validates exactly the selected IDs and nonempty translated text", () => {
    for (const translations of [
      [{ id: "s1", text: "a" }],
      [
        { id: "s1", text: "a" },
        { id: "s1", text: "b" },
      ],
      [
        { id: "s1", text: "a" },
        { id: "unknown", text: "b" },
      ],
      [
        { id: "s1", text: "a" },
        { id: "s2", text: " " },
      ],
    ])
      expect(() => validateTranslations({ translations }, selected)).toThrow();
    expect(
      validateTranslations(
        {
          translations: [
            { id: "s2", text: "再见" },
            { id: "s1", text: "你好" },
          ],
        },
        selected,
      ),
    ).toHaveLength(2);
  });
  it("uploads real WAV bytes using multipart and requires timed segments", async () => {
    const url = await mock((path, headers, body) => {
      expect(path).toBe("/v1/audio/transcriptions");
      expect(headers["content-type"]).toContain("multipart/form-data");
      expect(body).toContain("verbose_json");
      expect(body).toContain("segment");
      return {
        body: {
          text: "hello",
          segments: [{ start: 0, end: 0.5, text: "hello" }],
        },
      };
    });
    const response = await transcribe(
      profile(url),
      "secret",
      new Uint8Array(32044),
    );
    expect(normalizeCloud(response, 0, 1000, "cloud")).toHaveLength(1);
    expect(() => normalizeCloud({ text: "hello" }, 0, 1000, "cloud")).toThrow();
  });
  it("cancels before making a request", async () => {
    const c = new AbortController();
    c.abort();
    await expect(
      requestJson("http://127.0.0.1:1", {}, 5000, c.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
