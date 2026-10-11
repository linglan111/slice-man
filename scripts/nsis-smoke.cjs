const { spawn } = require("node:child_process");
const { resolve, join } = require("node:path");
const { existsSync } = require("node:fs");
const { mkdir, writeFile } = require("node:fs/promises");
const { UUID } = require("builder-util-runtime");
const { _electron } = require("playwright");
const { installedMediaSmoke } = require("./installed-media-smoke.cjs");

async function main() {
  if (process.platform !== "win32")
    throw new Error("NSIS acceptance requires Windows");
  const workspace = resolve(__dirname, "..");
  const target = join(workspace, ".native-smoke", "installed-app");
  const applicationVersion = require("../package.json").version;
  if (
    typeof applicationVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(applicationVersion)
  )
    throw new Error("Unsafe application version for installer filename");
  const installer = join(
    workspace,
    "dist",
    `Slice Man Setup ${applicationVersion}.exe`,
  );
  const reportPath = join(workspace, ".native-smoke", "installer-report.json");
  const guid = UUID.v5(
    "local.sliceman.desktop",
    UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3"),
  );
  await mkdir(join(workspace, ".native-smoke"), { recursive: true });
  async function action(mode) {
    return new Promise((resolveAction, reject) => {
      const child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(workspace, "scripts", "nsis-smoke.ps1"),
          "-Mode",
          mode,
          "-Workspace",
          workspace,
          "-InstallTarget",
          target,
          "-InstallerPath",
          installer,
          "-AppGuid",
          guid,
          "-ApplicationVersion",
          applicationVersion,
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code !== 0)
          reject(new Error(`${mode} failed (${code}): ${stderr}`));
        else {
          try {
            resolveAction(JSON.parse(stdout.trim()));
          } catch {
            reject(new Error(`Invalid ${mode} report: ${stdout}`));
          }
        }
      });
    });
  }
  const report = {
    status: "running",
    applicationVersion,
    mode: process.argv.includes("--inspect") ? "inspect" : "install-uninstall",
    inspection: await action("Inspect"),
    note: "Real local user NSIS install/uninstall and packaged native IPC/resource smoke on this developer Windows 11 device; not a clean VM or Windows 10 check.",
  };
  if (report.inspection.status === "skipped") {
    report.status = "skipped";
    report.note =
      "Read-only preflight skipped because an existing app/shortcut/registration would be affected; no installation or uninstallation was performed.";
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (process.argv.includes("--inspect")) {
    report.status = "inspected";
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  report.installation = await action("Install");
  if (report.installation.status === "skipped") {
    report.status = "skipped";
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  let error;
  try {
    if (
      report.installation.exitCode !== 0 ||
      !report.installation.executableExists
    )
      throw new Error("Silent installation did not complete");
    const userData = join(workspace, ".native-smoke", "installed-user-data");
    await mkdir(userData, { recursive: true });
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    environment.APP_E2E = "1";
    environment.APP_E2E_USER_DATA = "relative-must-be-ignored";
    environment.ELECTRON_RENDERER_URL = "http://127.0.0.1:9/should-not-load";
    const application = await _electron.launch({
      executablePath: join(target, "Slice Man.exe"),
      args: [`--user-data-dir=${userData}`],
      env: environment,
      timeout: 60_000,
    });
    try {
      const window = await application.firstWindow();
      await window.waitForFunction(
        () => typeof window.api?.profiles?.list === "function",
      );
      const result = await window.evaluate(() => window.api.profiles.list());
      const runtime = await window.evaluate(() => window.api.runtime.status());
      if (!result.success || !runtime.success)
        throw new Error("Installed native profile/runtime IPC failed");
      report.application = await application.evaluate(
        ({ app, safeStorage }) => ({
          packaged: app.isPackaged,
          userData: app.getPath("userData"),
          encryption: safeStorage.isEncryptionAvailable(),
          electron: process.versions.electron,
          abi: process.versions.modules,
        }),
      );
      if (
        !report.application.packaged ||
        resolve(report.application.userData) !== userData ||
        !window.url().startsWith("file:")
      )
        throw new Error(
          "Installed package did not preserve production isolation",
        );
      for (const file of [
        "media/ffmpeg.exe",
        "media/ffprobe.exe",
        "fonts/NotoSansCJKsc-Regular.otf",
        "fonts/NotoSansCJKsc-Bold.otf",
        "notices/FFmpeg-LICENSE.txt",
        "runtime-smoke.wav",
        "app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
      ])
        if (!existsSync(join(target, "resources", file)))
          throw new Error("Missing installed resource: " + file);
      await window.screenshot({
        path: join(workspace, ".native-smoke", "installed-screenshot.png"),
      });
      report.nativeIpc = "passed";
      report.resources = "passed";
      report.media = await installedMediaSmoke(
        join(target, "resources"),
        join(workspace, ".native-smoke", "installed-media"),
        workspace,
      );
    } finally {
      await application.close();
    }
  } catch (failure) {
    error = failure;
    report.error = failure instanceof Error ? failure.message : String(failure);
  } finally {
    try {
      report.uninstallation = await action("Uninstall");
    } catch (failure) {
      error ??= failure;
      report.uninstallError =
        failure instanceof Error ? failure.message : String(failure);
    }
    report.status = error ? "failed" : "passed";
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
  if (error) throw error;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
