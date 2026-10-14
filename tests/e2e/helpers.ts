import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
  type Locator,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  DEFAULT_STYLE,
  type Job,
  type Profile,
} from "../../src/shared/contracts";

const execute = promisify(execFile);
export const FFMPEG = resolve("resources/media/ffmpeg.exe");
export const FFPROBE = resolve("resources/media/ffprobe.exe");
export type MockServer = {
  url: string;
  server: Server;
  counters: {
    recognition: number;
    translation: number;
    style: number;
    connection: number;
    review: number;
    names: number;
    chapters: number;
  };
  reviewPrompts: string[];
  namePrompts: string[];
  chapterPrompts: string[];
  behavior: {
    translation: "ok" | "auth-error" | "slow";
    style: "ok" | "invalid";
    artifact: "ok" | "corrupt" | "slow";
    recognition: "full" | "partial";
    review: "findings" | "empty" | "slow" | "graded" | "evidence-corrected" | "evidence-invalid";
    names: "ok" | "slow" | "empty" | "variants";
    textStream: "json" | "sse" | "partial";
    reviewErrorAt?: number;
  };
  close: () => Promise<void>;
};

export async function startMockServer(): Promise<MockServer> {
  const reviewPrompts: string[] = [];
  const namePrompts: string[] = [];
  const chapterPrompts: string[] = [];
  const counters = {
    recognition: 0,
    translation: 0,
    style: 0,
    connection: 0,
    review: 0,
    names: 0,
    chapters: 0,
  };
  const behavior: MockServer["behavior"] = {
    translation: "ok",
    style: "ok",
    artifact: "ok",
    recognition: "full",
    review: "findings",
    names: "ok",
    textStream: "json",
  };
  const server = createServer((request, response) => {
    async function handle(): Promise<void> {
      const url = request.url ?? "";
      if (url.startsWith("/artifacts/")) {
        if (behavior.artifact === "slow") return;
        if (behavior.artifact === "corrupt") {
          response.end("corrupt-runtime");
          return;
        }
        const name = url.endsWith("cpu.zip") ? "cpu.zip" : "ggml-base.bin";
        const path = resolve(".runtime-cache/whisper", name);
        response.writeHead(200, { "Content-Length": (await stat(path)).size });
        createReadStream(path).pipe(response);
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (url.endsWith("/audio/transcriptions")) {
        const hasCapabilitySilence =
          behavior.recognition === "full" &&
          Buffer.concat(chunks).length < 40000;
        if (hasCapabilitySilence) counters.connection++;
        else counters.recognition++;
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify(
            hasCapabilitySilence
              ? { segments: [] }
              : behavior.recognition === "partial"
                ? {
                    segments: [
                      { start: 0, end: 0.1, text: "Repaired source passage." },
                    ],
                  }
                : {
                    segments: [
                      { start: 0.1, end: 1.8, text: "Hello world." },
                      { start: 2, end: 3.8, text: "A second sentence." },
                    ],
                  },
          ),
        );
        return;
      }
      const raw = z
        .object({
          input: z.string().optional(),
          messages: z
            .array(z.object({ content: z.string() }).passthrough())
            .optional(),
          contents: z
            .array(z.object({ parts: z.array(z.object({ text: z.string() })) }))
            .optional(),
        })
        .passthrough()
        .parse(JSON.parse(Buffer.concat(chunks).toString()) as unknown);
      const prompt =
        raw.input ??
        raw.messages?.[0]?.content ??
        raw.contents?.[0]?.parts[0]?.text ??
        "";
      let content: unknown;
      if (prompt.includes("Connection and text capability")) {
        counters.connection++;
        content = { ok: true };
      } else if (prompt.startsWith("Design subtitle style")) {
        counters.style++;
        content =
          behavior.style === "invalid"
            ? { ...DEFAULT_STYLE, executable: "forbidden" }
            : {
                ...DEFAULT_STYLE,
                templateId: "cinematic",
                fontSizeRatio: 0.05,
                textColor: "#FFF5C2",
              };
      } else if (prompt.startsWith("Divide the video into content chapters")) {
        counters.chapters++;
        chapterPrompts.push(prompt);
        const payload = z.object({kind: z.enum(['normal', 'custom']), anchors: z.array(z.number()).min(2)}).passthrough().parse(JSON.parse(prompt.split('\n').at(-1) ?? '{}') as unknown);
        const last = payload.anchors.length - 1;
        const duration = payload.anchors[last] ?? 0;
        const middle = payload.anchors.map((value, index) => ({value, index})).filter(({index}) => index > 0 && index < last).sort((a, b) => Math.abs(a.value - duration / 2) - Math.abs(b.value - duration / 2))[0]?.index;
        content = {chapters: middle === undefined ? [{startAnchor: 0, endAnchor: last, title: '相同章节', summary: '完整内容概要'}] : [
          {startAnchor: 0, endAnchor: middle, title: '相同章节', summary: '前半部分内容概要'},
          ...(payload.kind === 'normal' ? [{startAnchor: middle, endAnchor: last, title: '相同章节', summary: '后半部分内容概要'}] : []),
        ]};
      } else if (prompt.startsWith("Analyze recurring PERSON names")) {
        counters.names++;
        namePrompts.push(prompt);
        if (behavior.names === "slow") return;
        const payload = z.object({ translationEnabled: z.boolean() }).passthrough().parse(JSON.parse(prompt.split("\n").at(-1) ?? "{}") as unknown);
        content = { candidates: behavior.names === "empty" ? [] : [{ sourceAliases: behavior.names === "variants" ? ["Ann", "An"] : ["Ann"], translatedAliases: payload.translationEnabled ? behavior.names === "variants" ? ["安娜", "安纳"] : ["安娜"] : [], sourceName: "Anne", ...(payload.translationEnabled ? { translatedName: "安妮" } : {}), reason: "同一姓名在两条字幕中重复出现，请核对上下文后统一。" }] };
      } else if (prompt.startsWith("Review subtitle text and timing.")) {
        counters.review++;
        reviewPrompts.push(prompt);
        if (behavior.reviewErrorAt === counters.review) { response.writeHead(401); response.end('{}'); return; }
        if (behavior.review === "slow") return;
        const line = prompt.split("\n").find(value => value.startsWith('{"cues"'));
        const batch = z.object({
          cues: z.array(z.object({ n: z.number().int(), sourceText: z.string() }).passthrough()),
          groups: z.array(z.object({targets: z.array(z.number().int()),context: z.array(z.number().int())})),
        }).passthrough().parse(JSON.parse(line ?? "{}") as unknown);
        content = {a: batch.groups.flatMap(group => group.targets.map(n => {
          const sourceText = batch.cues.find(candidate => candidate.n === n)?.sourceText;
          if (sourceText === undefined) throw new Error("Review target omitted from contextual dialogue");
          const needsEvidence = behavior.review === "evidence-corrected" || behavior.review === "evidence-invalid";
          const ruleId = needsEvidence ? "source.context_inconsistency" : behavior.review === "empty" ? undefined : behavior.review !== "graded" ? "source.meaning_problem" : sourceText.startsWith("LOW:") ? "source.minor_wording" : sourceText.startsWith("MEDIUM:") ? "source.meaning_problem" : sourceText.startsWith("HIGH:") ? "timing.severe_readability" : undefined;
          const neighbor = group.context.find(candidate => candidate !== n);
          const evidenceNeighbor = needsEvidence && behavior.review === "evidence-corrected" && prompt.includes("Correction 1/1") ? group.context.find(candidate => candidate !== n && Math.abs(candidate - n) <= 2) : undefined;
          return [n, ruleId ? [[ruleId, ruleId === "timing.severe_readability" ? "这句文字量较大，只显示100毫秒，严重影响阅读。" : ruleId === "source.minor_wording" ? "这句措辞有轻微疑点，但主要意思明确。" : "该词组影响句意理解，请结合相邻对话试听确认。", [n, ...(needsEvidence ? evidenceNeighbor !== undefined ? [evidenceNeighbor] : [] : neighbor !== undefined && ruleId === "source.meaning_problem" ? [neighbor] : [])]]] : []];
        }))};
      } else {
        counters.translation++;
        if (behavior.translation === "slow") return;
        if (behavior.translation === "auth-error") {
          response.writeHead(401);
          response.end("{}");
          return;
        }
        const line = prompt
          .split("\n")
          .find((value) => value.startsWith('{"selected"'));
        const batch = z
          .object({
            selected: z.array(z.object({ id: z.string(), text: z.string() })),
          })
          .passthrough()
          .parse(JSON.parse(line ?? "{}") as unknown);
        content = {
          translations: batch.selected.map((item, index) => ({
            id: item.id,
            text:
              batch.selected.length === 1
                ? `已重译：${item.text}`
                : index === 0
                  ? "你好，世界。"
                  : "这是第二句话。",
          })),
        };
      }
      const text = JSON.stringify(content);
      if (behavior.textStream !== 'json' && url.endsWith('/chat/completions')) {
        response.setHeader('Content-Type', 'text/event-stream');
        response.write(`: keep-alive ${' '.repeat(2048)}\n\n`);
        response.write(`data: ${JSON.stringify({id: 'stream-fixture', choices: [{index: 0, delta: {role: 'assistant', reasoning_content: 'PRIVATE_REASONING_NOT_SAVED'}}]})}\n\n`);
        const pieces = Array.from(text);
        const length = behavior.textStream === 'partial' ? Math.min(12, pieces.length) : pieces.length;
        for (let offset = 0; offset < length; offset += 64) {
          if (response.destroyed) return;
          const wire = Buffer.from(`data: ${JSON.stringify({id: 'stream-fixture', choices: [{index: 0, delta: {content: pieces.slice(offset, Math.min(offset + 64, length)).join('')}}]})}\n\n`);
          const cut = Math.max(1, Math.floor(wire.length / 2));
          response.write(wire.subarray(0, cut));
          await new Promise<void>((resolveChunk) => setTimeout(resolveChunk, 1));
          if (response.destroyed) return;
          response.write(wire.subarray(cut));
        }
        if (behavior.textStream === 'partial') return;
        response.write(`data: ${JSON.stringify({id: 'stream-fixture', choices: [{index: 0, delta: {}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120}})}\n\n`);
        response.end('data: [DONE]\n\n');
        return;
      }
      const result = url.endsWith("/messages")
        ? { stop_reason: "end_turn", content: [{ type: "text", text }] }
        : url.includes(":generateContent") || url.includes(":streamGenerateContent")
          ? {
              candidates: [
                { finishReason: "STOP", content: { parts: [{ text }] } },
              ],
            }
          : url.endsWith("/responses")
            ? {
                output: [
                  { type: "message", content: [{ type: "output_text", text }] },
                ],
              }
            : {
                choices: [
                  { finish_reason: "stop", message: { content: text } },
                ],
              };
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(result));
    }
    void handle().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end("{}");
    });
  });
  await new Promise<void>((resolveReady) =>
    server.listen(0, "127.0.0.1", resolveReady),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Mock server did not bind a loopback port");
  return {
    server,
    counters,
    reviewPrompts,
    namePrompts,
    chapterPrompts,
    behavior,
    url: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolveClosed, reject) =>
        server.close((error) => (error ? reject(error) : resolveClosed())),
      );
    },
  };
}

export async function makeVideo(path: string, speech = false): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await execute(
    FFMPEG,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x182b3e:s=640x360:r=25",
      ...(speech
        ? ["-i", resolve(".runtime-cache/whisper/jfk.wav")]
        : [
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=400:sample_rate=16000:duration=4",
          ]),
      "-t",
      speech ? "11" : "4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      path,
    ],
    { windowsHide: true },
  );
}

export async function launchApp(
  userData: string,
  imports: string[],
  exports: string[],
  extraEnv: Record<string, string> = {},
  options: { preserveGuide?: boolean } = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  await mkdir(userData, { recursive: true });
  const inheritedEnv: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env))
    if (value !== undefined) inheritedEnv[name] = value;
  const env: Record<string, string> = {
    ...inheritedEnv,
    APP_E2E: "1",
    APP_E2E_USER_DATA: userData,
    APP_E2E_IMPORT_PATHS: JSON.stringify(imports),
    APP_E2E_EXPORT_PATHS: JSON.stringify(exports),
    ...extraEnv,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: resolve("node_modules/electron/dist/electron.exe"),
    args: [resolve(".")],
    env,
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "导入视频", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("正在读取本地项目与引擎状态…"),
    ).not.toBeVisible();
    // Wait for App's committed startup decision, not a race-prone visibility probe.
    const shell = page.locator('[data-onboarding-state]');
    await expect(shell).toHaveAttribute('data-onboarding-state', /^(open|settled)$/);
    if (!options.preserveGuide && await shell.getAttribute('data-onboarding-state') === 'open') {
      const guide = page.getByRole('dialog', { name: '功能导航', exact: true });
      await guide.getByRole('button', { name: '稍后再看', exact: true }).click();
      await expect(guide).not.toBeVisible();
      await expect(shell).toHaveAttribute('data-onboarding-state', 'settled');
    }
    return { app, page };
  } catch (error) {
    await app.close();
    throw error;
  }
}

export async function addProfile(
  page: Page,
  name: string,
  protocol: Profile["protocol"],
  baseUrl: string,
  mode = "chat",
): Promise<void> {
  await page.getByRole("button", { name: "API 服务", exact: true }).click();
  await page.getByRole("button", { name: "添加服务", exact: true }).click();
  await page.getByLabel("配置名称", { exact: true }).fill(name);
  await page.getByLabel("协议", { exact: true }).selectOption(protocol);
  if (protocol === "openai")
    await page.getByLabel("文本接口", { exact: true }).selectOption(mode);
  await page.getByLabel("接口地址", { exact: true }).fill(baseUrl);
  await page.getByLabel("模型 ID", { exact: true }).fill("mock-model");
  await page.getByLabel("API Key", { exact: true }).fill("e2e-private-key");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "API 服务", exact: true }),
  ).toBeVisible();
  await page.getByLabel("关闭对话框", { exact: true }).click();
}

/** The import choice is explicit: legacy regression fixtures need translated content. */
export async function importVideo(
  page: Page,
  translationEnabled = true,
): Promise<void> {
  await page.getByRole("button", { name: "导入视频", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入视频", exact: true });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("翻译字幕", { exact: true })
    .setChecked(translationEnabled);
  await dialog
    .getByRole("button", { name: "选择视频并导入", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}

export async function configureCloud(
  page: Page,
  profile: string,
): Promise<void> {
  await openGenerationSettings(page);
  await page.getByLabel("识别方式", { exact: true }).selectOption("cloud");
  await expect(page.getByLabel("语音识别服务", { exact: true })).toBeEnabled();
  await page
    .getByLabel("语音识别服务", { exact: true })
    .selectOption({ label: profile });
  await expect(page.getByLabel("翻译服务", { exact: true })).toBeEnabled();
  await page
    .getByLabel("翻译服务", { exact: true })
    .selectOption({ label: profile });
  await closeWorkspaceSettings(page);
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.getByRole("button", { name: "一键生成字幕", exact: true })).toBeEnabled();
}

const reviewFilterLabels: Record<string, string> = { all: '全部', unchecked: '未检查', none: '无', low: '低', medium: '中', high: '高' };
export async function reviewFilterChoice(page: Page, key: string): Promise<Locator> {
  const trigger = page.getByRole('button', { name: '可疑度筛选', exact: true });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  return page.getByRole('group', { name: '可疑度筛选选项', exact: true }).getByRole('checkbox', { name: new RegExp(`^${reviewFilterLabels[key]}（`) });
}
export async function selectReviewFilters(page: Page, ...keys: string[]): Promise<void> {
  await (await reviewFilterChoice(page, 'all')).check();
  for (const key of keys) if (key !== 'all') await (await reviewFilterChoice(page, key)).check();
  await page.keyboard.press('Escape');
}

/** Open actual settings dialogs; retained workflow tests use the relocated public UI. */
export async function closeWorkspaceSettings(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ has: page.locator('.settings-panel, .style-panel') });
  if (await dialog.count()) { await dialog.getByRole('button', { name: '返回工作区', exact: true }).click(); await expect(dialog).not.toBeVisible(); }
}
export async function openGenerationSettings(page: Page): Promise<void> {
  const existing = page.getByRole('dialog', { name: '生成设置', exact: true });
  if (await existing.count()) return;
  await closeWorkspaceSettings(page);
  await page.getByRole('button', { name: '生成设置', exact: true }).first().click();
  await expect(existing).toBeVisible();
}
export async function jobSetting(page: Page, label: string): Promise<ReturnType<Page['getByLabel']>> {
  const style = ['文字颜色', '字体', '字幕位置', '入场效果', '双语字幕（译文 + 原文）', '强调关键词'].includes(label);
  if (style) {
    const dialog = page.getByRole('dialog', { name: '样式设置', exact: true });
    if (!await dialog.count()) { await closeWorkspaceSettings(page); await page.getByRole('button', { name: '样式设置', exact: true }).first().click(); }
  } else await openGenerationSettings(page);
  return page.getByLabel(label, { exact: true });
}
export async function workspaceButton(page: Page, name: string): Promise<ReturnType<Page['getByRole']>> {
  await closeWorkspaceSettings(page);
  const operation = ['一键生成字幕', '翻译全部字幕', '重新识别原片', '重试未完成阶段'].includes(name) ? '生成' : name.includes('生成 AI 样式') ? '样式' : null;
  if (operation) { const toolbar = page.getByRole('toolbar', { name: '视频操作' }).getByRole('button', { name: operation, exact: true }); if (await toolbar.getAttribute('aria-pressed') !== 'true') await toolbar.click(); }
  return page.getByRole('button', { name: name === '✧ 生成 AI 样式' ? '生成 AI 样式' : name, exact: true });
}
export async function styleTemplate(page: Page, name: string): Promise<ReturnType<Page['getByRole']>> {
  await jobSetting(page, '文字颜色');
  return page.getByRole('button', { name, exact: true });
}

export async function exportFormat(page: Page, format: string): Promise<void> {
  await (await workspaceButton(page, "导出作品")).click();
  await page.getByLabel("导出格式", { exact: true }).selectOption(format);
  await page
    .getByRole("button", { name: "选择保存位置并导出", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "导出操作面板", exact: true }),
  ).not.toBeVisible({ timeout: 60000 });
}

/** Internal render contract evidence; the client deliberately has no still-frame UI. */
export async function renderInternalReference(
  page: Page,
  atMs: number,
): Promise<{ url: string; job: Job }> {
  const result = await page.evaluate(async (position) => {
    const listed = await window.api.jobs.list();
    if (listed.success === false || !listed.data[0])
      throw new Error("Anonymous fixture job is absent.");
    return window.api.jobs.preview({
      jobId: listed.data[0].id,
      atMs: position,
    });
  }, atMs);
  if (result.success === false)
    throw new Error(`${result.code}: ${result.error}`);
  return result.data;
}

export async function inspectVideo(path: string): Promise<{
  width: number;
  height: number;
  codec: string;
  subtitles: number;
}> {
  const result = await execute(FFPROBE, [
    "-v",
    "error",
    "-show_streams",
    "-of",
    "json",
    path,
  ]);
  const data = z
    .object({
      streams: z.array(
        z
          .object({
            codec_type: z.string(),
            codec_name: z.string(),
            width: z.number().optional(),
            height: z.number().optional(),
          })
          .passthrough(),
      ),
    })
    .parse(JSON.parse(result.stdout) as unknown);
  const video = data.streams.find((stream) => stream.codec_type === "video");
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    codec: video?.codec_name ?? "",
    subtitles: data.streams.filter((stream) => stream.codec_type === "subtitle")
      .length,
  };
}

export async function frameDifference(
  input: string,
  output: string,
): Promise<number> {
  async function frame(path: string): Promise<Buffer> {
    const result = await execute(
      FFMPEG,
      [
        "-v",
        "error",
        "-ss",
        "0.8",
        "-i",
        path,
        "-frames:v",
        "1",
        "-vf",
        "crop=640:160:0:200",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 5000000 },
    );
    return result.stdout;
  }
  const [original, subtitled] = await Promise.all([
    frame(input),
    frame(output),
  ]);
  let difference = 0;
  let brightGlyphPixels = 0;
  for (let index = 0; index < original.length; index++)
    difference += Math.abs((original[index] ?? 0) - (subtitled[index] ?? 0));
  for (let index = 0; index < original.length; index += 3) {
    if (
      (original[index] ?? 0) < 100 &&
      (original[index + 1] ?? 0) < 100 &&
      (original[index + 2] ?? 0) < 100 &&
      (subtitled[index] ?? 0) > 180 &&
      (subtitled[index + 1] ?? 0) > 180
    )
      brightGlyphPixels++;
  }
  expect(
    brightGlyphPixels,
    "Burned subtitle glyphs must exist in decoded frames of a track-free video",
  ).toBeGreaterThan(100);
  return difference / original.length;
}

export async function assertReferenceParity(
  preview: string,
  output: string,
): Promise<void> {
  async function pixels(path: string, isPreview: boolean): Promise<Buffer> {
    const result = await execute(
      FFMPEG,
      [
        "-v",
        "error",
        ...(isPreview ? [] : ["-ss", "0.8"]),
        "-i",
        path,
        "-frames:v",
        "1",
        "-vf",
        "crop=640:160:0:200",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 5000000 },
    );
    return result.stdout;
  }
  const [reference, exported] = await Promise.all([
    pixels(preview, true),
    pixels(output, false),
  ]);
  expect(reference.length).toBe(exported.length);
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < reference.length; index += 3) {
    const inReference =
      (reference[index] ?? 0) > 160 && (reference[index + 1] ?? 0) > 160;
    const inExport =
      (exported[index] ?? 0) > 160 && (exported[index + 1] ?? 0) > 160;
    if (inReference || inExport) union++;
    if (inReference && inExport) intersection++;
  }
  expect(union).toBeGreaterThan(100);
  expect(
    intersection / union,
    "Rendered reference and encoded export must share the same subtitle glyph positions",
  ).toBeGreaterThan(0.7);
}

export async function saveEvidence(page: Page, name: string): Promise<void> {
  const directory = resolve(
    ".trellis/tasks/10-11-subtitle-workspace-layout/evidence",
  );
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(directory, name), fullPage: true });
}

export async function seedRealCpu(userData: string): Promise<void> {
  const { cp } = await import("node:fs/promises");
  await mkdir(userData, { recursive: true });
  const cpuDirectory = join(userData, "seed-cpu");
  await cp(
    resolve(".runtime-cache/whisper/cpu/Release"),
    join(cpuDirectory, "Release"),
    { recursive: true },
  );
  const path = join(userData, "ggml-base.bin");
  await cp(resolve(".runtime-cache/whisper/ggml-base.bin"), path);
  await writeFile(
    join(userData, "runtime-state.json"),
    JSON.stringify({
      version: 1,
      engineVersion: "1.8.3",
      cpuDirectory,
      gpuReady: false,
      message: "真实 CPU Base 安装状态（E2E 预先准备）",
      models: { base: { path, size: (await stat(path)).size } },
    }),
  );
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}
