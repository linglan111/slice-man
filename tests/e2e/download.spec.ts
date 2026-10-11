import { test, expect, type ElectronApplication } from "@playwright/test";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { launchApp, makeVideo } from "./helpers";
import { downloadFixture } from "./download-helpers";

test("online settings installation integrity/cancel/rollback and native completed download import playback persist through Electron", async ({
  playwright: _p,
}, info) => {
  test.setTimeout(180_000);
  const root = info.outputPath("fixtures");
  const source = info.outputPath("anonymous.mp4");
  await makeVideo(source);
  const fixture = await downloadFixture(root, source);
  const userData = info.outputPath("isolated-user-data");
  let app: ElectronApplication | undefined;
  try {
    const first = await launchApp(userData, [], [], {
      APP_E2E_DOWNLOAD_MANIFEST: fixture.manifest,
    });
    app = first.app;
    const page = first.page;
    const entry = page.getByRole("button", {
      name: "↓ 链接导入设置",
      exact: true,
    });
    await expect(entry).toBeVisible();
    expect(
      await entry.evaluate((node) => !!node.closest(".sidebar__footer")),
    ).toBe(true);
    await entry.click();
    await expect(
      page.getByRole("dialog", { name: "链接导入设置", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("视频下载清晰度", { exact: true })
      .selectOption("1080p");
    await page
      .getByLabel("下载代理（可选）", { exact: true })
      .fill("http://user:secret@localhost:7890");
    await page
      .getByRole("button", { name: "保存下载设置", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("输入格式");
    await page.getByLabel("下载代理（可选）", { exact: true }).fill("");
    await page
      .getByRole("button", { name: "保存下载设置", exact: true })
      .click();
    await expect(
      page.getByText("下载设置已保存。", { exact: true }),
    ).toBeVisible();
    fixture.behavior.tool = "corrupt";
    await page
      .getByRole("button", { name: "一键安装下载工具", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("校验失败");
    expect(await readdir(join(userData, "download-tools"))).toEqual([]);
    fixture.behavior.tool = "slow";
    await page
      .getByRole("button", { name: "一键安装下载工具", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "取消安装或下载", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("关闭对话框", { exact: true })).toBeDisabled();
    await page
      .getByRole("button", { name: "取消安装或下载", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("取消");
    fixture.behavior.tool = "ok";
    await page
      .getByRole("button", { name: "一键安装下载工具", exact: true })
      .click();
    await expect(
      page.getByText("下载工具已安装并验证，可以导入视频链接。", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    const active = await readFile(
      join(userData, "download-tools", "active.json"),
      "utf8",
    );
    fixture.behavior.tool = "corrupt";
    await page
      .getByRole("button", { name: "重新安装固定版本", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("校验失败");
    expect(
      await readFile(join(userData, "download-tools", "active.json"), "utf8"),
    ).toBe(active);
    await expect(page.getByText(/下载工具已就绪/)).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "链接导入", exact: true }).click();
    await page
      .getByLabel("视频链接", { exact: true })
      .fill("file:///source.mp4");
    await page.getByRole("button", { name: "下载并导入", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("输入格式");
    await page
      .getByLabel("视频链接", { exact: true })
      .fill(`${fixture.url}/slow.mp4`);
    await page.getByRole("button", { name: "下载并导入", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "取消下载", exact: true }),
    ).toBeVisible();
    await expect.poll(() => fixture.requests.includes("/slow.mp4")).toBe(true);
    await page.getByRole("button", { name: "取消下载", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("取消");
    expect(await readdir(join(userData, "downloads"))).toEqual([]);
    expect(
      await page.evaluate(async () => {
        const r = await window.api.jobs.list();
        return r.success ? r.data.length : -1;
      }),
    ).toBe(0);
    await page
      .getByLabel("视频链接", { exact: true })
      .fill(`${fixture.url}/blocked.mp4`);
    await page.getByRole("button", { name: "下载并导入", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("阻止");
    expect(await readdir(join(userData, "downloads"))).toEqual([]);
    await page
      .getByLabel("视频链接", { exact: true })
      .fill(`${fixture.url}/anonymous.mp4`);
    await page.getByRole("button", { name: "下载并导入", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "链接导入视频", exact: true }),
    ).not.toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /(?:source|normalized-[a-f0-9-]+)\.mp4/,
    );
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await page.locator("video").evaluate(async (v: HTMLVideoElement) => {
      await v.play();
    });
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeGreaterThan(0.25);
    const jobs = await page.evaluate(async () => {
      const r = await window.api.jobs.list();
      if (!r.success) throw new Error(r.error);
      return r.data;
    });
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    if (!job) throw new Error("Missing completed import");
    expect(job.media.durationMs).toBe(4000);
    expect((await stat(job.inputPath)).size).toBeGreaterThan(0);
    await app.close();
    app = undefined;
    const next = await launchApp(userData, [], [], {
      APP_E2E_DOWNLOAD_MANIFEST: fixture.manifest,
    });
    app = next.app;
    await expect(next.page.getByRole("heading", { level: 1 })).toHaveText(
      /(?:source|normalized-[a-f0-9-]+)\.mp4/,
    );
    await next.page
      .getByRole("button", { name: "↓ 链接导入设置", exact: true })
      .click();
    await expect(
      next.page.getByLabel("视频下载清晰度", { exact: true }),
    ).toHaveValue("1080p");
    await expect(next.page.getByText(/下载工具已就绪/)).toBeVisible();
    await info.attach("download-contract-results", {
      body: JSON.stringify({
        realNativeTools: true,
        anonymousHTTPFixture: true,
        paidAIRequests: 0,
        integrity: true,
        installCancel: true,
        failedUpdateRollback: true,
        downloadCancel: true,
        noPartialJob: true,
        importedPlayback: true,
        settingsRestart: true,
      }),
      contentType: "application/json",
    });
  } finally {
    await app?.close();
    await fixture.close();
  }
});
