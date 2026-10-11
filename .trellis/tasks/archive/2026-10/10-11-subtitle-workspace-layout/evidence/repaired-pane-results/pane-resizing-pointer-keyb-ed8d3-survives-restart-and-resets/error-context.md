# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pane-resizing.spec.ts >> pointer/keyboard pane resizing clamps real geometry, retains translated inline tools, survives restart and resets
- Location: tests\e2e\pane-resizing.spec.ts:162:5

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 2
+ Received  + 2

  Object {
-   "height": 682.609375,
+   "height": 748.609375,
    "width": 537.5,
    "x": 864.5,
-   "y": 220.390625,
+   "y": 154.390625,
  }
```

# Test source

```ts
  181 |     await drag(page, "调整侧边栏宽度", 25);
  182 |     await expect
  183 |       .poll(async () => (await page.locator(".sidebar").boundingBox())?.width)
  184 |       .toBeGreaterThan(184);
  185 |     await page.getByRole("button", { name: "重置布局", exact: true }).click();
  186 |     await expect
  187 |       .poll(async () => (await page.locator(".sidebar").boundingBox())?.width)
  188 |       .toBe(184);
  189 |     await mkdir(evidence, { recursive: true });
  190 |     await page.screenshot({
  191 |       path: join(evidence, "resize-welcome-1050x700-reset.png"),
  192 |     });
  193 |     await app.evaluate(({ BrowserWindow }) =>
  194 |       BrowserWindow.getAllWindows()[0]?.setSize(1440, 960),
  195 |     );
  196 |     await addProfile(page, "Resize provider fixture", "openai", mock.url);
  197 |     await importVideo(page);
  198 |     await configureCloud(page, "Resize provider fixture");
  199 |     await page
  200 |       .getByLabel("AI 检查服务（可选）", { exact: true })
  201 |       .selectOption({ label: "Resize provider fixture" });
  202 |     await page
  203 |       .getByRole("button", { name: "一键生成字幕", exact: true })
  204 |       .click();
  205 |     await expect(page.getByTestId("segment-0")).toContainText("你好，世界。");
  206 |     await expect(page.locator(".processing-strip")).not.toBeVisible();
  207 |     await page.getByLabel("双语字幕（译文 + 原文）", { exact: true }).click();
  208 |     await expect(
  209 |       page.getByLabel("双语字幕（译文 + 原文）", { exact: true }),
  210 |     ).toBeChecked();
  211 |     await page
  212 |       .getByRole("button", { name: "AI 检查字幕", exact: true })
  213 |       .click();
  214 |     await expect(page.locator(".review-summary")).toBeVisible();
  215 |     await expect(page.locator(".processing-strip")).not.toBeVisible();
  216 |     await page.getByLabel("选择字幕 1", { exact: true }).check();
  217 |     const labels = [
  218 |       "调整侧边栏宽度",
  219 |       "调整预览与校对区宽度",
  220 |       "调整预览与设置区高度",
  221 |     ];
  222 |     for (const size of [
  223 |       { width: 1440, height: 960 },
  224 |       { width: 1050, height: 700 },
  225 |       { width: 1920, height: 1080 },
  226 |     ]) {
  227 |       await app.evaluate(({ BrowserWindow }, dimensions) => {
  228 |         BrowserWindow.getAllWindows()[0]?.setSize(
  229 |           dimensions.width,
  230 |           dimensions.height,
  231 |         );
  232 |       }, size);
  233 |       await page.getByRole("button", { name: "重置布局", exact: true }).click();
  234 |       await expandSecondaryControls(page);
  235 |       for (const [index, label] of labels.entries()) {
  236 |         const separator = page.getByRole("separator", {
  237 |           name: label,
  238 |           exact: true,
  239 |         });
  240 |         const before = Number(await separator.getAttribute("aria-valuenow"));
  241 |         await drag(page, label, index === 2 ? -25 : 25);
  242 |         await expect
  243 |           .poll(async () =>
  244 |             Number(await separator.getAttribute("aria-valuenow")),
  245 |           )
  246 |           .not.toBe(before);
  247 |         await assertWorkspace(page);
  248 |       }
  249 |       const right = await page.locator(".subtitle-panel").boundingBox();
  250 |       await page
  251 |         .getByRole("separator", { name: labels[2], exact: true })
  252 |         .press("Home");
  253 |       await mkdir(evidence, { recursive: true });
  254 |       await page.screenshot({
  255 |         path: join(
  256 |           evidence,
  257 |           `resize-${size.width}x${size.height}-secondary-home.png`,
  258 |         ),
  259 |       });
  260 |       await assertWorkspace(page);
  261 |       await page
  262 |         .locator("video")
  263 |         .evaluate((video) => video.dispatchEvent(new Event("error")));
  264 |       await expect(
  265 |         page.getByRole("button", { name: "重新加载视频预览", exact: true }),
  266 |       ).toBeVisible();
  267 |       await assertWorkspace(page);
  268 |       await page.screenshot({
  269 |         path: join(
  270 |           evidence,
  271 |           `resize-${size.width}x${size.height}-secondary-home-playback-error.png`,
  272 |         ),
  273 |       });
  274 |       await page
  275 |         .getByRole("button", { name: "重新加载视频预览", exact: true })
  276 |         .click();
  277 |       await expect(
  278 |         page.getByRole("button", { name: "重新加载视频预览", exact: true }),
  279 |       ).toHaveCount(0);
  280 |       await drag(page, labels[2] ?? "", -5000);
> 281 |       expect(await page.locator(".subtitle-panel").boundingBox()).toEqual(
      |                                                                   ^ Error: expect(received).toEqual(expected) // deep equality
  282 |         right,
  283 |       );
  284 |       await assertWorkspace(page);
  285 |       await drag(page, labels[2] ?? "", 5000);
  286 |       await assertWorkspace(page);
  287 |       for (const label of labels.slice(0, 2)) {
  288 |         await drag(page, label, -5000);
  289 |         await assertWorkspace(page);
  290 |         await drag(page, label, 5000);
  291 |         await assertWorkspace(page);
  292 |       }
  293 |       await page
  294 |         .getByRole("separator", { name: labels[1], exact: true })
  295 |         .press("Home");
  296 |       await page
  297 |         .getByRole("button", { name: "添加画面字幕", exact: true })
  298 |         .click();
  299 |       await page
  300 |         .getByLabel("原文", { exact: true })
  301 |         .fill("Long translated edit\n".repeat(80));
  302 |       await page
  303 |         .getByLabel("译文", { exact: true })
  304 |         .fill("长双语校对表单\n".repeat(80));
  305 |       const inline = "调整预览与编辑区高度";
  306 |       await drag(page, inline, -5000);
  307 |       await assertWorkspace(page);
  308 |       await drag(page, inline, 5000);
  309 |       await assertWorkspace(page);
  310 |       await page
  311 |         .getByRole("button", { name: "保存字幕", exact: true })
  312 |         .scrollIntoViewIfNeeded();
  313 |       await expect(
  314 |         page.getByRole("button", { name: "保存字幕", exact: true }),
  315 |       ).toBeInViewport();
  316 |       await assertWorkspace(page);
  317 |       await mkdir(evidence, { recursive: true });
  318 |       await page.screenshot({
  319 |         path: join(
  320 |           evidence,
  321 |           `resize-${size.width}x${size.height}-translated-inline.png`,
  322 |         ),
  323 |       });
  324 |       await page
  325 |         .getByRole("button", { name: "重新识别片段", exact: true })
  326 |         .click();
  327 |       await expect(page.locator(".reprocessing-panel")).toBeVisible();
  328 |       await expect(page.locator(".preview-editor")).not.toBeVisible();
  329 |       await expect(
  330 |         page.getByRole("separator", { name: inline, exact: true }),
  331 |       ).toHaveCount(1);
  332 |       await assertWorkspace(page);
  333 |       await page.getByLabel("关闭分段处理", { exact: true }).click();
  334 |       await expect(page.locator(".preview-editor")).toBeVisible();
  335 |       await expect(page.getByLabel("原文", { exact: true })).toHaveValue(
  336 |         "Long translated edit\n".repeat(80),
  337 |       );
  338 |       await expect(page.getByLabel("译文", { exact: true })).toHaveValue(
  339 |         "长双语校对表单\n".repeat(80),
  340 |       );
  341 |       await assertWorkspace(page);
  342 |       await page.getByRole("button", { name: "取消", exact: true }).click();
  343 |       await page
  344 |         .getByRole("button", { name: "重新识别片段", exact: true })
  345 |         .click();
  346 |       await drag(page, inline, -5000);
  347 |       await assertWorkspace(page);
  348 |       await drag(page, inline, 5000);
  349 |       await assertWorkspace(page);
  350 |       await page
  351 |         .getByRole("button", { name: "添加画面字幕", exact: true })
  352 |         .click();
  353 |       await expect(page.locator(".reprocessing-panel")).toHaveCount(0);
  354 |       await expect(page.locator(".preview-editor")).toBeVisible();
  355 |       await assertWorkspace(page);
  356 |       await page.getByRole("button", { name: "取消", exact: true }).click();
  357 |       await page
  358 |         .getByRole("button", { name: "重新识别片段", exact: true })
  359 |         .click();
  360 |       await page.getByLabel("关闭分段处理", { exact: true }).click();
  361 |       const disclosure = page.getByRole("button", { name: /生成、样式与导出/ });
  362 |       await disclosure.click();
  363 |       await expect(
  364 |         page.getByRole("separator", { name: labels[2], exact: true }),
  365 |       ).not.toBeVisible();
  366 |       await page
  367 |         .getByRole("button", { name: "收起侧边栏", exact: true })
  368 |         .click();
  369 |       await expect(
  370 |         page.getByRole("separator", { name: labels[0], exact: true }),
  371 |       ).toHaveCount(0);
  372 |       await assertWorkspace(page);
  373 |       await page
  374 |         .getByRole("button", { name: "展开侧边栏", exact: true })
  375 |         .click();
  376 |       await disclosure.click();
  377 |     }
  378 |     const divider = page.getByRole("separator", {
  379 |       name: labels[1],
  380 |       exact: true,
  381 |     });
```
