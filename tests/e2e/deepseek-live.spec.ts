import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { rm, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { exportFormat, frameDifference, inspectVideo, launchApp, makeVideo, readText, renderInternalReference, seedRealCpu, importVideo } from './helpers';

// Secrets must never enter Playwright traces, recordings or automatic failure screenshots.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const LIVE_KEY = process.env.DEEPSEEK_E2E_API_KEY;
test.skip(process.env.APP_LIVE_DEEPSEEK !== '1' || !LIVE_KEY, 'Explicit live gate and session-only user key are required.');

test('live DeepSeek text translation/style over actual local Whisper and real desktop media export', async ({ playwright: _playwright }, testInfo) => {
  test.setTimeout(240000);
  const apiKey = LIVE_KEY;
  if (!apiKey) throw new Error('Live test key not available');
  delete process.env.DEEPSEEK_E2E_API_KEY;
  const calls: { path: string; status: number }[] = [];
  const capabilities: { mode: string; status: number; passed: boolean }[] = [];
  let coreWorkflowPassed = false;
  let sessionKeyAbsentAfterRestart = false;
  // Loopback is only an observation proxy: every response comes from official DeepSeek.
  // It never writes request/response bodies, headers or credentials to logs/artifacts.
  const proxy = createServer((request, response) => {
    async function forward(): Promise<void> {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const path = request.url ?? '/';
      const upstream = await fetch(`https://api.deepseek.com${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(request.headers.authorization ? { Authorization: request.headers.authorization } : {}), ...(request.headers['x-api-key'] ? { 'x-api-key': String(request.headers['x-api-key']), 'anthropic-version': String(request.headers['anthropic-version'] ?? '2023-06-01') } : {}) }, body: Buffer.concat(chunks) });
      calls.push({ path, status: upstream.status });
      response.writeHead(upstream.status, { 'Content-Type': 'application/json' }); response.end(await upstream.text());
    }
    void forward().catch(() => { if (!response.headersSent) response.writeHead(502); response.end('{"error":"Upstream connection unavailable"}'); });
  });
  await new Promise<void>((ready) => proxy.listen(0, '127.0.0.1', ready));
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('Live observation proxy port unavailable');
  const origin = `http://127.0.0.1:${address.port}`;
  const userData = testInfo.outputPath('live-session-data');
  if (!resolve(userData).startsWith(resolve(testInfo.outputPath('.')) + '\\')) throw new Error('Unexpected isolated test output path');
  const input = testInfo.outputPath('live-local-jfk.mp4');
  const outputs = ['srt', 'ass', 'vtt', 'mp4'].map((format) => testInfo.outputPath(`deepseek-live.${format}`));
  let app: ElectronApplication | undefined;
  async function profile(page: Page, name: string, protocol: 'openai' | 'anthropic', baseUrl: string, mode: 'chat' | 'responses' = 'chat'): Promise<void> {
    await page.getByRole('button', { name: 'API 服务', exact: true }).click();
    await page.getByRole('button', { name: '添加服务', exact: true }).click();
    await page.getByLabel('配置名称', { exact: true }).fill(name);
    await page.getByLabel('协议', { exact: true }).selectOption(protocol);
    if (protocol === 'openai') await page.getByLabel('文本接口', { exact: true }).selectOption(mode);
    await page.getByLabel('接口地址', { exact: true }).fill(baseUrl);
    await page.getByLabel('模型 ID', { exact: true }).fill('deepseek-flash');
    const keyInput = page.getByLabel('API Key', { exact: true });
    await expect(keyInput).toBeVisible();
    // evaluate avoids Playwright fill action error logs including the entered secret.
    await keyInput.evaluate((element: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('Input setter unavailable');
      setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true }));
    }, apiKey ?? '');
    await page.getByLabel('仅本次会话使用密钥', { exact: true }).check();
    if (protocol === 'openai') await page.getByLabel('服务已确认支持 JSON 输出模式', { exact: true }).check();
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'API 服务', exact: true })).toBeVisible();
    await page.getByLabel('关闭对话框', { exact: true }).click();
  }
  try {
    await makeVideo(input, true); await seedRealCpu(userData);
    const sourceHash = createHash('sha256').update(await readFile(input)).digest('hex');
    const launched = await launchApp(userData, [input], outputs); app = launched.app;
    const page = launched.page;
    await profile(page, 'DeepSeek live Chat', 'openai', origin);
    await importVideo(page);
    await page.getByLabel('优先使用 NVIDIA GPU', { exact: true }).click();
    await expect(page.getByLabel('优先使用 NVIDIA GPU', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('翻译服务', { exact: true })).toBeEnabled();
    await page.getByLabel('翻译服务', { exact: true }).selectOption({ label: 'DeepSeek live Chat' });
    await expect(page.getByLabel('AI 样式服务（可选）', { exact: true })).toBeEnabled();
    await page.getByLabel('AI 样式服务（可选）', { exact: true }).selectOption({ label: 'DeepSeek live Chat' });
    await expect(page.getByRole('button', { name: '一键生成字幕', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '一键生成字幕', exact: true }).click();
    await expect(page.getByTestId('segment-0')).toContainText(/country|fellow/i, { timeout: 90000 });
    await expect(page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeEnabled({ timeout: 90000 });
    await expect(page.getByTestId('segment-0').locator('.subtitle-row__translation')).toContainText(/[\u3400-\u9fff]/);
    expect(calls.filter((call) => call.path.endsWith('/chat/completions'))).toHaveLength(1);
    await page.getByRole('button', { name: '编辑字幕 1', exact: true }).click();
    await page.getByLabel('译文', { exact: true }).fill('人工校对：不要问国家能为你做什么。');
    await page.getByRole('button', { name: '保存字幕', exact: true }).click();
    await expect(page.locator('.segment-editor')).toHaveCount(0);
    await page.getByLabel('选择字幕 1', { exact: true }).check();
    await page.getByRole('button', { name: '重译选中（1）', exact: true }).click();
    await page.getByRole('button', { name: '翻译选定片段', exact: true }).click();
    await expect(page.getByRole('button', { name: '重译选中（1）', exact: true })).toBeEnabled({ timeout: 60000 });
    await expect(page.getByTestId('segment-0').locator('.subtitle-row__translation')).toContainText(/[\u3400-\u9fff]/);
    await page.getByLabel('AI 设计描述', { exact: true }).fill('请选择电影感模板，白色字、黑色描边、淡入淡出，底部居中。不要设置任何关键词强调。');
    await page.getByRole('button', { name: '✧ 生成 AI 样式', exact: true }).click();
    await expect(page.getByRole('button', { name: '✧ 生成 AI 样式', exact: true })).toBeEnabled({ timeout: 60000 });
    await expect(page.getByRole('alert')).not.toBeVisible();
    await page.locator('video').evaluate((element: HTMLVideoElement) => { element.currentTime = .8; element.dispatchEvent(new Event('timeupdate')); });
    await expect(page.getByRole('button', { name: '渲染当前参考画面', exact: true })).toHaveCount(0);
    await renderInternalReference(page, 800);
    await expect(page.getByRole('img', { name: '使用导出渲染器生成的字幕参考画面', exact: true })).toHaveCount(0);
    for (const format of ['srt', 'ass', 'vtt', 'mp4']) await exportFormat(page, format);
    for (const output of outputs.slice(0, 3)) expect(await readText(output)).toMatch(/[\u3400-\u9fff]/);
    const mp4 = outputs[3]; if (!mp4) throw new Error('Missing live output');
    expect(await inspectVideo(mp4)).toEqual({ width: 640, height: 360, codec: 'h264', subtitles: 0 });
    expect(await frameDifference(input, mp4)).toBeGreaterThan(.3);
    expect(createHash('sha256').update(await readFile(input)).digest('hex')).toBe(sourceHash);
    coreWorkflowPassed = true;
    // One small real request for each further officially documented text mode.
    await profile(page, 'DeepSeek live Responses', 'openai', origin, 'responses');
    await profile(page, 'DeepSeek live Anthropic', 'anthropic', `${origin}/anthropic/v1`);
    await page.getByRole('button', { name: 'API 服务', exact: true }).click();
    for (const name of ['DeepSeek live Responses', 'DeepSeek live Anthropic']) {
      const previousCalls = calls.length;
      const card = page.locator('.profile-card').filter({ has: page.getByText(name, { exact: true }) });
      await card.getByRole('button', { name: '测试连接', exact: true }).click();
      await expect.poll(() => calls.length).toBeGreaterThan(previousCalls);
      await expect(card.getByRole('button', { name: '测试连接', exact: true })).toBeEnabled({ timeout: 60000 });
      const observed = calls.slice(previousCalls);
      capabilities.push({ mode: name, status: observed.at(-1)?.status ?? 0, passed: await page.getByText('连接与文本 JSON 输出测试通过。', { exact: true }).isVisible() });
    }
    expect(calls.some((call) => call.path === '/responses')).toBe(true);
    expect(calls.some((call) => call.path === '/anthropic/v1/messages')).toBe(true);
    await page.getByLabel('关闭对话框', { exact: true }).click();
    await app.close(); app = undefined;
    const reopened = await launchApp(userData, [], []); app = reopened.app;
    await expect(reopened.page.getByTestId('segment-0').locator('.subtitle-row__translation')).toContainText(/[\u3400-\u9fff]/);
    await reopened.page.getByRole('button', { name: 'API 服务', exact: true }).click();
    await expect(reopened.page.locator('.profile-card')).toHaveCount(3);
    for (const card of await reopened.page.locator('.profile-card').all()) await expect(card).toContainText('未配置密钥');
    sessionKeyAbsentAfterRestart = true;
    expect(calls.filter((call) => call.path === '/chat/completions').every((call) => call.status === 200)).toBe(true);
    expect(calls.every((call) => !call.path.includes('audio/transcriptions'))).toBe(true);
    const evidence = { model: 'deepseek-flash', officialOrigin: 'https://api.deepseek.com', observationProxy: 'loopback forwarding only; no simulated provider responses', realRecognition: 'whisper.cpp Base CPU', coreWorkflowPassed, totalApiCalls: calls.length, calls, optionalCapabilities: capabilities, exports: outputs.map((path) => path.split(/[\\/]/).pop()), sourcePreserved: true, sessionKeyAbsentAfterRestart, traceRecording: false };
    await testInfo.attach('live-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    const directory = resolve('.trellis/tasks/10-11-subtitle-workspace-layout/evidence'); await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'deepseek-live-result.json'), JSON.stringify(evidence, null, 2));
  } finally {
    await app?.close(); proxy.closeAllConnections(); await new Promise<void>((closed) => proxy.close(() => closed()));
    delete process.env.DEEPSEEK_E2E_API_KEY;
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    const directory = resolve('.trellis/tasks/10-11-subtitle-workspace-layout/evidence'); await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'deepseek-live-last-attempt.json'), JSON.stringify({ model: 'deepseek-flash', coreWorkflowPassed, sessionKeyAbsentAfterRestart, totalApiCalls: calls.length, calls, optionalCapabilities: capabilities, credentialsCleaned: true }, null, 2));
  }
});

test('live DeepSeek compatibility-only Responses and Anthropic desktop probes with exact auth forwarding', async ({ playwright: _playwright }, testInfo) => {
  const apiKey = LIVE_KEY;
  if (!apiKey) throw new Error('Live key unavailable');
  delete process.env.DEEPSEEK_E2E_API_KEY;
  const calls: { path: string; status: number; hasBearer: boolean; hasApiKey: boolean }[] = [];
  const proxy = createServer((request, response) => {
    async function forward(): Promise<void> {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const path = request.url ?? '/';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (request.headers.authorization) headers.Authorization = request.headers.authorization;
      if (request.headers['x-api-key']) headers['x-api-key'] = String(request.headers['x-api-key']);
      if (request.headers['anthropic-version']) headers['anthropic-version'] = String(request.headers['anthropic-version']);
      const result = await fetch(`https://api.deepseek.com${path}`, { method: 'POST', headers, body: Buffer.concat(chunks) });
      calls.push({ path, status: result.status, hasBearer: Boolean(headers.Authorization?.startsWith('Bearer ')), hasApiKey: Boolean(headers['x-api-key']) });
      response.writeHead(result.status, { 'Content-Type': 'application/json' }); response.end(await result.text());
    }
    void forward().catch(() => { response.writeHead(502); response.end('{}'); });
  });
  await new Promise<void>((ready) => proxy.listen(0, '127.0.0.1', ready));
  const address = proxy.address(); if (!address || typeof address === 'string') throw new Error('Proxy not bound');
  const userData = testInfo.outputPath('live-capability-data');
  if (!resolve(userData).startsWith(resolve(testInfo.outputPath('.')) + '\\')) throw new Error('Unexpected isolated test output path');
  let app: ElectronApplication | undefined;
  try {
    const launched = await launchApp(userData, [], []); app = launched.app; const page = launched.page;
    for (const mode of ['responses', 'anthropic'] as const) {
      await page.getByRole('button', { name: 'API 服务', exact: true }).click();
      await page.getByRole('button', { name: '添加服务', exact: true }).click();
      await page.getByLabel('配置名称', { exact: true }).fill(`DeepSeek ${mode}`);
      await page.getByLabel('协议', { exact: true }).selectOption(mode === 'responses' ? 'openai' : 'anthropic');
      if (mode === 'responses') await page.getByLabel('文本接口', { exact: true }).selectOption('responses');
      await page.getByLabel('接口地址', { exact: true }).fill(`http://127.0.0.1:${address.port}${mode === 'anthropic' ? '/anthropic/v1' : ''}`);
      await page.getByLabel('模型 ID', { exact: true }).fill('deepseek-flash');
      const keyInput = page.getByLabel('API Key', { exact: true }); await expect(keyInput).toBeVisible();
      await keyInput.evaluate((element: HTMLInputElement, value: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!setter) throw new Error('Input setter unavailable');
        setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true }));
      }, apiKey);
      await page.getByLabel('仅本次会话使用密钥', { exact: true }).check();
      await page.getByRole('button', { name: '保存配置', exact: true }).click();
      const previousCalls = calls.length;
      const card = page.locator('.profile-card').filter({ has: page.getByText(`DeepSeek ${mode}`, { exact: true }) });
      await card.getByRole('button', { name: '测试连接', exact: true }).click();
      await expect.poll(() => calls.length).toBeGreaterThan(previousCalls);
      await expect(card.getByRole('button', { name: '测试连接', exact: true })).toBeEnabled({ timeout: 60000 });
      await expect(page.getByText('连接与文本 JSON 输出测试通过。', { exact: true })).toBeVisible();
      await page.getByLabel('关闭对话框', { exact: true }).click();
    }
    expect(calls).toEqual([{ path: '/responses', status: 200, hasBearer: true, hasApiKey: false }, { path: '/anthropic/v1/messages', status: 200, hasBearer: false, hasApiKey: true }]);
    const summary = { model: 'deepseek-flash', officialOrigin: 'https://api.deepseek.com', totalApiCalls: calls.length, calls, mockedResponses: false, credentialsLogged: false, priorAnthropic401Cause: 'Observation proxy injected an empty Authorization header; fixed by forwarding only actual protocol headers.' };
    await testInfo.attach('live-protocol-evidence', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
    await writeFile(resolve('.trellis/tasks/10-11-subtitle-workspace-layout/evidence/deepseek-live-modes.json'), JSON.stringify(summary, null, 2));
  } finally {
    await app?.close(); proxy.closeAllConnections(); await new Promise<void>((closed) => proxy.close(() => closed()));
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    delete process.env.DEEPSEEK_E2E_API_KEY;
  }
});



