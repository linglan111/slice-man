import { randomUUID } from "node:crypto";
import { join, isAbsolute } from "node:path";
import { mkdir, readFile, rename, rm, open } from "node:fs/promises";
import {
  exportSettingsSchema,
  type ExportSettings,
  type ExportSettingsInput,
} from "../../../../shared/export-contracts";
import { AppError } from "../../../lib/errors";

export class ExportSettingsService {
  private settings: ExportSettings;
  private isLoaded = false;
  private loading?: Promise<void>;
  private isSaving = false;
  constructor(
    private readonly root: string,
    defaultDirectory: string,
  ) {
    this.settings = exportSettingsSchema.parse({
      directory: defaultDirectory,
      videoFormat: "mp4",
      videoCodec: "original",
      resolution: "1080p",
      quality: "balanced",
      subtitleFormat: "srt",
    });
  }
  private async load(): Promise<void> {
    if (this.isLoaded) return;
    if (!this.loading)
      this.loading = (async (): Promise<void> => {
        try {
          this.settings = exportSettingsSchema.parse(
            JSON.parse(
              await readFile(join(this.root, "export-settings.json"), "utf8"),
            ),
          );
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
          )
            throw new AppError(
              "EXPORT_SETTINGS_READ",
              "导出设置无法读取，请重新保存设置；已有导出文件不会改变。",
            );
        } finally {
          this.isLoaded = true;
        }
      })();
    await this.loading;
  }
  async status(): Promise<ExportSettings> {
    await this.load();
    return { ...this.settings };
  }
  assertIdle(): void {
    if (this.isSaving)
      throw new AppError(
        "EXPORT_SETTINGS_BUSY",
        "导出设置正在保存，请稍后重试。",
      );
  }
  async saveSettings(raw: ExportSettingsInput): Promise<ExportSettings> {
    this.assertIdle();
    const input = exportSettingsSchema.parse(raw);
    if (!isAbsolute(input.directory))
      throw new AppError("EXPORT_DIRECTORY", "请选择绝对导出目录。");
    this.isSaving = true;
    const temporary = join(this.root, `.export-settings-${randomUUID()}.json`);
    let hasTemporary = false;
    try {
      await this.load();
      await this.prepareDirectory(input.directory);
      await mkdir(this.root, { recursive: true });
      const handle = await open(temporary, "wx");
      hasTemporary = true;
      try {
        await handle.writeFile(JSON.stringify(input));
      } finally {
        await handle.close();
      }
      await rename(temporary, join(this.root, "export-settings.json"));
      hasTemporary = false;
      this.settings = input;
      return { ...this.settings };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "EXPORT_SETTINGS_SAVE",
        "无法保存导出设置，请检查目录权限或剩余空间；原设置已保留。",
      );
    } finally {
      if (hasTemporary) await rm(temporary, { force: true });
      this.isSaving = false;
    }
  }
  async prepareDirectory(directory?: string): Promise<void> {
    const path = directory ?? (await this.status()).directory;
    const probe = join(path, `.slice-export-write-${randomUUID()}.tmp`);
    let hasProbe = false;
    try {
      await mkdir(path, { recursive: true });
      const handle = await open(probe, "wx");
      hasProbe = true;
      await handle.close();
    } catch {
      throw new AppError(
        "EXPORT_DIRECTORY",
        "导出目录无法写入，请选择其他目录或检查权限和剩余空间。",
      );
    } finally {
      if (hasProbe) await rm(probe, { force: true });
    }
  }
}
