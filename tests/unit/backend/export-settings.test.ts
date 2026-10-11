import { afterEach, describe, expect, it, vi } from "vitest";
import * as files from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExportSettingsService } from "../../../src/main/services/export-settings/lib/export-settings-service";
import type { ExportSettingsInput } from "../../../src/shared/export-contracts";
vi.mock("node:fs/promises", { spy: true });
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    await files.rm(root, { recursive: true, force: true });
});
async function fixture(): Promise<{
  root: string;
  service: ExportSettingsService;
  directory: string;
}> {
  const root = await files.mkdtemp(join(tmpdir(), "slice-export-settings-"));
  roots.push(root);
  const directory = join(root, "Exports");
  return {
    root,
    directory,
    service: new ExportSettingsService(root, directory),
  };
}
describe("independent export preference persistence", () => {
  it("has the approved defaults and persists all selected values across service restart", async () => {
    const f = await fixture();
    expect(await f.service.status()).toEqual({
      directory: f.directory,
      videoFormat: "mp4",
      videoCodec: "original",
      resolution: "1080p",
      quality: "balanced",
      subtitleFormat: "srt",
    });
    const input: ExportSettingsInput = {
      directory: join(f.root, "selected 中文"),
      videoFormat: "mkv",
      videoCodec: "h265",
      resolution: "720p",
      quality: "high",
      subtitleFormat: "ass",
    };
    const saved = await f.service.saveSettings(input);
    expect(saved).toEqual(input);
    saved.quality = "small";
    expect(await f.service.status()).toEqual(input);
    expect(
      await new ExportSettingsService(f.root, f.directory).status(),
    ).toEqual(input);
    expect(
      JSON.parse(
        await files.readFile(join(f.root, "export-settings.json"), "utf8"),
      ),
    ).toEqual(input);
    expect(await files.readdir(input.directory)).toEqual([]);
  });
  it("rejects malformed updates and unwritable directories while retaining the complete prior configuration", async () => {
    const f = await fixture();
    const before = await f.service.saveSettings(await f.service.status());
    const data = await files.readFile(
      join(f.root, "export-settings.json"),
      "utf8",
    );
    for (const changes of [
      { directory: "relative/folder" },
      { directory: "" },
      { directory: `${f.directory}\n` },
      { videoCodec: "vp9" },
      { resolution: "best" },
      { videoFormat: "webm" },
      { quality: "lossless" },
      { subtitleFormat: "ssa" },
      { command: "arbitrary" },
    ])
      await expect(
        f.service.saveSettings({
          ...before,
          ...changes,
        } as ExportSettingsInput),
      ).rejects.toBeDefined();
    const existing = join(f.root, "existing-user-file");
    await files.writeFile(existing, "old user bytes");
    await expect(
      f.service.saveSettings({ ...before, directory: existing }),
    ).rejects.toMatchObject({ code: "EXPORT_DIRECTORY" });
    expect(await files.readFile(existing, "utf8")).toBe("old user bytes");
    expect(await f.service.status()).toEqual(before);
    expect(
      await files.readFile(join(f.root, "export-settings.json"), "utf8"),
    ).toBe(data);
  });
  it("keeps saved defaults and removes owned staging if atomic replacement fails", async () => {
    const f = await fixture();
    const before = await f.service.saveSettings(await f.service.status());
    const rename = vi
      .spyOn(files, "rename")
      .mockClear()
      .mockRejectedValueOnce(new Error("synthetic filesystem failure"));
    await expect(
      f.service.saveSettings({ ...before, subtitleFormat: "vtt" }),
    ).rejects.toMatchObject({ code: "EXPORT_SETTINGS_SAVE" });
    expect(rename).toHaveBeenCalledTimes(1);
    expect(await f.service.status()).toEqual(before);
    expect(
      await new ExportSettingsService(f.root, f.directory).status(),
    ).toEqual(before);
    expect(
      (await files.readdir(f.root)).some((name) =>
        name.startsWith(".export-settings-"),
      ),
    ).toBe(false);
  });
  it("reports malformed persisted settings and permits explicit recovery without deleting the existing file", async () => {
    const f = await fixture();
    await files.writeFile(
      join(f.root, "export-settings.json"),
      '{"videoCodec":"arbitrary"}',
    );
    await expect(f.service.status()).rejects.toMatchObject({
      code: "EXPORT_SETTINGS_READ",
    });
    expect(
      await files.readFile(join(f.root, "export-settings.json"), "utf8"),
    ).toContain("arbitrary");
    const defaults = await f.service.status();
    expect(
      await f.service.saveSettings({ ...defaults, subtitleFormat: "vtt" }),
    ).toMatchObject({ subtitleFormat: "vtt" });
  });
  it("guards concurrent saves and exposes the previous valid snapshot until commit", async () => {
    const f = await fixture();
    const before = await f.service.saveSettings(await f.service.status());
    const realRename = files.rename;
    let release: (() => void) | undefined;
    let enter: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      enter = resolve;
    });
    vi.spyOn(files, "rename").mockImplementationOnce(async (...args) => {
      enter?.();
      await gate;
      return realRename(...args);
    });
    const saving = f.service.saveSettings({ ...before, subtitleFormat: "vtt" });
    await started;
    await expect(
      f.service.saveSettings({ ...before, subtitleFormat: "ass" }),
    ).rejects.toMatchObject({ code: "EXPORT_SETTINGS_BUSY" });
    expect(await f.service.status()).toEqual(before);
    release?.();
    expect(await saving).toMatchObject({ subtitleFormat: "vtt" });
  });
});
