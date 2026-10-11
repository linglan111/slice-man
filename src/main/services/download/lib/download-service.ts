import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  readdir,
  stat,
  statfs,
  open,
} from "node:fs/promises";
import { join, resolve, sep, isAbsolute, dirname, basename } from "node:path";
import { importOptionsSchema } from "../../../../shared/contracts";
import type { Job, ImportOptions } from "../../../../shared/contracts";
import { AppError, checkAbort } from "../../../lib/errors";
import { runProcess } from "../../../lib/process";
import { downloadArtifact, extractArchive } from "../../runtime/artifacts";
import { DOWNLOAD_ARTIFACTS, type DownloadArtifacts } from "../manifest";
import {
  downloadSettingsSchema,
  onlineUrlSchema,
  type DownloadSettings,
  type DownloadSettingsInput,
  type DownloadStatus,
} from "../types";
import { runDownloadProcess } from "./download-process";
import { normalizeDownload } from "./download-media";

export function downloadArguments(
  url: string,
  input: DownloadSettingsInput,
  ffmpeg: string,
  deno: string,
): string[] {
  onlineUrlSchema.parse(url);
  const settings = downloadSettingsSchema.parse(input);
  const height = Number(settings.quality.replace("p", ""));
  const filter = settings.quality === "best" ? "" : `[height<=?${height}]`;
  return [
    "--ignore-config",
    "--no-plugin-dirs",
    "--no-playlist",
    "--abort-on-error",
    "--no-overwrites",
    "--no-cache-dir",
    "--encoding",
    "utf-8",
    "--no-remote-components",
    "--no-js-runtimes",
    "--js-runtimes",
    `deno:${deno}`,
    "--ffmpeg-location",
    ffmpeg,
    "--format",
    `bv*${filter}+ba/b${filter}`,
    "--merge-output-format",
    "mkv",
    "--output",
    "source.%(ext)s",
    "--restrict-filenames",
    "--no-mtime",
    "--newline",
    "--progress",
    "--progress-template",
    "download:SLICE_PROGRESS:%(progress._percent_str)s",
    "--print",
    "after_move:SLICE_FILE:%(filepath)s",
    "--socket-timeout",
    "30",
    "--retries",
    "2",
    "--fragment-retries",
    "2",
    "--proxy",
    settings.proxy,
    "--",
    url,
  ];
}

type Dependencies = {
  root: string;
  ffmpeg: string;
  ffprobe: string;
  defaultDirectory?: string;
  importVideo: (
    path: string,
    signal: AbortSignal,
    options?: ImportOptions,
  ) => Promise<Job>;
  probe: (path: string, signal: AbortSignal) => Promise<unknown>;
  emit: (status: DownloadStatus) => void;
  artifacts?: DownloadArtifacts;
};
export class DownloadService {
  private controller?: AbortController;
  private isSavingSettings = false;
  private settingsRevision = 0;
  private activeDirectory?: string;
  private settings: DownloadSettings = downloadSettingsSchema.parse({
    proxy: "",
  });
  private snapshot: DownloadStatus;
  private readonly artifacts: DownloadArtifacts;
  constructor(private readonly deps: Dependencies) {
    this.artifacts = deps.artifacts ?? DOWNLOAD_ARTIFACTS;
    this.snapshot = {
      ready: false,
      version: this.artifacts.version,
      denoVersion: this.artifacts.denoVersion,
      sizeBytes: this.artifacts.ytdlp.sizeBytes + this.artifacts.deno.sizeBytes,
      settings: this.settings,
      defaultDirectory:
        this.deps.defaultDirectory ?? join(this.deps.root, "downloads"),
      state: "idle",
      progress: 0,
      message: "首次使用请安装下载工具。",
    };
  }
  private update(change: Partial<DownloadStatus>): DownloadStatus {
    this.snapshot = {
      ...this.snapshot,
      ...change,
      settings: { ...this.settings },
    };
    this.deps.emit(this.snapshot);
    return this.snapshot;
  }
  async status(): Promise<DownloadStatus> {
    if (!this.controller && !this.isSavingSettings) {
      const revision = this.settingsRevision;
      try {
        const loaded = downloadSettingsSchema.parse(
          JSON.parse(
            await readFile(
              join(this.deps.root, "download-settings.json"),
              "utf8",
            ),
          ),
        );
        if (
          revision === this.settingsRevision &&
          !this.isSavingSettings &&
          !this.controller
        )
          this.settings = loaded;
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          this.update({ message: "下载设置无法读取，请重新保存设置。" });
      }
      try {
        const candidate = (
          await readFile(
            join(this.deps.root, "download-tools", "active.json"),
            "utf8",
          )
        ).trim();
        if (!/^[\w.-]{1,160}$/.test(candidate))
          throw new Error("Invalid active tool");
        const directory = join(this.deps.root, "download-tools", candidate);
        await stat(join(directory, "yt-dlp.exe"));
        await stat(join(directory, "deno.exe"));
        this.activeDirectory = directory;
        this.update({ ready: true });
      } catch {
        this.activeDirectory = undefined;
        this.update({ ready: false });
      }
    }
    return { ...this.snapshot, settings: { ...this.settings } };
  }
  assertIdle(): void {
    if (this.controller || this.isSavingSettings)
      throw new AppError(
        "DOWNLOAD_BUSY",
        "下载或安装正在进行，请完成后修改设置。",
      );
  }
  private async ensureWritableDirectory(directory: string): Promise<void> {
    const probe = join(directory, `.slice-write-check-${randomUUID()}`);
    // Ownership starts at exclusive creation, even if a subsequent write fails.
    const handle = await open(probe, "wx");
    try {
      await handle.writeFile("");
    } finally {
      try {
        await handle.close();
      } finally {
        await rm(probe, { force: true });
      }
    }
  }
  async saveSettings(input: DownloadSettingsInput): Promise<DownloadStatus> {
    this.assertIdle();
    const settings = downloadSettingsSchema.parse(input);
    this.isSavingSettings = true;
    const temporary = join(
      this.deps.root,
      `download-settings-${randomUUID()}.tmp`,
    );
    let ownsTemporary = false;
    try {
      if (settings.directory) {
        if (
          !isAbsolute(settings.directory) ||
          /^(?:\\\\[?.]\\)/.test(settings.directory)
        )
          throw new AppError(
            "DOWNLOAD_DIRECTORY",
            "请选择有效的绝对下载目录。",
          );
        try {
          if (!(await stat(settings.directory)).isDirectory())
            throw new Error("Not directory");
        } catch {
          throw new AppError(
            "DOWNLOAD_DIRECTORY",
            "所选下载目录不存在或无法访问，请重新选择。",
          );
        }
        try {
          await this.ensureWritableDirectory(settings.directory);
        } catch {
          throw new AppError(
            "DOWNLOAD_DIRECTORY",
            "所选下载目录无法写入，请检查权限、磁盘空间或重新选择。",
          );
        }
      }
      await mkdir(this.deps.root, { recursive: true });
      const handle = await open(temporary, "wx");
      ownsTemporary = true;
      try {
        await handle.writeFile(JSON.stringify(settings));
      } finally {
        await handle.close();
      }
      await rename(temporary, join(this.deps.root, "download-settings.json"));
      ownsTemporary = false;
      this.settingsRevision++;
      this.settings = settings;
    } finally {
      try {
        if (ownsTemporary) await rm(temporary, { force: true });
      } finally {
        this.isSavingSettings = false;
      }
    }
    return this.update({ message: "下载设置已保存。" });
  }
  cancel(): void {
    this.controller?.abort();
  }
  private begin(state: "installing" | "downloading"): AbortSignal {
    if (this.controller || this.isSavingSettings)
      throw new AppError("DOWNLOAD_BUSY", "已有下载或安装正在进行。");
    this.controller = new AbortController();
    this.update({
      state,
      progress: 0,
      message:
        state === "installing" ? "正在下载并校验工具…" : "正在解析视频链接…",
    });
    return this.controller.signal;
  }
  private failed(error: unknown): void {
    this.update({
      state: this.controller?.signal.aborted ? "cancelled" : "failed",
      message:
        error instanceof AppError
          ? error.message
          : "操作失败，请检查网络、磁盘空间和文件权限。",
    });
  }
  async install(): Promise<DownloadStatus> {
    const signal = this.begin("installing");
    const tools = join(this.deps.root, "download-tools");
    const candidate = `tool-${this.artifacts.version}-${randomUUID()}`;
    const staging = join(tools, candidate);
    let activated = false;
    const pointer = join(tools, `active-${randomUUID()}.tmp`);
    let ownsPointer = false;
    try {
      await mkdir(staging, { recursive: true });
      const disk = await statfs(staging);
      if (disk.bavail * disk.bsize < this.snapshot.sizeBytes + 250_000_000)
        throw new AppError(
          "INSTALL_SPACE",
          "磁盘空间不足，下载工具需要约 350 MB 可用空间。",
        );
      await downloadArtifact(
        this.artifacts.ytdlp,
        join(staging, "yt-dlp.exe"),
        signal,
        (progress) => this.update({ progress: progress * 0.3 }),
      );
      await downloadArtifact(
        this.artifacts.deno,
        join(staging, "deno.zip"),
        signal,
        (progress) => this.update({ progress: 0.3 + progress * 0.5 }),
      );
      await extractArchive(join(staging, "deno.zip"), staging, signal);
      this.update({
        progress: 0.9,
        message: "正在验证下载工具和 JavaScript 运行时…",
      });
      const yt = await runProcess(
        join(staging, "yt-dlp.exe"),
        ["--ignore-config", "--no-plugin-dirs", "--version"],
        { signal, timeoutMs: 30_000 },
      );
      const deno = await runProcess(join(staging, "deno.exe"), ["--version"], {
        signal,
        timeoutMs: 30_000,
      });
      if (
        yt.stdout.trim() !== this.artifacts.version ||
        !deno.stdout.startsWith(`deno ${this.artifacts.denoVersion} `)
      )
        throw new AppError(
          "INSTALL_VERSION",
          "工具版本验证失败，已保留原有安装。",
        );
      checkAbort(signal);
      await rm(join(staging, "deno.zip"));
      const handle = await open(pointer, "wx");
      ownsPointer = true;
      try {
        await handle.writeFile(candidate);
      } finally {
        await handle.close();
      }
      checkAbort(signal);
      await rename(pointer, join(tools, "active.json"));
      ownsPointer = false;
      activated = true;
      this.activeDirectory = staging;
      return this.update({
        ready: true,
        state: "succeeded",
        progress: 1,
        message: "下载工具已安装并验证，可以导入视频链接。",
      });
    } catch (error) {
      this.failed(error);
      throw error;
    } finally {
      try {
        if (ownsPointer) await rm(pointer, { force: true });
        if (!activated) await this.cleanup(staging);
      } finally {
        this.controller = undefined;
      }
    }
  }
  async importUrl(rawUrl: string, rawOptions?: ImportOptions): Promise<Job> {
    const options = importOptionsSchema.parse(rawOptions ?? {});
    const url = onlineUrlSchema.parse(rawUrl);
    await this.status();
    if (!this.activeDirectory)
      throw new AppError(
        "DOWNLOAD_NOT_INSTALLED",
        "请先在左下角「链接导入设置」中一键安装。",
      );
    const active = this.activeDirectory;
    const signal = this.begin("downloading");
    const settings = structuredClone(this.settings);
    const downloads = await this.destination(settings, signal).catch(
      (error: unknown) => {
        this.failed(error);
        this.controller = undefined;
        throw error;
      },
    );
    const hasFallbackDestination =
      !settings.directory &&
      resolve(downloads) !== resolve(this.snapshot.defaultDirectory);
    const id = randomUUID();
    const staging = join(downloads, `.partial-${id}`);
    const destination = join(downloads, id);
    let published = false;
    let ownsStaging = false;
    let imported = false;
    let printed = "";
    try {
      await mkdir(staging);
      ownsStaging = true;
      await runDownloadProcess(
        join(active, "yt-dlp.exe"),
        downloadArguments(
          url,
          settings,
          this.deps.ffmpeg,
          join(active, "deno.exe"),
        ),
        {
          cwd: staging,
          signal,
          onLine: (line) => {
            if (line.startsWith("SLICE_PROGRESS:")) {
              const percent = Number(line.slice(15).replace(/[^0-9.]/g, ""));
              if (Number.isFinite(percent))
                this.update({
                  progress: Math.min(0.65, Math.max(0, (percent / 100) * 0.65)),
                  message: "正在下载视频和音频…",
                });
            } else if (line.startsWith("SLICE_FILE:"))
              printed = line.slice(11).trim();
          },
        },
      );
      checkAbort(signal);
      const filename = (await readdir(staging)).find((name) =>
        /^source\.(mp4|mkv|webm|mov|avi|m4v|flv|ts|mpeg|mpg|ogv)$/.test(name),
      );
      if (
        !filename ||
        !printed ||
        resolve(staging, printed) !== resolve(staging, filename)
      )
        throw new AppError(
          "DOWNLOAD_OUTPUT",
          "下载工具未生成完整的视频文件，请更新工具或检查链接。",
        );
      const input = join(staging, filename);
      const info = await stat(input);
      if (!info.isFile() || info.size <= 0)
        throw new AppError("DOWNLOAD_OUTPUT", "下载的视频为空或无效。");
      this.update({
        state: "converting",
        progress: 0.66,
        message: "正在检查格式、分辨率和视频编码…",
      });
      const normalized = await normalizeDownload({
        input,
        workingDirectory: staging,
        container: settings.container,
        videoCodec: settings.videoCodec,
        ...(settings.quality === "best"
          ? {}
          : { maxHeight: Number(settings.quality.replace("p", "")) }),
        signal,
        ffmpeg: this.deps.ffmpeg,
        ffprobe: this.deps.ffprobe,
        onProgress: (progress) =>
          this.update({
            progress: 0.66 + progress * 0.28,
            message: "正在转换容器或视频编码…",
          }),
      });
      if (resolve(dirname(normalized)) !== resolve(staging))
        throw new AppError("DOWNLOAD_PATH", "视频转换输出路径无效。");
      const finalName = basename(normalized);
      this.update({
        state: "importing",
        progress: 0.96,
        message: "正在验证并导入已下载的视频…",
      });
      await this.deps.probe(normalized, signal);
      checkAbort(signal);
      if (resolve(normalized) !== resolve(input)) await rm(input);
      await rename(staging, destination);
      published = true;
      checkAbort(signal);
      const job = await this.deps.importVideo(
        join(destination, finalName),
        signal,
        options,
      );
      imported = true;
      this.update({
        state: "succeeded",
        progress: 1,
        message: hasFallbackDestination
          ? `默认视频目录不可用，视频下载并导入完成，已改存到 ${downloads}。`
          : `视频下载并导入完成，已保存到 ${downloads}。`,
      });
      return job;
    } catch (error) {
      this.failed(error);
      throw error;
    } finally {
      try {
        if (!imported && ownsStaging)
          await this.cleanupDownload(
            published ? destination : staging,
            downloads,
          );
      } finally {
        this.controller = undefined;
      }
    }
  }
  private async destination(
    settings: DownloadSettings,
    signal: AbortSignal,
  ): Promise<string> {
    const preferred = settings.directory || this.snapshot.defaultDirectory;
    const prepare = async (directory: string): Promise<void> => {
      if (!isAbsolute(directory)) throw new Error("Invalid directory");
      await mkdir(directory, { recursive: true });
      await this.ensureWritableDirectory(directory);
    };
    try {
      await prepare(preferred);
      checkAbort(signal);
      return preferred;
    } catch (error) {
      checkAbort(signal);
      if (settings.directory)
        throw new AppError(
          "DOWNLOAD_DIRECTORY",
          "所选下载目录无法写入，请检查权限、磁盘空间或重新选择。",
        );
      const fallback = join(this.deps.root, "downloads");
      if (resolve(preferred) === resolve(fallback)) throw error;
      try {
        await prepare(fallback);
      } catch {
        throw new AppError(
          "DOWNLOAD_DIRECTORY",
          "默认下载目录和应用目录均无法写入，请重新选择下载位置。",
        );
      }
      this.update({ message: `默认视频目录不可用，本次改用 ${fallback}。` });
      checkAbort(signal);
      return fallback;
    }
  }
  private async cleanupDownload(
    directory: string,
    parent: string,
  ): Promise<void> {
    if (
      resolve(dirname(directory)) !== resolve(parent) ||
      !/^(?:\.partial-)?[a-f0-9-]{36}$/.test(basename(directory))
    )
      throw new AppError("DOWNLOAD_PATH", "下载目录越界。");
    await rm(directory, { recursive: true, force: true });
  }
  private async cleanup(directory: string): Promise<void> {
    const root = resolve(this.deps.root) + sep;
    if (!resolve(directory).startsWith(root))
      throw new AppError("DOWNLOAD_PATH", "下载目录越界。");
    await rm(directory, { recursive: true, force: true });
  }
}
