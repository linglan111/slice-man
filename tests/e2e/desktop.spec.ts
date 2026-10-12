import { jobSetting, workspaceButton, styleTemplate, closeWorkspaceSettings } from './helpers';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { addProfile, assertReferenceParity, configureCloud, exportFormat, frameDifference, inspectVideo, launchApp, makeVideo, readText, renderInternalReference, saveEvidence, startMockServer, importVideo } from './helpers';

test('real desktop cloud workflow, all text protocols, corrections, rendering, exports and restart persistence', async ({ playwright: _playwright }, testInfo) => {
  const mock = await startMockServer();
  const userData = testInfo.outputPath('isolated-user-data');
  const input = testInfo.outputPath('中文 视频 input.mp4');
  const outputs = ['srt', 'ass', 'vtt', 'mp4', 'mkv'].map((format) => testInfo.outputPath(`已翻译 output.${format}`));
  await makeVideo(input);
  const inputHash = createHash('sha256').update(await readFile(input)).digest('hex');
  let app: ElectronApplication | undefined;
  try {
    const first = await launchApp(userData, [input], outputs); app = first.app;
    const page = first.page;
    await saveEvidence(page, 'desktop-empty.png');
    await addProfile(page, 'Cloud / Chat', 'openai', mock.url);
    await addProfile(page, 'OpenAI Responses', 'openai', mock.url, 'responses');
    await addProfile(page, 'Anthropic', 'anthropic', mock.url);
    await addProfile(page, 'Gemini', 'gemini', mock.url);
    await page.getByRole('button', { name: 'API 服务', exact: true }).click();
    for (const name of ['Cloud / Chat', 'OpenAI Responses', 'Anthropic', 'Gemini']) {
      await page.locator('.profile-card').filter({ has: page.getByText(name, { exact: true }) }).getByRole('button', { name: '测试连接', exact: true }).click();
      await expect(page.getByText('连接与文本 JSON 输出测试通过。', { exact: true })).toBeVisible();
    }
    await page.getByLabel('连接测试用途', { exact: true }).selectOption('recognition');
    await page.locator('.profile-card').filter({ has: page.getByText('Cloud / Chat', { exact: true }) }).getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(page.getByText('音频上传和片段时间戳结构测试通过。静音测试不验证实际识别准确率。', { exact: true })).toBeVisible();
    await page.locator('.profile-card').filter({ has: page.getByText('Cloud / Chat', { exact: true }) }).getByRole('button', { name: '编辑', exact: true }).click();
    await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('placeholder', /已保存密钥/);
    for (let index = 0; index < 5; index++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'API 服务', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await importVideo(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('中文 视频 input.mp4');
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState), { timeout: 15000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBe(640);
    await page.locator('video').evaluate(async (video: HTMLVideoElement) => { await video.play(); });
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(.2);
    await page.locator('video').evaluate((video: HTMLVideoElement) => { video.pause(); });
    await configureCloud(page, 'Cloud / Chat');
    await (await jobSetting(page, 'AI 样式服务（可选）')).selectOption({ label: 'Gemini' });
    await (await workspaceButton(page, '一键生成字幕')).click();
    await expect(page.getByTestId('segment-0')).toContainText('你好，世界。');
    await expect((await workspaceButton(page, '翻译全部字幕'))).toBeEnabled();
    for (const name of ['OpenAI Responses', 'Anthropic', 'Gemini']) {
      await (await jobSetting(page, '翻译服务')).selectOption({ label: name });
      await expect((await workspaceButton(page, '翻译全部字幕'))).toBeEnabled();
      await (await workspaceButton(page, '翻译全部字幕')).click();
      await expect((await workspaceButton(page, '翻译全部字幕'))).toBeEnabled();
      await expect(page.getByTestId('segment-1')).toContainText('这是第二句话。');
    }
    expect(mock.counters.recognition).toBe(1);
    expect(mock.counters.translation).toBe(4);
    await page.getByRole('button', { name: '编辑字幕 1', exact: true }).click();
    await page.getByLabel('结束时间（秒）', { exact: true }).fill('4.001');
    await page.getByRole('button', { name: '保存字幕', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('视频时长');
    await page.getByLabel('开始时间（秒）', { exact: true }).fill('0.123');
    await page.getByLabel('结束时间（秒）', { exact: true }).fill('1.800');
    await page.getByLabel('译文', { exact: true }).fill('已人工校对，世界你好。');
    await page.getByRole('button', { name: '保存字幕', exact: true }).click();
    await expect(page.locator('.segment-editor')).toHaveCount(0);
    await page.getByLabel('选择字幕 2', { exact: true }).check();
    await page.getByRole('button', { name: '重译选中（1）', exact: true }).click();
    await page.getByRole('button', { name: '翻译选定片段', exact: true }).click();
    await expect(page.getByTestId('segment-1')).toContainText('已重译：A second sentence.');
    await expect(page.getByTestId('segment-0')).toContainText('已人工校对，世界你好。');
    await (await styleTemplate(page, '电影感模板')).click();
    await expect((await jobSetting(page, '双语字幕（译文 + 原文）'))).toBeEnabled();
    await (await jobSetting(page, '双语字幕（译文 + 原文）')).click();
    await expect((await jobSetting(page, '双语字幕（译文 + 原文）'))).toBeChecked();
    await workspaceButton(page, '✧ 生成 AI 样式');
    await expect(page.getByLabel('AI 设计描述', { exact: true })).toBeEnabled();
    await page.getByLabel('AI 设计描述', { exact: true }).fill('电影感，淡黄色字幕');
    await (await workspaceButton(page, '✧ 生成 AI 样式')).click();
    await expect((await jobSetting(page, '文字颜色'))).toHaveValue('#fff5c2');
    await expect(page.getByRole('button', { name: '渲染当前参考画面', exact: true })).toHaveCount(0);
    await page.locator('video').evaluate((element: HTMLVideoElement) => { element.currentTime = .8; element.dispatchEvent(new Event('timeupdate')); });
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.seeking)).toBe(false);
    await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(.8, 1);
    await renderInternalReference(page, 800);
    await expect(page.getByRole('img', { name: '使用导出渲染器生成的字幕参考画面', exact: true })).toHaveCount(0);
    await saveEvidence(page, 'desktop-bilingual-live-preview.png');
    for (const format of ['srt', 'ass', 'vtt', 'mp4', 'mkv']) await exportFormat(page, format);
    for (const path of outputs.slice(0, 3)) {
      const text = await readText(path);
      expect(text).toContain('已人工校对，世界你好。');
      expect(text).toContain('已重译：A second sentence.');
    }
    expect(await readText(outputs[0] ?? '')).toContain('00:00:00,123');
    expect(await readText(outputs[1] ?? '')).toContain('Noto Sans CJK SC');
    expect(await readText(outputs[2] ?? '')).toContain('00:00:00.123');
    const mp4 = outputs[3]; const mkv = outputs[4];
    if (!mp4 || !mkv) throw new Error('Missing test video output path');
    expect(await inspectVideo(mp4)).toEqual({ width: 640, height: 360, codec: 'h264', subtitles: 0 });
    expect(await inspectVideo(mkv)).toEqual({ width: 640, height: 360, codec: 'h264', subtitles: 0 });
    expect(await frameDifference(input, mp4)).toBeGreaterThan(.3);
    const jobDirectories = await readdir(resolve(userData, 'jobs'));
    const nativeJobDirectory = jobDirectories[0]; if (!nativeJobDirectory) throw new Error('Missing native job artifacts');
    const artifactDirectory = resolve(userData, 'jobs', nativeJobDirectory);
    const previewName = (await readdir(artifactDirectory)).find((name) => name.startsWith('preview-') && name.endsWith('.png'));
    if (!previewName) throw new Error('Missing actual reference artifact');
    await assertReferenceParity(resolve(artifactDirectory, previewName), mp4);
    expect(createHash('sha256').update(await readFile(input)).digest('hex')).toBe(inputHash);
    await app.close(); app = undefined;
    const restarted = await launchApp(userData, [], []); app = restarted.app;
    await expect(restarted.page.getByTestId('segment-0')).toContainText('已人工校对，世界你好。');
    await expect(restarted.page.getByText(mp4, { exact: true })).toBeVisible();
    await expect((await jobSetting(restarted.page, '双语字幕（译文 + 原文）'))).toBeChecked();
    await expect(restarted.page.getByRole('img', { name: '使用导出渲染器生成的字幕参考画面', exact: true })).not.toBeVisible();
    await closeWorkspaceSettings(restarted.page);
    await restarted.page.getByRole('button', { name: 'API 服务', exact: true }).click();
    await expect(restarted.page.locator('.profile-card')).toHaveCount(4);
    await expect(restarted.page.locator('.profile-card').first()).toContainText('密钥已配置');
    expect(mock.counters.recognition).toBe(1);
    await testInfo.attach('evidence-summary', { body: JSON.stringify({ mockedAI: true, realMedia: true, inputHashPreserved: true, ...mock.counters }), contentType: 'application/json' });
  } finally { await app?.close(); await mock.close(); }
});

test('restart recovers interrupted work and missing original media fails without losing corrected subtitles', async ({ playwright: _playwright }, testInfo) => {
  const mock = await startMockServer();
  const input = testInfo.outputPath('restart-source.mp4'); await makeVideo(input);
  const userData = testInfo.outputPath('user-data');
  let app: ElectronApplication | undefined;
  try {
    const first = await launchApp(userData, [input], []); app = first.app; const page = first.page;
    await addProfile(page, 'Restart service', 'openai', mock.url);
    await importVideo(page); await configureCloud(page, 'Restart service');
    mock.behavior.translation = 'slow';
    await (await workspaceButton(page, '一键生成字幕')).click();
    await expect.poll(() => mock.counters.translation).toBe(1);
    await expect(page.getByTestId('segment-0')).toContainText('Hello world.');
    await app.close(); app = undefined;
    mock.behavior.translation = 'ok';
    const restarted = await launchApp(userData, [], []); app = restarted.app;
    await expect(restarted.page.getByTestId('segment-0')).toContainText('Hello world.');
    await expect(restarted.page.locator('.stage-pill').filter({ hasText: '字幕翻译' })).toContainText(/已中断|已取消/);
    await expect(restarted.page.getByRole('button', { name: '重试未完成阶段', exact: true })).toHaveCount(0);
    await (await workspaceButton(restarted.page, '翻译全部字幕')).click();
    await expect(restarted.page.getByTestId('segment-0')).toContainText('你好，世界。');
    expect(mock.counters.recognition).toBe(1);
    await expect((await workspaceButton(restarted.page, '翻译全部字幕'))).toBeEnabled();
    await rm(input);
    const missing = await restarted.page.evaluate(async () => { const jobs = await window.api.jobs.list(); if (jobs.success === false || !jobs.data[0]) throw new Error('Fixture missing'); return window.api.jobs.preview({ jobId: jobs.data[0].id, atMs: 0 }); });
    expect(missing.success).toBe(false);
    if (missing.success === false) expect(missing.code).toBe('INPUT_MISSING');
    await expect(restarted.page.getByTestId('segment-0')).toContainText('你好，世界。');
    await expect(restarted.page.getByRole('img')).not.toBeVisible();
  } finally { await app?.close(); await mock.close(); }
});

test('editing a provider model invalidates dependent stages while renaming preserves completed work', async ({ playwright: _playwright }, testInfo) => {
  const mock = await startMockServer();
  const input = testInfo.outputPath('profile-source.mp4'); await makeVideo(input);
  const { app, page } = await launchApp(testInfo.outputPath('user-data'), [input], []);
  try {
    await addProfile(page, 'Original service', 'openai', mock.url);
    await importVideo(page);
    await configureCloud(page, 'Original service');
    await (await workspaceButton(page, '一键生成字幕')).click();
    await expect(page.getByTestId('segment-0')).toContainText('你好，世界。');
    await expect((await workspaceButton(page, '翻译全部字幕'))).toBeEnabled();
    await page.getByRole('button', { name: 'API 服务', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('配置名称', { exact: true }).fill('Renamed service');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await page.getByLabel('关闭对话框', { exact: true }).click();
    await expect(page.locator('.stage-pill').filter({ hasText: '语音识别' })).toContainText('已完成');
    await expect(page.getByTestId('segment-0')).not.toContainText('待重译');
    expect(mock.counters.recognition).toBe(1);
    await page.getByRole('button', { name: 'API 服务', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('模型 ID', { exact: true }).fill('another-mock-model');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await page.getByLabel('关闭对话框', { exact: true }).click();
    await expect(page.locator('.stage-pill').filter({ hasText: '语音识别' })).toContainText('待处理');
    await expect(page.getByTestId('segment-0')).toContainText('待重译');
    await expect((await workspaceButton(page, '翻译全部字幕'))).toBeDisabled();
    await expect(page.getByText('识别设置已变化，请先重新识别原片，再翻译。', { exact: true })).toBeVisible();
    await (await workspaceButton(page, '重新识别原片')).click();
    await page.getByRole('button', { name: '确认重新识别', exact: true }).click();
    await expect((await workspaceButton(page, '翻译全部字幕'))).toBeEnabled();
    await (await workspaceButton(page, '翻译全部字幕')).click();
    await expect((await workspaceButton(page, '翻译全部字幕'))).toBeEnabled();
    expect(mock.counters.recognition).toBe(2);
    expect(mock.counters.translation).toBe(2);
  } finally { await app.close(); await mock.close(); }
});

test('recoverable API failure, retry without repeated recognition, cancel and invalid AI style preserve edits', async ({ playwright: _playwright }, testInfo) => {
  const mock = await startMockServer();
  const input = testInfo.outputPath('input.mp4'); await makeVideo(input);
  const { app, page } = await launchApp(testInfo.outputPath('user-data'), [input], []);
  try {
    await addProfile(page, 'Test service', 'openai', mock.url);
    await importVideo(page);
    await configureCloud(page, 'Test service');
    mock.behavior.translation = 'auth-error';
    await (await workspaceButton(page, '一键生成字幕')).click();
    await expect(page.getByRole('alert')).toContainText('AUTH_ERROR');
    await expect(page.getByTestId('segment-0')).toContainText('Hello world.');
    mock.behavior.translation = 'ok';
    await expect(page.getByRole('button', { name: '重试未完成阶段', exact: true })).toHaveCount(0);
    await (await workspaceButton(page, '翻译全部字幕')).click();
    await expect(page.getByTestId('segment-0')).toContainText('你好，世界。');
    expect(mock.counters.recognition).toBe(1);
    mock.behavior.translation = 'slow';
    const initialCalls = mock.counters.translation;
    await (await workspaceButton(page, '翻译全部字幕')).click();
    await expect.poll(() => mock.counters.translation).toBeGreaterThan(initialCalls);
    await page.getByRole('button', { name: '取消当前处理', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('CANCELLED');
    await expect(page.getByTestId('segment-0')).toContainText('你好，世界。');
    mock.behavior.translation = 'ok';
    await expect(page.getByRole('button', { name: '重试未完成阶段', exact: true })).toHaveCount(0);
    await (await workspaceButton(page, '翻译全部字幕')).click();
    await expect((await workspaceButton(page, '翻译全部字幕'))).toBeEnabled();
    expect(mock.counters.recognition).toBe(1);
    await (await jobSetting(page, 'AI 样式服务（可选）')).selectOption({ label: 'Test service' });
    await workspaceButton(page, '✧ 生成 AI 样式');
    await expect(page.getByLabel('AI 设计描述', { exact: true })).toBeEnabled();
    await page.getByLabel('AI 设计描述', { exact: true }).fill('invalid fixture style');
    mock.behavior.style = 'invalid';
    await (await workspaceButton(page, '✧ 生成 AI 样式')).click();
    await expect(page.getByRole('region', { name: '样式操作面板', exact: true }).getByRole('alert')).toContainText('STYLE_INVALID');
    await expect((await jobSetting(page, '文字颜色'))).toHaveValue('#ffffff');
    expect(mock.counters.style).toBe(2);
  } finally { await app.close(); await mock.close(); }
});

test('one-click real CPU installation, real Whisper inference and failed/cancelled updates retain working runtime', async ({ playwright: _playwright }, testInfo) => {
  test.setTimeout(180000);
  const mock = await startMockServer();
  const userData = testInfo.outputPath('native-user-data');
  const input = testInfo.outputPath('真实识别.mp4'); await makeVideo(input, true);
  const artifactUrl = mock.url.replace('/v1', '/artifacts');
  const cpu = { url: `${artifactUrl}/cpu.zip`, sha256: 'd824b1e37599f882b396e73f1ee0bfd5d0529f700314c48311dcbd00b803321d', sizeBytes: 3968674 };
  const base = { url: `${artifactUrl}/ggml-base.bin`, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', sizeBytes: 147951465, name: 'Base 实际模型' };
  const manifestPath = testInfo.outputPath('trusted-loopback-manifest.json');
  await writeFile(manifestPath, JSON.stringify({ cpu, gpu: cpu, models: { base, small: base, 'large-v3-turbo': base } }));
  const { app, page } = await launchApp(userData, [input], [], { APP_E2E_RUNTIME_MANIFEST: manifestPath });
  try {
    await page.getByRole('button', { name: /本地引擎/, exact: false }).first().click();
    await page.getByLabel('安装并验证 NVIDIA 加速（若可用）', { exact: true }).uncheck();
    await page.getByRole('button', { name: '一键安装所选模型', exact: true }).click();
    await expect(page.getByText('CPU 识别已通过实际测试。', { exact: true })).toBeVisible({ timeout: 90000 });
    await expect(page.getByRole('button', { name: '一键安装所选模型', exact: true })).toBeEnabled();
    const stateBefore = await readText(resolve(userData, 'runtime-state.json'));
    mock.behavior.artifact = 'slow';
    await page.getByRole('button', { name: '一键安装所选模型', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消安装', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消安装', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('CANCELLED');
    expect(await readText(resolve(userData, 'runtime-state.json'))).toBe(stateBefore);
    mock.behavior.artifact = 'corrupt';
    await page.getByRole('button', { name: '一键安装所选模型', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/校验|完整|大小/);
    expect(await readText(resolve(userData, 'runtime-state.json'))).toBe(stateBefore);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await addProfile(page, 'Mock translator', 'openai', mock.url);
    await importVideo(page);
    await (await jobSetting(page, '优先使用 NVIDIA GPU')).click();
    await expect((await jobSetting(page, '优先使用 NVIDIA GPU'))).not.toBeChecked();
    await expect((await jobSetting(page, '翻译服务'))).toBeEnabled();
    await (await jobSetting(page, '翻译服务')).selectOption({ label: 'Mock translator' });
    await expect((await workspaceButton(page, '一键生成字幕'))).toBeEnabled();
    await (await workspaceButton(page, '一键生成字幕')).click();
    await expect(page.getByTestId('segment-0')).toContainText(/country|fellow/i, { timeout: 90000 });
    await expect(page.getByRole('heading', { level: 1 }).locator('..')).toContainText('CPU');
    expect(mock.counters.recognition).toBe(0);
    expect(mock.counters.translation).toBeGreaterThan(0);
    await saveEvidence(page, 'desktop-real-cpu-recognition.png');
    await testInfo.attach('native-evidence', { body: 'Real CPU archive/model downloaded from loopback fixture with pinned integrity checks; genuine runtime smoke test and actual whisper.cpp Base speech inference. AI translation mocked; GPU deliberately disabled in this case.', contentType: 'text/plain' });
  } finally { await app.close(); await mock.close(); }
});




