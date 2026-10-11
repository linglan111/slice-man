import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { launchApp, makeVideo, startMockServer } from "./helpers";

test("a second process activates the primary without interrupting its job; isolated data can run separately", async ({
  playwright: _playwright,
}, testInfo) => {
  const mock = await startMockServer();
  const userData = testInfo.outputPath("primary-data");
  const video = testInfo.outputPath("source.mp4");
  await makeVideo(video);
  const primary = await launchApp(userData, [video], []);
  try {
    const profile = await primary.page.evaluate(
      async (url) =>
        window.api.profiles.save({
          name: "Instance fixture",
          protocol: "openai",
          baseUrl: url,
          model: "fixture",
          apiKey: "test-only",
          sessionOnly: true,
        }),
      mock.url,
    );
    if (!profile.success) throw new Error("Profile fixture failed");
    const imported = await primary.page.evaluate(() =>
      window.api.jobs.importVideo(),
    );
    if (!imported.success || !imported.data)
      throw new Error("Import fixture failed");
    const jobId = imported.data.id;
    await primary.page.evaluate(
      async ({ id, profileId }) => {
        const current = await window.api.jobs.get(id);
        if (!current.success) throw new Error("Job fixture missing");
        await window.api.jobs.updateOptions({
          jobId: id,
          options: {
            ...current.data.options,
            recognition: "cloud",
            recognitionProfileId: profileId,
            translationProfileId: profileId,
          },
        });
        const recognized = await window.api.jobs.recognize(id);
        if (!recognized.success) throw new Error("Recognition fixture failed");
      },
      { id: jobId, profileId: profile.data.id },
    );
    mock.behavior.translation = "slow";
    const pending = primary.page.evaluate(
      (id) => window.api.jobs.translate({ jobId: id }),
      jobId,
    );
    await expect.poll(() => mock.counters.translation).toBe(1);
    await primary.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.minimize(),
    );
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      APP_E2E: "1",
      APP_E2E_USER_DATA: userData,
    };
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.ELECTRON_RENDERER_URL;
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      const secondary = spawn(
        resolve("node_modules/electron/dist/electron.exe"),
        [resolve(".")],
        { env: environment, windowsHide: true, stdio: "ignore" },
      );
      const timer = setTimeout(() => {
        secondary.kill();
        reject(new Error("Secondary process did not exit"));
      }, 10000);
      secondary.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      secondary.once("close", (code) => {
        clearTimeout(timer);
        resolveExit(code);
      });
    });
    expect(exitCode).toBe(0);
    await expect
      .poll(() =>
        primary.app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isMinimized(),
        ),
      )
      .toBe(false);
    const retained = await primary.page.evaluate(
      (id) => window.api.jobs.get(id),
      jobId,
    );
    expect(retained.success && retained.data.stages.translate.state).toBe(
      "running",
    );
    expect(
      await primary.app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
    const independent = await launchApp(
      testInfo.outputPath("independent-data"),
      [],
      [],
    );
    try {
      expect(
        await independent.page.evaluate(() => window.api.profiles.list()),
      ).toEqual({ success: true, data: [] });
    } finally {
      await independent.app.close();
    }
    await primary.page.evaluate((id) => window.api.jobs.cancel(id), jobId);
    expect(await pending).toMatchObject({ success: false, code: "CANCELLED" });
  } finally {
    await primary.app.close();
    await mock.close();
  }
});
