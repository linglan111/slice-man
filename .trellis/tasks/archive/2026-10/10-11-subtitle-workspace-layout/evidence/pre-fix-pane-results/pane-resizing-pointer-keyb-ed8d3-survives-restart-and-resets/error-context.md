# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pane-resizing.spec.ts >> pointer/keyboard pane resizing clamps real geometry, retains translated inline tools, survives restart and resets
- Location: tests\e2e\pane-resizing.spec.ts:162:5

# Error details

```
Error: 全屏仅播放，退出全屏后可校对。 must remain inside preview

expect(received).toBeLessThanOrEqual(expected)

Expected: <= 494.59375
Received:    510.984375

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  59  |         };
  60  |       };
  61  |       const list = document.querySelector(".subtitle-list");
  62  |       const editor = document.querySelector(
  63  |         ".preview-editor, .reprocessing-panel",
  64  |       );
  65  |       return {
  66  |         width: innerWidth,
  67  |         height: innerHeight,
  68  |         video: bounds("video"),
  69  |         preview: bounds(".preview-panel"),
  70  |         previewActions: [
  71  |           ...document.querySelectorAll(
  72  |             ".preview-tools button, .preview-panel > button",
  73  |           ),
  74  |         ].map((node) => {
  75  |           const rect = node.getBoundingClientRect();
  76  |           const target = document.elementFromPoint(
  77  |             rect.x + rect.width / 2,
  78  |             rect.y + rect.height / 2,
  79  |           );
  80  |           return {
  81  |             label: node.textContent,
  82  |             x: rect.x,
  83  |             y: rect.y,
  84  |             right: rect.right,
  85  |             bottom: rect.bottom,
  86  |             hitTestable: target !== null && node.contains(target),
  87  |           };
  88  |         }),
  89  |         previewHints: [
  90  |           ...document.querySelectorAll(
  91  |             ".preview-panel > .hint, .preview-panel > .error-text",
  92  |           ),
  93  |         ]
  94  |           .filter((node) => node.getBoundingClientRect().height > 0)
  95  |           .map((node) => {
  96  |             const rect = node.getBoundingClientRect();
  97  |             return { bottom: rect.bottom, text: node.textContent };
  98  |           }),
  99  |         proofreading: bounds(".subtitle-panel"),
  100 |         list: bounds(".subtitle-list"),
  101 |         editorHeight: editor?.clientHeight,
  102 |         listOverflow: list ? list.scrollWidth - list.clientWidth : 0,
  103 |         controls: [
  104 |           ...document.querySelectorAll(
  105 |             ".preview-tools button, .subtitle-panel > .section-heading button, .review-toolbar select, .review-toolbar button, .subtitle-tools button, .subtitle-tools label",
  106 |           ),
  107 |         ].map((node) => {
  108 |           const rect = node.getBoundingClientRect();
  109 |           return { x: rect.x, right: rect.right, bottom: rect.bottom };
  110 |         }),
  111 |         bodyHeight: document.body.scrollHeight,
  112 |         scrollTop: scrollY,
  113 |       };
  114 |     });
  115 |     expect(sizes.preview.right).toBeLessThan(sizes.proofreading.x);
  116 |     expect(sizes.video.height).toBeGreaterThanOrEqual(108);
  117 |     expect(sizes.video.bottom).toBeLessThanOrEqual(sizes.preview.bottom);
  118 |     for (const action of sizes.previewActions) {
  119 |       expect(
  120 |         action.x,
  121 |         `${action.label} left preview bound`,
  122 |       ).toBeGreaterThanOrEqual(sizes.preview.x);
  123 |       expect(
  124 |         action.y,
  125 |         `${action.label} top preview bound`,
  126 |       ).toBeGreaterThanOrEqual(sizes.preview.y);
  127 |       expect(
  128 |         action.right,
  129 |         `${action.label} right preview bound`,
  130 |       ).toBeLessThanOrEqual(sizes.preview.right + 1);
  131 |       expect(
  132 |         action.bottom,
  133 |         `${action.label} bottom preview bound`,
  134 |       ).toBeLessThanOrEqual(sizes.preview.bottom + 1);
  135 |       expect(
  136 |         action.hitTestable,
  137 |         `${action.label} center must receive pointer input`,
  138 |       ).toBe(true);
  139 |     }
  140 |     for (const hint of sizes.previewHints)
  141 |       expect(
  142 |         hint.bottom,
  143 |         `${hint.text} must remain inside preview`,
  144 |       ).toBeLessThanOrEqual(sizes.preview.bottom + 1);
  145 |     expect(sizes.list.height).toBeGreaterThanOrEqual(75);
  146 |     expect(sizes.list.bottom).toBeLessThanOrEqual(
  147 |       sizes.proofreading.bottom + 1,
  148 |     );
  149 |     expect(sizes.listOverflow).toBeLessThanOrEqual(1);
  150 |     for (const control of sizes.controls) {
  151 |       expect(control.x).toBeGreaterThanOrEqual(0);
  152 |       expect(control.right).toBeLessThanOrEqual(sizes.width);
  153 |       expect(control.bottom).toBeLessThanOrEqual(sizes.height);
  154 |     }
  155 |     if (sizes.editorHeight !== undefined)
  156 |       expect(sizes.editorHeight).toBeGreaterThanOrEqual(80);
  157 |     expect(sizes.bodyHeight).toBeLessThanOrEqual(sizes.height + 1);
  158 |     expect(sizes.scrollTop).toBe(0);
> 159 |   }).toPass({ timeout: 5000 });
      |      ^ Error: 全屏仅播放，退出全屏后可校对。 must remain inside preview
  160 | }
  161 |
  162 | test("pointer/keyboard pane resizing clamps real geometry, retains translated inline tools, survives restart and resets", async ({
  163 |   playwright: _p,
  164 | }, info) => {
  165 |   test.setTimeout(180_000);
  166 |   const source = info.outputPath("字幕布局 resize translated.mp4");
  167 |   await makeVideo(source);
  168 |   const mock = await startMockServer();
  169 |   const userData = info.outputPath("resize-data");
  170 |   let app: ElectronApplication | undefined;
  171 |   try {
  172 |     const first = await launchApp(userData, [source], []);
  173 |     app = first.app;
  174 |     let page = first.page;
  175 |     await addProfile(page, "Resize provider fixture", "openai", mock.url);
  176 |     await importVideo(page);
  177 |     await configureCloud(page, "Resize provider fixture");
  178 |     await page
  179 |       .getByLabel("AI 检查服务（可选）", { exact: true })
  180 |       .selectOption({ label: "Resize provider fixture" });
  181 |     await page
  182 |       .getByRole("button", { name: "一键生成字幕", exact: true })
  183 |       .click();
  184 |     await expect(page.getByTestId("segment-0")).toContainText("你好，世界。");
  185 |     await expect(page.locator(".processing-strip")).not.toBeVisible();
  186 |     await page.getByLabel("双语字幕（译文 + 原文）", { exact: true }).click();
  187 |     await expect(
  188 |       page.getByLabel("双语字幕（译文 + 原文）", { exact: true }),
  189 |     ).toBeChecked();
  190 |     await page
  191 |       .getByRole("button", { name: "AI 检查字幕", exact: true })
  192 |       .click();
  193 |     await expect(page.locator(".review-summary")).toBeVisible();
  194 |     await expect(page.locator(".processing-strip")).not.toBeVisible();
  195 |     await page.getByLabel("选择字幕 1", { exact: true }).check();
  196 |     const labels = [
  197 |       "调整侧边栏宽度",
  198 |       "调整预览与校对区宽度",
  199 |       "调整预览与设置区高度",
  200 |     ];
  201 |     for (const size of [
  202 |       { width: 1440, height: 960 },
  203 |       { width: 1050, height: 700 },
  204 |       { width: 1920, height: 1080 },
  205 |     ]) {
  206 |       await app.evaluate(({ BrowserWindow }, dimensions) => {
  207 |         BrowserWindow.getAllWindows()[0]?.setSize(
  208 |           dimensions.width,
  209 |           dimensions.height,
  210 |         );
  211 |       }, size);
  212 |       await page.getByRole("button", { name: "重置布局", exact: true }).click();
  213 |       await expandSecondaryControls(page);
  214 |       for (const [index, label] of labels.entries()) {
  215 |         const separator = page.getByRole("separator", {
  216 |           name: label,
  217 |           exact: true,
  218 |         });
  219 |         const before = Number(await separator.getAttribute("aria-valuenow"));
  220 |         await drag(page, label, index === 2 ? -25 : 25);
  221 |         await expect
  222 |           .poll(async () =>
  223 |             Number(await separator.getAttribute("aria-valuenow")),
  224 |           )
  225 |           .not.toBe(before);
  226 |         await assertWorkspace(page);
  227 |       }
  228 |       const right = await page.locator(".subtitle-panel").boundingBox();
  229 |       await page
  230 |         .getByRole("separator", { name: labels[2], exact: true })
  231 |         .press("Home");
  232 |       await mkdir(evidence, { recursive: true });
  233 |       await page.screenshot({
  234 |         path: join(
  235 |           evidence,
  236 |           `resize-${size.width}x${size.height}-secondary-home.png`,
  237 |         ),
  238 |       });
  239 |       await assertWorkspace(page);
  240 |       await page
  241 |         .locator("video")
  242 |         .evaluate((video) => video.dispatchEvent(new Event("error")));
  243 |       await expect(
  244 |         page.getByRole("button", { name: "重新加载视频预览", exact: true }),
  245 |       ).toBeVisible();
  246 |       await assertWorkspace(page);
  247 |       await page.screenshot({
  248 |         path: join(
  249 |           evidence,
  250 |           `resize-${size.width}x${size.height}-secondary-home-playback-error.png`,
  251 |         ),
  252 |       });
  253 |       await page
  254 |         .getByRole("button", { name: "重新加载视频预览", exact: true })
  255 |         .click();
  256 |       await expect(
  257 |         page.getByRole("button", { name: "重新加载视频预览", exact: true }),
  258 |       ).toHaveCount(0);
  259 |       await drag(page, labels[2] ?? "", -5000);
```
