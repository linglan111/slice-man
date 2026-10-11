# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: live-captions.spec.ts >> live source captions immediately follow actual playback; translation, edits, bilingual layout and native fullscreen refresh without rendering
- Location: tests\e2e\live-captions.spec.ts:21:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('live-captions')
Expected substring: "人工译文 a+b"
Received string:    ""
Timeout: 15000ms

Call log:
  - Expect "toContainText" getByTestId('live-captions') with timeout 15000ms
  - waiting for getByTestId('live-captions')
    - locator resolved to <div aria-label="实时字幕" class="live-captions" data-testid="live-captions">…</div>
    - unexpected value "这是第二句话。A second sentence."
    32 × locator resolved to <div aria-label="实时字幕" class="live-captions" data-testid="live-captions">…</div>
       - unexpected value ""

```

# Test source

```ts
  8   |
  9   | const execute = promisify(execFile);
  10  |
  11  | async function seekFrame(page: Page, seconds: number): Promise<void> {
  12  |   const video = page.locator('video');
  13  |   const before = await video.evaluate((element: HTMLVideoElement) => Number(element.dataset.frameCount ?? '0'));
  14  |   await video.evaluate((element: HTMLVideoElement, target) => { element.currentTime = target; }, seconds);
  15  |   await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false);
  16  |   await expect.poll(() => video.evaluate((element: HTMLVideoElement) => Number(element.dataset.frameCount ?? '0'))).toBeGreaterThan(before);
  17  |   await expect.poll(() => video.evaluate((element: HTMLVideoElement, target) => Math.abs(Number(element.dataset.frameTime ?? '-1000') - target), seconds)).toBeLessThan(.05);
  18  |   expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(seconds, 2);
  19  | }
  20  |
  21  | test('live source captions immediately follow actual playback; translation, edits, bilingual layout and native fullscreen refresh without rendering', async ({ playwright: _playwright }, testInfo) => {
  22  |   const mock = await startMockServer();
  23  |   const source = testInfo.outputPath('anonymous-live.mp4');
  24  |   const portrait = testInfo.outputPath('anonymous-portrait.mp4');
  25  |   await makeVideo(source);
  26  |   await execute(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x294060:s=360x640:r=25', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=16000:duration=4', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', portrait], { windowsHide: true });
  27  |   const { app, page } = await launchApp(testInfo.outputPath('live-user-data'), [source, portrait], []);
  28  |   try {
  29  |     await addProfile(page, 'Live caption mock', 'openai', mock.url);
  30  |     await importVideo(page);
  31  |     await configureCloud(page, 'Live caption mock');
  32  |     mock.behavior.translation = 'slow';
  33  |     await page.getByRole('button', { name: '一键生成字幕', exact: true }).click();
  34  |     await expect(page.getByTestId('segment-0')).toContainText('Hello world.');
  35  |     await expect.poll(() => mock.counters.translation).toBe(1);
  36  |     const captions = page.getByTestId('live-captions');
  37  |     const video = page.locator('video');
  38  |     await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  39  |     await installSeekTelemetry(page);
  40  |     await seekFrame(page, .6);
  41  |     await expect(captions).toHaveText('Hello world.');
  42  |     await expect(page.getByRole('img', { name: '使用导出渲染器生成的字幕参考画面', exact: true })).not.toBeVisible();
  43  |     await page.getByRole('button', { name: '取消当前处理', exact: true }).click();
  44  |     await expect(page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeEnabled();
  45  |     await seekFrame(page, 2.4);
  46  |     await expect(captions).toHaveText('A second sentence.');
  47  |     await seekFrame(page, 1.9);
  48  |     await expect(captions).toBeEmpty();
  49  |     await seekFrame(page, .6);
  50  |     await expect(captions).toHaveText('Hello world.');
  51  |     mock.behavior.translation = 'ok';
  52  |     await page.getByRole('button', { name: '翻译全部字幕', exact: true }).click();
  53  |     await expect(captions).toHaveText('你好，世界。');
  54  |     await expect(page.getByRole('button', { name: '翻译全部字幕', exact: true })).toBeEnabled();
  55  |     await page.getByLabel('双语字幕（译文 + 原文）', { exact: true }).click();
  56  |     await expect(page.getByLabel('双语字幕（译文 + 原文）', { exact: true })).toBeChecked();
  57  |     await expect(captions).toHaveText('你好，世界。Hello world.');
  58  |     await expect(page.getByLabel('编辑字幕 1', { exact: true })).toBeEnabled();
  59  |     await page.getByLabel('编辑字幕 1', { exact: true }).click();
  60  |     await page.getByLabel('原文', { exact: true }).fill('Corrected <b>source & text</b>');
  61  |     await page.getByLabel('译文', { exact: true }).fill('人工译文 a+b');
  62  |     await page.getByLabel('开始时间（秒）', { exact: true }).fill('0.5');
  63  |     await page.getByLabel('结束时间（秒）', { exact: true }).fill('1.5');
  64  |     await page.getByRole('button', { name: '保存字幕', exact: true }).click();
  65  |     await expect(page.locator('.segment-editor')).toHaveCount(0);
  66  |     await expect(captions).toHaveText('人工译文 a+bCorrected <b>source & text</b>');
  67  |     await expect(captions.locator('b')).toHaveCount(0);
  68  |     await page.getByLabel('入场效果', { exact: true }).selectOption('none');
  69  |     await expect(page.getByLabel('选择字幕 1', { exact: true })).toBeEnabled();
  70  |     await page.getByLabel('选择字幕 1', { exact: true }).check();
  71  |     await page.getByLabel('强调关键词', { exact: true }).fill('a+b');
  72  |     await page.getByRole('button', { name: '为选中字幕设置强调', exact: true }).click();
  73  |     await expect(captions.locator('.live-captions__line > span', { hasText: 'a+b' }).first()).toHaveCSS('color', 'rgb(255, 213, 79)');
  74  |     await expect(page.getByLabel('字幕位置', { exact: true })).toBeEnabled();
  75  |     await page.getByLabel('字幕位置', { exact: true }).selectOption('top-center');
  76  |     await expect.poll(() => captions.locator('.live-captions__stack').evaluate((element: HTMLElement) => element.style.top)).toBe('8%');
  77  |     await seekFrame(page, .4);
  78  |     await expect(captions).toBeEmpty();
  79  |     await seekFrame(page, .5);
  80  |     await expect(captions).toContainText('人工译文 a+b');
  81  |     await seekFrame(page, 1.5);
  82  |     await expect(captions).toBeEmpty();
  83  |     await page.getByTestId('segment-0').locator('.time-button').click();
  84  |     await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(.5, 2);
  85  |     await expect(captions).toContainText('人工译文 a+b');
  86  |     await video.evaluate(async (element: HTMLVideoElement) => { await element.play(); });
  87  |     await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(.8);
  88  |     await video.evaluate((element: HTMLVideoElement) => element.pause());
  89  |     await expect(captions).toContainText('人工译文 a+b');
  90  |     // Actual native video fullscreen uses the browser subtitle renderer, not sibling CSS.
  91  |     await video.evaluate(async (element: HTMLVideoElement) => { await element.requestFullscreen(); });
  92  |     await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.textTracks[0]?.mode)).toBe('showing');
  93  |     await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.textTracks[0]?.activeCues?.length ?? 0)).toBe(1);
  94  |     await expect(captions).not.toBeVisible();
  95  |     await page.evaluate(async () => { await document.exitFullscreen(); });
  96  |     await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.textTracks[0]?.mode)).toBe('disabled');
  97  |     await expect(captions).toContainText('人工译文 a+b');
  98  |     expect(await video.evaluate((element: HTMLVideoElement) => element.textTracks.length)).toBe(1);
  99  |     // Click Chromium's actual native progress bar; the overlay must not intercept it.
  100 |     await video.hover();
  101 |     const controlsBounds = await video.boundingBox();
  102 |     if (!controlsBounds) throw new Error('Native video controls are missing.');
  103 |     await video.click({ position: { x: controlsBounds.width * .7, y: controlsBounds.height - 23 } });
  104 |     await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(2);
  105 |     await expect(captions).toContainText('这是第二句话。');
  106 |     await video.click({ position: { x: controlsBounds.width * .15, y: controlsBounds.height - 23 } });
  107 |     await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThan(1);
> 108 |     await expect(captions).toContainText('人工译文 a+b');
      |                            ^ Error: expect(locator).toContainText(expected) failed
  109 |     await seekFrame(page, .6);
  110 |     await expect(captions).toContainText('人工译文 a+b');
  111 |     const directory = resolve('.trellis/tasks/10-11-subtitle-workspace-layout/evidence');
  112 |     await mkdir(directory, { recursive: true });
  113 |     await page.locator('.live-video-player').screenshot({ path: join(directory, 'live-captions-anonymous-inline.png') });
  114 |     const captionsBounds = await captions.boundingBox();
  115 |     const inlineVideoBounds = await video.boundingBox();
  116 |     expect(captionsBounds?.width).toBeCloseTo(Math.min(inlineVideoBounds?.width ?? 0, (inlineVideoBounds?.height ?? 0) * 640 / 360), 0);
  117 |     await importVideo(page);
  118 |     await expect(page.getByTestId('live-captions')).toBeEmpty();
  119 |     await expect.poll(() => page.locator('video').evaluate((element: HTMLVideoElement) => element.videoHeight)).toBe(640);
  120 |     const portraitBounds = await page.locator('video').boundingBox();
  121 |     await expect.poll(() => page.getByTestId('live-captions').evaluate((element: HTMLElement) => element.getBoundingClientRect().width)).toBeCloseTo((portraitBounds?.height ?? 0) * 360 / 640, 0);
  122 |     await expect(page.getByTestId('live-captions')).toHaveCSS('pointer-events', 'none');
  123 |     await writeFile(join(directory, 'live-captions-desktop-result.json'), JSON.stringify({ fixture: 'Anonymous generated landscape/portrait media, isolated userData', providers: 'Loopback HTTP mocks; no paid requests or user media/database', recognitionCalls: mock.counters.recognition, translationCalls: mock.counters.translation, verified: ['source during pending translation', 'frame timestamp seeks forward/back/gap', 'translation/bilingual/text/timing/style updates', 'literal HTML and keyword punctuation', 'start-inclusive/end-exclusive', 'subtitle time-button and playback/pause', 'actual native progress-bar clicks forward/back', 'native fullscreen track activation/no duplicate inline overlay/one reused track', 'portrait geometry and job-switch caption clearing', 'no reference render required'], limitations: ['CSS/system font rendering is approximate; ASS/libass remains exact reference', 'native fullscreen typography is browser controlled'] }, null, 2));
  124 |   } finally { await app.close(); await mock.close(); }
  125 | });
  126 |
```
