const { _electron } = require("playwright");
const { resolve, join } = require("node:path");
const { mkdir, writeFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { resolvePackageAppDirectory } = require("./package-smoke-path.cjs");

async function main() {
  const appDirectory = resolvePackageAppDirectory(
    process.argv.slice(2),
    resolve(__dirname, ".."),
  );
  const executable = join(appDirectory, "Slice Man.exe");
  if (!existsSync(executable)) throw new Error("Build npm run package first");
  const directory = resolve(".native-smoke/packaged-user-data");
  await mkdir(directory, { recursive: true });
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  // Deliberately hostile development/test flags must not change production
  // renderer loading, dialog behavior, resource manifests or data isolation.
  environment.APP_E2E = "1";
  environment.APP_E2E_USER_DATA = "relative-path-must-be-ignored";
  environment.APP_E2E_RUNTIME_MANIFEST =
    "missing-manifest-must-be-ignored.json";
  environment.ELECTRON_RENDERER_URL = "http://127.0.0.1:9/should-not-load";
  const application = await _electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${directory}`],
    env: environment,
    timeout: 60_000,
  });
  try {
    const window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.waitForFunction(
      () => typeof window.api?.profiles?.list === "function",
    );
    const profiles = await window.evaluate(() => window.api.profiles.list());
    if (!profiles.success)
      throw new Error("Packaged native persistence IPC failed");
    const runtime = await window.evaluate(() => window.api.runtime.status());
    if (!runtime.success) throw new Error("Packaged runtime IPC failed");
    const host = await application.evaluate(({ app, safeStorage }) => ({
      packaged: app.isPackaged,
      userData: app.getPath("userData"),
      appPath: app.getAppPath(),
      safeStorage: safeStorage.isEncryptionAvailable(),
      versions: process.versions,
    }));
    if (!host.packaged) throw new Error("Not a packaged application");
    if (resolve(host.userData) !== directory)
      throw new Error(
        "Packaged test flags changed the isolated user-data path",
      );
    if (!window.url().startsWith("file:"))
      throw new Error("Packaged app loaded an untrusted development renderer");
    const resources = join(appDirectory, "resources");
    for (const file of [
      "media/ffmpeg.exe",
      "media/ffprobe.exe",
      "fonts/NotoSansCJKsc-Regular.otf",
      "fonts/NotoSansCJKsc-Bold.otf",
      "notices/FFmpeg-LICENSE.txt",
      "runtime-smoke.wav",
      "app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    ]) {
      if (!existsSync(join(resources, file)))
        throw new Error("Missing packaged resource: " + file);
    }
    const report = {
      status: "passed",
      host,
      profileCount: profiles.data.length,
      runtime: runtime.data,
      note: "Real unpacked packaged app startup, native persistence via IPC, narrow renderer preload, native module/fonts/media/notices resource checks. Not a clean Windows installation test.",
    };
    await writeFile(
      ".native-smoke/packaged-report.json",
      JSON.stringify(report, null, 2),
    );
    await window.screenshot({ path: ".native-smoke/packaged-screenshot.png" });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await application.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
