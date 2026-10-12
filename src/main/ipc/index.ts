import { ipcMain, dialog, app, type BrowserWindow } from "electron";
import { writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  idSchema,
  importOptionsSchema,
  planReprocessInputSchema,
  recognizePartialInputSchema,
  reprocessInputSchema,
  reviewSubtitlesInputSchema,
  analyzeNamesInputSchema,
  applyNamesInputSchema,
  undoNamesInputSchema,
  acknowledgeFindingInputSchema,
  repairLoopInputSchema,
  optionsSchema,
  segmentSchema,
  newSegmentSchema,
  styleSchema,
  profileInputSchema,
  type Result,
} from "../../shared/contracts";
import type { Store } from "../db/store";
import type { JobService } from "../services/jobs/lib/job-service";
import type { RuntimeService } from "../services/runtime/runtime-service";
import { publicError, AppError } from "../lib/errors";
import {
  generateText,
  parseJson,
  transcribe,
} from "../services/providers/lib/text-provider";
import { normalizeCloud } from "../services/subtitles/lib/timeline";
import { isE2e } from "../env-setup";
import { join } from "node:path";
import {
  exportSettingsSchema,
  exportQualitySchema,
  exportVideoCodecSchema,
  exportResolutionSchema,
} from "../../shared/export-contracts";
import type { ExportSettingsService } from "../services/export-settings/lib/export-settings-service";
import type { DownloadService } from "../services/download/lib/download-service";
import {
  downloadSettingsSchema,
  onlineUrlSchema,
} from "../../shared/download-contracts";
type Services = {
  store: Store;
  jobs: JobService;
  runtime: RuntimeService;
  download: DownloadService;
  exportSettings: ExportSettingsService;
  window: BrowserWindow;
};
function queue(name: string): string[] {
  if (!isE2e) return [];
  return z.array(z.string()).parse(JSON.parse(process.env[name] ?? "[]"));
}
export function registerIpc(services: Services): () => void {
  const imports = queue("APP_E2E_IMPORT_PATHS");
  const exports = queue("APP_E2E_EXPORT_PATHS");
  const downloadDirectories = queue("APP_E2E_DOWNLOAD_DIRECTORIES");
  const exportDirectories = queue("APP_E2E_EXPORT_DIRECTORIES");
  const exportDialogs: { defaultPath: string; format: string }[] = [];
  let installController: AbortController | undefined;
  const registered: string[] = [];
  function handle<I, T>(
    channel: string,
    schema: z.ZodType<I>,
    procedure: (input: I) => T | Promise<T>,
  ): void {
    registered.push(channel);
    ipcMain.handle(channel, async (event, raw: unknown): Promise<Result<T>> => {
      try {
        if (
          event.sender !== services.window.webContents ||
          event.senderFrame !== services.window.webContents.mainFrame
        )
          throw new AppError("IPC_DENIED", "不允许此窗口调用");
        const input = schema.parse(raw);
        return { success: true, data: await procedure(input) };
      } catch (error) {
        if (error instanceof z.ZodError)
          return {
            success: false,
            error: "输入格式或参数范围无效",
            code: "VALIDATION_ERROR",
          };
        return publicError(error);
      }
    });
  }
  const empty = z.undefined();
  const jobId = z.object({ jobId: idSchema }).strict();
  handle("exportSettings:status", empty, () =>
    services.exportSettings.status(),
  );
  handle("exportSettings:saveSettings", exportSettingsSchema, (input) =>
    services.exportSettings.saveSettings(input),
  );
  handle("exportSettings:chooseDirectory", empty, async () => {
    services.exportSettings.assertIdle();
    const current = await services.exportSettings.status();
    const directory = isE2e
      ? exportDirectories.shift()
      : (
          await dialog.showOpenDialog(services.window, {
            title: "选择默认导出位置",
            defaultPath: current.directory,
            properties: ["openDirectory", "createDirectory"],
          })
        ).filePaths[0];
    return directory
      ? services.exportSettings.saveSettings({
          ...(await services.exportSettings.status()),
          directory,
        })
      : null;
  });
  handle("download:status", empty, () => services.download.status());
  handle("download:saveSettings", downloadSettingsSchema, (input) =>
    services.download.saveSettings(input),
  );
  handle("download:chooseDirectory", empty, async () => {
    services.download.assertIdle();
    const status = await services.download.status();
    const directory = isE2e
      ? downloadDirectories.shift()
      : (
          await dialog.showOpenDialog(services.window, {
            title: "选择视频下载位置",
            defaultPath: status.settings.directory || status.defaultDirectory,
            properties: ["openDirectory", "createDirectory"],
          })
        ).filePaths[0];
    return directory
      ? services.download.saveSettings({ ...status.settings, directory })
      : null;
  });
  handle("download:install", empty, () => services.download.install());
  handle(
    "download:importUrl",
    z
      .object({ url: onlineUrlSchema, options: importOptionsSchema.optional() })
      .strict(),
    ({ url, options }) => services.download.importUrl(url, options),
  );
  handle("download:cancel", empty, () => services.download.cancel());
  handle("profiles:list", empty, () => services.store.listProfiles());
  handle("profiles:save", profileInputSchema, (input) => {
    services.jobs.assertProfileWritable(input.id);
    return services.store.saveProfile(input);
  });
  handle("profiles:remove", idSchema, (id) => {
    services.jobs.assertProfileWritable(id);
    services.store.removeProfile(id);
  });
  handle("jobs:repairLoop", repairLoopInputSchema, (input) =>
    services.jobs.repairLoop(input),
  );
  handle(
    "profiles:test",
    z
      .object({ id: idSchema, purpose: z.enum(["text", "recognition"]) })
      .strict(),
    async ({ id, purpose }) => {
      const profile = services.store.getProfile(id);
      const key = services.store.key(id);
      if (purpose === "recognition") {
        const wav = Buffer.alloc(32044);
        wav.write("RIFF", 0);
        wav.writeUInt32LE(32036, 4);
        wav.write("WAVEfmt ", 8);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(16000, 24);
        wav.writeUInt32LE(32000, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write("data", 36);
        wav.writeUInt32LE(32000, 40);
        normalizeCloud(
          await transcribe(profile, key, wav),
          0,
          1000,
          "capability",
        );
        return {
          message:
            "音频上传和片段时间戳结构测试通过。静音测试不验证实际识别准确率。",
        };
      }
      const raw = parseJson(
        await generateText(
          profile,
          key,
          'Connection and text capability test. Return only JSON {"ok":true}.',
        ),
      );
      z.object({ ok: z.literal(true) }).parse(raw);
      return { message: "连接与文本 JSON 输出测试通过。" };
    },
  );
  handle("runtime:status", empty, () => services.runtime.status());
  handle(
    "runtime:install",
    z
      .object({
        modelId: z.enum(["base", "small", "large-v3-turbo"]),
        preferGpu: z.boolean(),
      })
      .strict(),
    async (input) => {
      if (installController) throw new AppError("INSTALL_BUSY", "安装已在进行");
      installController = new AbortController();
      try {
        return await services.runtime.install(input, installController.signal);
      } finally {
        installController = undefined;
      }
    },
  );
  handle("runtime:cancel", empty, () => installController?.abort());
  handle("jobs:list", empty, () => services.store.listJobs());
  handle("jobs:get", idSchema, (id) => services.store.getJob(id));
  handle(
    "jobs:importVideo",
    importOptionsSchema.optional(),
    async (options) => {
      const path = isE2e
        ? imports.shift()
        : (
            await dialog.showOpenDialog(services.window, {
              title: "选择视频",
              properties: ["openFile"],
              filters: [
                {
                  name: "视频",
                  extensions: ["mp4", "mkv", "mov", "webm", "avi", "m4v"],
                },
              ],
            })
          ).filePaths[0];
      return path ? services.jobs.importVideo(path, undefined, options) : null;
    },
  );
  handle(
    "jobs:updateOptions",
    jobId.extend({ options: optionsSchema }),
    (input) => services.jobs.updateOptions(input.jobId, input.options),
  );
  handle("jobs:planReprocess", planReprocessInputSchema, (input) =>
    services.jobs.planReprocess(input),
  );
  handle("jobs:recognizePartial", recognizePartialInputSchema, (input) =>
    services.jobs.recognizePartial(input),
  );
  handle("jobs:translatePartial", reprocessInputSchema, (input) =>
    services.jobs.translatePartial(input),
  );
  handle("jobs:reviewSubtitles", reviewSubtitlesInputSchema, (input) =>
    services.jobs.reviewSubtitles(input),
  );
  handle('jobs:analyzeNames', analyzeNamesInputSchema, (input) => services.jobs.analyzeNames(input));
  handle('jobs:applyNames', applyNamesInputSchema, (input) => services.jobs.applyNames(input));
  handle('jobs:undoNames', undoNamesInputSchema, (input) => services.jobs.undoNames(input));
  handle("jobs:acknowledgeFinding", acknowledgeFindingInputSchema, (input) =>
    services.jobs.acknowledgeFinding(input),
  );
  handle("jobs:recognize", idSchema, (id) => services.jobs.recognize(id));
  handle(
    "jobs:recognizeAgain",
    jobId.extend({ revision: z.number().int().nonnegative() }),
    (input) => services.jobs.recognizeAgain(input.jobId, input.revision),
  );
  handle(
    "jobs:translate",
    jobId.extend({
      segmentIds: z.array(idSchema).min(1).max(10000).optional(),
    }),
    (input) => services.jobs.translate(input.jobId, input.segmentIds),
  );
  handle(
    "jobs:editSegment",
    jobId.extend({
      segment: segmentSchema,
      revision: z.number().int().nonnegative(),
    }),
    (input) =>
      services.jobs.editSegment(input.jobId, input.segment, input.revision),
  );
  handle(
    "jobs:addSegment",
    jobId.extend({
      segment: newSegmentSchema,
      revision: z.number().int().nonnegative(),
    }),
    (input) =>
      services.jobs.addSegment(input.jobId, input.segment, input.revision),
  );
  handle(
    "jobs:removeSegment",
    jobId.extend({
      segmentId: idSchema,
      revision: z.number().int().nonnegative(),
    }),
    (input) =>
      services.jobs.removeSegment(input.jobId, input.segmentId, input.revision),
  );
  handle("jobs:setStyle", jobId.extend({ style: styleSchema }), (input) =>
    services.jobs.setStyle(input.jobId, input.style),
  );
  handle(
    "jobs:designStyle",
    jobId.extend({ prompt: z.string().min(1).max(2000) }),
    (input) => services.jobs.designStyle(input.jobId, input.prompt),
  );
  handle(
    "jobs:preview",
    jobId.extend({ atMs: z.number().int().nonnegative() }),
    (input) => services.jobs.preview(input.jobId, input.atMs),
  );
  handle("jobs:playback", idSchema, (id) => services.jobs.playback(id));
  handle("jobs:cancel", idSchema, (id) => services.jobs.cancel(id));
  handle(
    "jobs:export",
    jobId.extend({
      format: z.enum(["mp4", "mkv", "srt", "ass", "vtt"]),
      quality: exportQualitySchema.default("balanced"),
      videoCodec: exportVideoCodecSchema.optional(),
      resolution: exportResolutionSchema.optional(),
    }),
    async (input) => {
      const job = services.store.getJob(input.jobId);
      const preferences = await services.exportSettings.status();
      await services.exportSettings.prepareDirectory(preferences.directory);
      const defaultPath = join(
        preferences.directory,
        `${job.name.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*]/g, "_")}-subtitles.${input.format}`,
      );
      if (isE2e) {
        // Isolated test mode observes the actual save-dialog default, even when
        // native interaction is supplied through the existing destination queue.
        exportDialogs.push({ defaultPath, format: input.format });
        const log = join(app.getPath("userData"), "export-dialogs.json");
        const temporaryLog = `${log}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporaryLog, JSON.stringify(exportDialogs), {
            flag: "wx",
          });
          await rename(temporaryLog, log);
        } finally {
          await rm(temporaryLog, { force: true });
        }
      }
      const path = isE2e
        ? exports.shift()
        : (
            await dialog.showSaveDialog(services.window, {
              title: "导出字幕或视频",
              defaultPath,
              filters: [
                {
                  name: input.format.toUpperCase(),
                  extensions: [input.format],
                },
              ],
            })
          ).filePath;
      return path
        ? services.jobs.export(input.jobId, input.format, input.quality, path, {
            videoCodec: input.videoCodec,
            resolution: input.resolution,
          })
        : null;
    },
  );
  return () => {
    installController?.abort();
    services.download.cancel();
    for (const name of registered) ipcMain.removeHandler(name);
  };
}
