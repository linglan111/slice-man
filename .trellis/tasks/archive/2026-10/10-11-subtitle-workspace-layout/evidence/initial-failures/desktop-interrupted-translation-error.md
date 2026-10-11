# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop.spec.ts >> restart recovers interrupted work and missing original media fails without losing corrected subtitles
- Location: tests\e2e\desktop.spec.ts:126:5

# Error details

```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '重试未完成阶段', exact: true })

```

# Test source

```ts
  45  |     await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(.2);
  46  |     await page.locator('video').evaluate((video: HTMLVideoElement) => { video.pause(); });
  47  |     await configureCloud(page, 'Cloud / Chat');
  48  |     await page.getByLabel('AI 样式服务（可选）', { exact: true }).selectOption({ label: 'Gemini' });
  49  |     await page.getByRole('button', { name: '一键生成字幕', exact: true }).click();
  50  |     await expect(page.getByTestId('segment-0')).toContainText('你好，世界。');
  51  |     await expect(page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeEnabled();
  52  |     for (const name of ['OpenAI Responses', 'Anthropic', 'Gemini']) {
  53  |       await page.getByLabel('翻译服务', { exact: true }).selectOption({ label: name });
  54  |       await expect(page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeEnabled();
  55  |       await page.getByRole('button', { name: '翻译全部字幕', exact: true }).click();
  56  |       await expect(page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeEnabled();
  57  |       await expect(page.getByTestId('segment-1')).toContainText('这是第二句话。');
  58  |     }
  59  |     expect(mock.counters.recognition).toBe(1);
  60  |     expect(mock.counters.translation).toBe(4);
  61  |     await page.getByRole('button', { name: '编辑字幕 1', exact: true }).click();
  62  |     await page.getByLabel('结束时间（秒）', { exact: true }).fill('4.001');
  63  |     await page.getByRole('button', { name: '保存字幕', exact: true }).click();
  64  |     await expect(page.getByRole('alert')).toContainText('视频时长');
  65  |     await page.getByLabel('开始时间（秒）', { exact: true }).fill('0.123');
  66  |     await page.getByLabel('结束时间（秒）', { exact: true }).fill('1.800');
  67  |     await page.getByLabel('译文', { exact: true }).fill('已人工校对，世界你好。');
  68  |     await page.getByRole('button', { name: '保存字幕', exact: true }).click();
  69  |     await expect(page.locator('.segment-editor')).toHaveCount(0);
  70  |     await page.getByLabel('选择字幕 2', { exact: true }).check();
  71  |     await page.getByRole('button', { name: '重译选中（1）', exact: true }).click();
  72  |     await page.getByRole('button', { name: '翻译选定片段', exact: true }).click();
  73  |     await expect(page.getByTestId('segment-1')).toContainText('已重译：A second sentence.');
  74  |     await expect(page.getByTestId('segment-0')).toContainText('已人工校对，世界你好。');
  75  |     await page.getByRole('button', { name: '电影感模板', exact: true }).click();
  76  |     await expect(page.getByLabel('双语字幕（译文 + 原文）', { exact: true })).toBeEnabled();
  77  |     await page.getByLabel('双语字幕（译文 + 原文）', { exact: true }).click();
  78  |     await expect(page.getByLabel('双语字幕（译文 + 原文）', { exact: true })).toBeChecked();
  79  |     await expect(page.getByLabel('AI 设计描述', { exact: true })).toBeEnabled();
  80  |     await page.getByLabel('AI 设计描述', { exact: true }).fill('电影感，淡黄色字幕');
  81  |     await page.getByRole('button', { name: '✧ 生成 AI 样式', exact: true }).click();
  82  |     await expect(page.getByLabel('文字颜色', { exact: true })).toHaveValue('#fff5c2');
  83  |     await expect(page.getByRole('button', { name: '渲染当前参考画面', exact: true })).toHaveCount(0);
  84  |     await page.locator('video').evaluate((element: HTMLVideoElement) => { element.currentTime = .8; element.dispatchEvent(new Event('timeupdate')); });
  85  |     await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.seeking)).toBe(false);
  86  |     await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(.8, 1);
  87  |     await renderInternalReference(page, 800);
  88  |     await expect(page.getByRole('img', { name: '使用导出渲染器生成的字幕参考画面', exact: true })).toHaveCount(0);
  89  |     await saveEvidence(page, 'desktop-bilingual-live-preview.png');
  90  |     for (const format of ['srt', 'ass', 'vtt', 'mp4', 'mkv']) await exportFormat(page, format);
  91  |     for (const path of outputs.slice(0, 3)) {
  92  |       const text = await readText(path);
  93  |       expect(text).toContain('已人工校对，世界你好。');
  94  |       expect(text).toContain('已重译：A second sentence.');
  95  |     }
  96  |     expect(await readText(outputs[0] ?? '')).toContain('00:00:00,123');
  97  |     expect(await readText(outputs[1] ?? '')).toContain('Noto Sans CJK SC');
  98  |     expect(await readText(outputs[2] ?? '')).toContain('00:00:00.123');
  99  |     const mp4 = outputs[3]; const mkv = outputs[4];
  100 |     if (!mp4 || !mkv) throw new Error('Missing test video output path');
  101 |     expect(await inspectVideo(mp4)).toEqual({ width: 640, height: 360, codec: 'h264', subtitles: 0 });
  102 |     expect(await inspectVideo(mkv)).toEqual({ width: 640, height: 360, codec: 'h264', subtitles: 0 });
  103 |     expect(await frameDifference(input, mp4)).toBeGreaterThan(.3);
  104 |     const jobDirectories = await readdir(resolve(userData, 'jobs'));
  105 |     const nativeJobDirectory = jobDirectories[0]; if (!nativeJobDirectory) throw new Error('Missing native job artifacts');
  106 |     const artifactDirectory = resolve(userData, 'jobs', nativeJobDirectory);
  107 |     const previewName = (await readdir(artifactDirectory)).find((name) => name.startsWith('preview-') && name.endsWith('.png'));
  108 |     if (!previewName) throw new Error('Missing actual reference artifact');
  109 |     await assertReferenceParity(resolve(artifactDirectory, previewName), mp4);
  110 |     expect(createHash('sha256').update(await readFile(input)).digest('hex')).toBe(inputHash);
  111 |     await app.close(); app = undefined;
  112 |     const restarted = await launchApp(userData, [], []); app = restarted.app;
  113 |     await expandSecondaryControls(restarted.page);
  114 |     await expect(restarted.page.getByTestId('segment-0')).toContainText('已人工校对，世界你好。');
  115 |     await expect(restarted.page.getByText(mp4, { exact: true })).toBeVisible();
  116 |     await expect(restarted.page.getByLabel('双语字幕（译文 + 原文）', { exact: true })).toBeChecked();
  117 |     await expect(restarted.page.getByRole('img', { name: '使用导出渲染器生成的字幕参考画面', exact: true })).not.toBeVisible();
  118 |     await restarted.page.getByRole('button', { name: 'API 服务', exact: true }).click();
  119 |     await expect(restarted.page.locator('.profile-card')).toHaveCount(4);
  120 |     await expect(restarted.page.locator('.profile-card').first()).toContainText('密钥已配置');
  121 |     expect(mock.counters.recognition).toBe(1);
  122 |     await testInfo.attach('evidence-summary', { body: JSON.stringify({ mockedAI: true, realMedia: true, inputHashPreserved: true, ...mock.counters }), contentType: 'application/json' });
  123 |   } finally { await app?.close(); await mock.close(); }
  124 | });
  125 |
  126 | test('restart recovers interrupted work and missing original media fails without losing corrected subtitles', async ({ playwright: _playwright }, testInfo) => {
  127 |   const mock = await startMockServer();
  128 |   const input = testInfo.outputPath('restart-source.mp4'); await makeVideo(input);
  129 |   const userData = testInfo.outputPath('user-data');
  130 |   let app: ElectronApplication | undefined;
  131 |   try {
  132 |     const first = await launchApp(userData, [input], []); app = first.app; const page = first.page;
  133 |     await addProfile(page, 'Restart service', 'openai', mock.url);
  134 |     await importVideo(page); await configureCloud(page, 'Restart service');
  135 |     mock.behavior.translation = 'slow';
  136 |     await page.getByRole('button', { name: '一键生成字幕', exact: true }).click();
  137 |     await expect.poll(() => mock.counters.translation).toBe(1);
  138 |     await expect(page.getByTestId('segment-0')).toContainText('Hello world.');
  139 |     await app.close(); app = undefined;
  140 |     mock.behavior.translation = 'ok';
  141 |     const restarted = await launchApp(userData, [], []); app = restarted.app;
  142 |     await expandSecondaryControls(restarted.page);
  143 |     await expect(restarted.page.getByTestId('segment-0')).toContainText('Hello world.');
  144 |     await expect(restarted.page.locator('.stage-pill').filter({ hasText: '字幕翻译' })).toContainText(/已中断|已取消/);
> 145 |     await restarted.page.getByRole('button', { name: '重试未完成阶段', exact: true }).click();
      |                                                                                ^ TimeoutError: locator.click: Timeout 30000ms exceeded.
  146 |     await expect(restarted.page.getByTestId('segment-0')).toContainText('你好，世界。');
  147 |     expect(mock.counters.recognition).toBe(1);
  148 |     await expect(restarted.page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeEnabled();
  149 |     await rm(input);
  150 |     const missing = await restarted.page.evaluate(async () => { const jobs = await window.api.jobs.list(); if (jobs.success === false || !jobs.data[0]) throw new Error('Fixture missing'); return window.api.jobs.preview({ jobId: jobs.data[0].id, atMs: 0 }); });
  151 |     expect(missing.success).toBe(false);
  152 |     if (missing.success === false) expect(missing.code).toBe('INPUT_MISSING');
  153 |     await expect(restarted.page.getByTestId('segment-0')).toContainText('你好，世界。');
  154 |     await expect(restarted.page.getByRole('img')).not.toBeVisible();
  155 |   } finally { await app?.close(); await mock.close(); }
  156 | });
  157 |
  158 | test('editing a provider model invalidates dependent stages while renaming preserves completed work', async ({ playwright: _playwright }, testInfo) => {
  159 |   const mock = await startMockServer();
  160 |   const input = testInfo.outputPath('profile-source.mp4'); await makeVideo(input);
  161 |   const { app, page } = await launchApp(testInfo.outputPath('user-data'), [input], []);
  162 |   try {
  163 |     await addProfile(page, 'Original service', 'openai', mock.url);
  164 |     await importVideo(page);
  165 |     await configureCloud(page, 'Original service');
  166 |     await page.getByRole('button', { name: '一键生成字幕', exact: true }).click();
  167 |     await expect(page.getByTestId('segment-0')).toContainText('你好，世界。');
  168 |     await expect(page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeEnabled();
  169 |     await page.getByRole('button', { name: 'API 服务', exact: true }).click();
  170 |     await page.getByRole('button', { name: '编辑', exact: true }).click();
  171 |     await page.getByLabel('配置名称', { exact: true }).fill('Renamed service');
  172 |     await page.getByRole('button', { name: '保存配置', exact: true }).click();
  173 |     await page.getByLabel('关闭对话框', { exact: true }).click();
  174 |     await expect(page.locator('.stage-pill').filter({ hasText: '语音识别' })).toContainText('已完成');
  175 |     await expect(page.getByTestId('segment-0')).not.toContainText('待重译');
  176 |     expect(mock.counters.recognition).toBe(1);
  177 |     await page.getByRole('button', { name: 'API 服务', exact: true }).click();
  178 |     await page.getByRole('button', { name: '编辑', exact: true }).click();
  179 |     await page.getByLabel('模型 ID', { exact: true }).fill('another-mock-model');
  180 |     await page.getByRole('button', { name: '保存配置', exact: true }).click();
  181 |     await page.getByLabel('关闭对话框', { exact: true }).click();
  182 |     await expect(page.locator('.stage-pill').filter({ hasText: '语音识别' })).toContainText('待处理');
  183 |     await expect(page.getByTestId('segment-0')).toContainText('待重译');
  184 |     await expect(page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeDisabled();
  185 |     await expect(page.getByText('识别设置已变化，请先重新识别原片，再翻译。', { exact: true })).toBeVisible();
  186 |     await page.getByRole('button', { name: '重新识别原片', exact: true }).click();
  187 |     await page.getByRole('button', { name: '确认重新识别', exact: true }).click();
  188 |     await expect(page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeEnabled();
  189 |     await page.getByRole('button', { name: '翻译全部字幕', exact: true }).click();
  190 |     await expect(page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeEnabled();
  191 |     expect(mock.counters.recognition).toBe(2);
  192 |     expect(mock.counters.translation).toBe(2);
  193 |   } finally { await app.close(); await mock.close(); }
  194 | });
  195 |
  196 | test('recoverable API failure, retry without repeated recognition, cancel and invalid AI style preserve edits', async ({ playwright: _playwright }, testInfo) => {
  197 |   const mock = await startMockServer();
  198 |   const input = testInfo.outputPath('input.mp4'); await makeVideo(input);
  199 |   const { app, page } = await launchApp(testInfo.outputPath('user-data'), [input], []);
  200 |   try {
  201 |     await addProfile(page, 'Test service', 'openai', mock.url);
  202 |     await importVideo(page);
  203 |     await configureCloud(page, 'Test service');
  204 |     mock.behavior.translation = 'auth-error';
  205 |     await page.getByRole('button', { name: '一键生成字幕', exact: true }).click();
  206 |     await expect(page.getByRole('alert')).toContainText('AUTH_ERROR');
  207 |     await expect(page.getByTestId('segment-0')).toContainText('Hello world.');
  208 |     mock.behavior.translation = 'ok';
  209 |     await expect(page.getByRole('button', { name: '重试未完成阶段', exact: true })).toHaveCount(0);
  210 |     await page.getByRole('button', { name: '翻译全部字幕', exact: true }).click();
  211 |     await expect(page.getByTestId('segment-0')).toContainText('你好，世界。');
  212 |     expect(mock.counters.recognition).toBe(1);
  213 |     mock.behavior.translation = 'slow';
  214 |     const initialCalls = mock.counters.translation;
  215 |     await page.getByRole('button', { name: '翻译全部字幕', exact: true }).click();
  216 |     await expect.poll(() => mock.counters.translation).toBeGreaterThan(initialCalls);
  217 |     await page.getByRole('button', { name: '取消当前处理', exact: true }).click();
  218 |     await expect(page.getByRole('alert')).toContainText('CANCELLED');
  219 |     await expect(page.getByTestId('segment-0')).toContainText('你好，世界。');
  220 |     mock.behavior.translation = 'ok';
  221 |     await expect(page.getByRole('button', { name: '重试未完成阶段', exact: true })).toHaveCount(0);
  222 |     await page.getByRole('button', { name: '翻译全部字幕', exact: true }).click();
  223 |     await expect(page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeEnabled();
  224 |     expect(mock.counters.recognition).toBe(1);
  225 |     await page.getByLabel('AI 样式服务（可选）', { exact: true }).selectOption({ label: 'Test service' });
  226 |     await expect(page.getByLabel('AI 设计描述', { exact: true })).toBeEnabled();
  227 |     await page.getByLabel('AI 设计描述', { exact: true }).fill('invalid fixture style');
  228 |     mock.behavior.style = 'invalid';
  229 |     await page.getByRole('button', { name: '✧ 生成 AI 样式', exact: true }).click();
  230 |     await expect(page.getByRole('alert')).toContainText('STYLE_INVALID');
  231 |     await expect(page.getByLabel('文字颜色', { exact: true })).toHaveValue('#ffffff');
  232 |     expect(mock.counters.style).toBe(2);
  233 |   } finally { await app.close(); await mock.close(); }
  234 | });
  235 |
  236 | test('one-click real CPU installation, real Whisper inference and failed/cancelled updates retain working runtime', async ({ playwright: _playwright }, testInfo) => {
  237 |   test.setTimeout(180000);
  238 |   const mock = await startMockServer();
  239 |   const userData = testInfo.outputPath('native-user-data');
  240 |   const input = testInfo.outputPath('真实识别.mp4'); await makeVideo(input, true);
  241 |   const artifactUrl = mock.url.replace('/v1', '/artifacts');
  242 |   const cpu = { url: `${artifactUrl}/cpu.zip`, sha256: 'd824b1e37599f882b396e73f1ee0bfd5d0529f700314c48311dcbd00b803321d', sizeBytes: 3968674 };
  243 |   const base = { url: `${artifactUrl}/ggml-base.bin`, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', sizeBytes: 147951465, name: 'Base 实际模型' };
  244 |   const manifestPath = testInfo.outputPath('trusted-loopback-manifest.json');
  245 |   await writeFile(manifestPath, JSON.stringify({ cpu, gpu: cpu, models: { base, small: base, 'large-v3-turbo': base } }));
```
