# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: download-settings.spec.ts >> native directory selection, persisted format/codec/resolution matrix, real transforms, no upscale and cancellation preserve existing files
- Location: tests\e2e\download-settings.spec.ts:192:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 15000ms exceeded while waiting on the predicate
```

# Test source

```ts
  339 |         const actual = await probe(job.inputPath);
  340 |         const expectedContainer =
  341 |           container === "original" && videoCodec !== "original"
  342 |             ? "mkv"
  343 |             : container;
  344 |         expect(actual.codec).toBe(
  345 |           videoCodec === "original"
  346 |             ? "vp9"
  347 |             : videoCodec === "h264"
  348 |               ? "h264"
  349 |               : "hevc",
  350 |         );
  351 |         expect(actual.height).toBe(480);
  352 |         expect(actual.width).toBe(640); // No enlargement to configured 1080p.
  353 |         if (expectedContainer === "mp4") {
  354 |           expect(actual.format).toContain("mp4");
  355 |           expect(extname(job.inputPath)).toBe(".mp4");
  356 |         } else if (expectedContainer === "mkv") {
  357 |           expect(actual.format).toContain("matroska");
  358 |           expect(extname(job.inputPath)).toBe(".mkv");
  359 |         } else {
  360 |           expect(actual.format).toContain("webm");
  361 |           expect(extname(job.inputPath)).toBe(".webm");
  362 |         }
  363 |         await expect(page.getByRole("heading", { level: 1 })).toHaveText(
  364 |           basename(job.inputPath),
  365 |         );
  366 |         await expect
  367 |           .poll(() =>
  368 |             page
  369 |               .locator("video")
  370 |               .evaluate((v: HTMLVideoElement) => v.readyState),
  371 |           )
  372 |           .toBeGreaterThanOrEqual(2);
  373 |         results.push({ container, requestedCodec: videoCodec, ...actual });
  374 |       }
  375 |     }
  376 |     await settings(page, "mp4", "original", "360p");
  377 |     await importUrl(
  378 |       page,
  379 |       `${fixture.url}/anonymous.webm?case=unknown-height-cap`,
  380 |     );
  381 |     await expect(page.getByRole("alert")).toContainText(/分辨率|上限/);
  382 |     expect(
  383 |       await page.evaluate(async () => {
  384 |         const r = await window.api.jobs.list();
  385 |         return r.success ? r.data.length : -1;
  386 |       }),
  387 |     ).toBe(9);
  388 |     await page.getByRole("button", { name: "关闭", exact: true }).click();
  389 |     await settings(page, "mp4", "h264", "360p");
  390 |     await importUrl(page, `${fixture.url}/anonymous.webm?case=downscale`);
  391 |     await expect(
  392 |       page.getByRole("dialog", { name: "链接导入视频", exact: true }),
  393 |     ).not.toBeVisible({ timeout: 30000 });
  394 |     expect(await probe((await currentJob(page)).inputPath)).toMatchObject({
  395 |       codec: "h264",
  396 |       width: 480,
  397 |       height: 360,
  398 |     });
  399 |     await settings(page, "mkv", "h265", "best");
  400 |     const heavy = info.outputPath("long-anonymous.mp4");
  401 |     await execute(
  402 |       FFMPEG,
  403 |       [
  404 |         "-y",
  405 |         "-f",
  406 |         "lavfi",
  407 |         "-i",
  408 |         "color=c=0x182b3e:s=1280x720:r=30",
  409 |         "-t",
  410 |         "30",
  411 |         "-c:v",
  412 |         "libx264",
  413 |         "-preset",
  414 |         "ultrafast",
  415 |         "-pix_fmt",
  416 |         "yuv420p",
  417 |         heavy,
  418 |       ],
  419 |       { windowsHide: true },
  420 |     );
  421 |     fixture.behavior.video = heavy;
  422 |     await importUrl(page, `${fixture.url}/long.mp4?case=conversion-cancel`);
  423 |     await expect
  424 |       .poll(
  425 |         async () => {
  426 |           for (const name of await readdir(target))
  427 |             if (name.startsWith(".partial-")) {
  428 |               for (const file of await readdir(join(target, name)))
  429 |                 if (
  430 |                   file !== "source.mp4" &&
  431 |                   (await stat(join(target, name, file))).size > 0
  432 |                 )
  433 |                   return true;
  434 |             }
  435 |           return false;
  436 |         },
  437 |         { timeout: 15000, intervals: [50, 100, 250] },
  438 |       )
> 439 |       .toBe(true);
      |        ^ Error: expect(received).toBe(expected) // Object.is equality
  440 |     await page.getByRole("button", { name: "取消下载", exact: true }).click();
  441 |     await expect(page.getByRole("alert")).toContainText("取消");
  442 |     expect(
  443 |       (await readdir(target)).some((name) => name.startsWith(".partial-")),
  444 |     ).toBe(false);
  445 |     expect(await readFile(sentinel, "utf8")).toBe(
  446 |       "existing-user-file-never-overwritten",
  447 |     );
  448 |     expect(
  449 |       await page.evaluate(async () => {
  450 |         const r = await window.api.jobs.list();
  451 |         return r.success ? r.data.length : -1;
  452 |       }),
  453 |     ).toBe(10);
  454 |     await page.getByRole("button", { name: "关闭", exact: true }).click();
  455 |     await app.close();
  456 |     app = undefined;
  457 |     const next = await launchApp(userData, [], [], {
  458 |       APP_E2E_DOWNLOAD_MANIFEST: fixture.manifest,
  459 |     });
  460 |     app = next.app;
  461 |     await next.page
  462 |       .getByRole("button", { name: "链接导入设置", exact: true })
  463 |       .click();
  464 |     await expect(next.page.getByLabel("下载位置", { exact: true })).toHaveValue(
  465 |       target,
  466 |     );
  467 |     await expect(
  468 |       next.page.getByLabel("下载容器格式", { exact: true }),
  469 |     ).toHaveValue("mkv");
  470 |     await expect(
  471 |       next.page.getByLabel("下载视频编码", { exact: true }),
  472 |     ).toHaveValue("h265");
  473 |     await expect(
  474 |       next.page.getByLabel("视频下载清晰度", { exact: true }),
  475 |     ).toHaveValue("best");
  476 |     await info.attach("container-codec-results", {
  477 |       body: JSON.stringify({
  478 |         results,
  479 |         nativeDirectoryPickerFixture: true,
  480 |         invalidDirectoryPreservesSettings: true,
  481 |         anonymousHTTPMedia: true,
  482 |         realFFmpeg: true,
  483 |         downscale: true,
  484 |         noUpscale: true,
  485 |         conversionCancel: true,
  486 |         sameNameFilePreserved: true,
  487 |         settingsRestart: true,
  488 |         paidAI: 0,
  489 |       }),
  490 |       contentType: "application/json",
  491 |     });
  492 |   } finally {
  493 |     await app?.close();
  494 |     await fixture.close();
  495 |   }
  496 | });
  497 |
```
