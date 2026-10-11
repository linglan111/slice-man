import {
  app,
  BrowserWindow,
  protocol,
  safeStorage,
  dialog,
  Menu,
} from "electron";
import { isE2e } from "./env-setup";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "./db/store";
import { MediaService } from "./services/media/lib/media-service";
import {
  RuntimeService,
  parseTestArtifacts,
} from "./services/runtime/runtime-service";
import { JobService } from "./services/jobs/lib/job-service";
import { registerIpc } from "./ipc";
import { PROGRESS_CHANNEL, DOWNLOAD_STATUS_CHANNEL } from "../shared/channels";
import { DownloadService } from "./services/download/lib/download-service";
import { ExportSettingsService } from "./services/export-settings/lib/export-settings-service";
import { downloadArtifactsSchema } from "./services/download/manifest";
import type { ProgressEvent } from "../shared/contracts";
import { serveMediaRequest } from "./lib/media-protocol";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
let dispose: (() => void) | undefined;
let store: Store | undefined;
let jobs: JobService | undefined;
let mainWindow: BrowserWindow | undefined;
// userData is configured by env-setup before acquiring the instance lock.
// A secondary process must never open Store and interrupt the primary's jobs.
if (app.requestSingleInstanceLock()) {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  void app
    .whenReady()
    .then(async () => {
      const root = app.getPath("userData");
      Menu.setApplicationMenu(null);
      const resourceRoot = app.isPackaged
        ? process.resourcesPath
        : join(app.getAppPath(), "resources");
      const mediaPaths = new Map<string, string>();
      const mediaUrl = (path: string): string => {
        const token = randomUUID();
        mediaPaths.set(token, path);
        return `app-media://local/${token}`;
      };
      protocol.handle("app-media", (request) =>
        serveMediaRequest(request, mediaPaths),
      );
      store = new Store(join(root, "app.db"), safeStorage);
      const currentStore = store;
      const window = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 1050,
        minHeight: 700,
        title: "Slice Man",
        icon: join(resourceRoot, "icons", "icon.ico"),
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(__dirname, "../preload/index.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      mainWindow = window;
      window.setMenu(null);
      window.on("closed", () => {
        mainWindow = undefined;
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      const emit = (event: ProgressEvent): void => {
        if (!window.isDestroyed())
          window.webContents.send(PROGRESS_CHANNEL, event);
      };
      const media = new MediaService({
        ffmpeg: join(resourceRoot, "media", "ffmpeg.exe"),
        ffprobe: join(resourceRoot, "media", "ffprobe.exe"),
        fonts: join(resourceRoot, "fonts"),
      });
      const testManifest =
        isE2e && process.env.APP_E2E_RUNTIME_MANIFEST
          ? parseTestArtifacts(
              JSON.parse(
                await readFile(process.env.APP_E2E_RUNTIME_MANIFEST, "utf8"),
              ),
            )
          : undefined;
      const runtime = new RuntimeService({
        root,
        resourceRoot,
        emit,
        ...(testManifest ? { artifacts: testManifest } : {}),
      });
      jobs = new JobService(currentStore, media, runtime, root, emit, mediaUrl);
      const currentJobs = jobs;
      const downloadArtifacts =
        isE2e && process.env.APP_E2E_DOWNLOAD_MANIFEST
          ? downloadArtifactsSchema.parse(
              JSON.parse(
                await readFile(process.env.APP_E2E_DOWNLOAD_MANIFEST, "utf8"),
              ),
            )
          : undefined;
      const download = new DownloadService({
        root,
        ffmpeg: media.paths.ffmpeg,
        ffprobe: media.paths.ffprobe,
        defaultDirectory: isE2e
          ? join(root, "downloads")
          : join(app.getPath("videos"), "Slice Man"),
        importVideo: (path, signal, options) =>
          currentJobs.importVideo(path, signal, options),
        probe: (path, signal) => media.probe(path, signal),
        emit: (status) => {
          if (!window.isDestroyed())
            window.webContents.send(DOWNLOAD_STATUS_CHANNEL, status);
        },
        ...(downloadArtifacts ? { artifacts: downloadArtifacts } : {}),
      });
      dispose = registerIpc({
        store: currentStore,
        jobs,
        runtime,
        download,
        exportSettings: new ExportSettingsService(
          root,
          isE2e
            ? join(root, "exports")
            : join(app.getPath("videos"), "Slice Man", "Exports"),
        ),
        window,
      });
      if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
        await window.loadURL(process.env.ELECTRON_RENDERER_URL);
      else await window.loadFile(join(__dirname, "../renderer/index.html"));
    })
    .catch(() => {
      dialog.showErrorBox(
        "无法启动 Slice Man",
        "应用初始化失败，请检查本地数据目录权限、安装文件与数据库版本。",
      );
      app.quit();
    });
} else app.quit();
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  jobs?.cancelAll();
  dispose?.();
});
app.on("will-quit", () => store?.close());
