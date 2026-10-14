import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as files from "node:fs/promises";
vi.mock("node:fs/promises", { spy: true });
import type { Job } from "../../../src/shared/contracts";
import {
  downloadSettingsSchema,
  onlineUrlSchema,
} from "../../../src/shared/download-contracts";
import { AppError } from "../../../src/main/lib/errors";
const mocks = vi.hoisted(() => ({
  normalize: vi.fn(),
  download: vi.fn(),
  extract: vi.fn(),
  process: vi.fn(),
  native: vi.fn(),
}));
vi.mock("../../../src/main/services/runtime/artifacts", () => ({
  downloadArtifact: mocks.download,
  extractArchive: mocks.extract,
}));
vi.mock("../../../src/main/lib/process", () => ({ runProcess: mocks.process }));
vi.mock("../../../src/main/services/download/lib/download-process", () => ({
  runDownloadProcess: mocks.native,
}));
vi.mock("../../../src/main/services/download/lib/download-media", () => ({
  normalizeDownload: mocks.normalize,
}));
import {
  DownloadService,
  downloadArguments,
} from "../../../src/main/services/download/lib/download-service";
const roots: string[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.normalize.mockImplementation(
    async ({ input }: { input: string }) => input,
  );
  mocks.download.mockImplementation(async (_artifact, path: string) =>
    writeFile(path, "verified"),
  );
  mocks.extract.mockImplementation(async (_archive, path: string) =>
    writeFile(join(path, "deno.exe"), "verified"),
  );
  mocks.process.mockImplementation(async (exe: string) => ({
    stdout: exe.endsWith("deno.exe") ? "deno 2.9.7 (stable)" : "2026.08.19\n",
    stderr: "",
  }));
  mocks.native.mockImplementation(
    async (
      _exe,
      _args,
      options: { cwd: string; onLine: (line: string) => void },
    ) => {
      await writeFile(join(options.cwd, "source.mp4"), "video");
      options.onLine("SLICE_PROGRESS: 50.0%");
      options.onLine(`SLICE_FILE:${join(options.cwd, "source.mp4")}`);
    },
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(): Promise<{
  root: string;
  service: DownloadService;
  importer: ReturnType<typeof vi.fn>;
  probe: ReturnType<typeof vi.fn>;
}> {
  const root = await mkdtemp(join(tmpdir(), "slice-download-"));
  roots.push(root);
  const importer = vi.fn(
    async (path: string) => ({ id: "imported", inputPath: path }) as Job,
  );
  const probe = vi.fn(async () => ({ durationMs: 1000 }));
  const service = new DownloadService({
    root,
    ffmpeg: "C:/bundled FFmpeg/ffmpeg.exe",
    ffprobe: "C:/bundled FFmpeg/ffprobe.exe",
    importVideo: importer,
    probe,
    emit: () => {},
  });
  return { root, service, importer, probe };
}
describe("online download boundaries", () => {
  it.each([
    "file:///video.mp4",
    "ftp://example.com/video",
    "https://user:secret@example.com/video",
    "https://a/\n--exec",
    "--exec x",
    "https://a/" + "x".repeat(4096),
  ])("rejects unsafe URL %s", (url) => {
    expect(onlineUrlSchema.safeParse(url).success).toBe(false);
  });
  it("accepts bounded HTTP(S) and no-credential proxy settings", () => {
    expect(
      onlineUrlSchema.parse(" https://www.youtube.com/watch?v=a&list=b "),
    ).toBe("https://www.youtube.com/watch?v=a&list=b");
    expect(
      downloadSettingsSchema.parse({
        quality: "best",
        proxy: "socks5://127.0.0.1:1080",
      }).proxy,
    ).toContain("1080");
    for (const proxy of [
      "http://user:secret@host",
      "file:///x",
      "http://host/path",
      "http://host?token=a",
    ])
      expect(
        downloadSettingsSchema.safeParse({ quality: "720p", proxy }).success,
      ).toBe(false);
  });
  it("keeps URL literal and config/plugins/cookies/commands disabled in fixed argv", () => {
    const url = "https://example.org/video?v=$([x])&a=`hello`";
    const args = downloadArguments(
      url,
      { quality: "720p", proxy: "" },
      "C:/媒体/ffmpeg.exe",
      "C:/runtime/deno.exe",
    );
    expect(args.slice(-2)).toEqual(["--", url]);
    expect(args).toContain("--ignore-config");
    expect(args).toContain("--no-plugin-dirs");
    expect(args).toContain("--no-playlist");
    expect(args).toContain("bv*[height<=?720]+ba/b[height<=?720]");
    for (const forbidden of [
      "--exec",
      "--cookies-from-browser",
      "--cookies",
      "--update",
      "--config-locations",
    ])
      expect(args).not.toContain(forbidden);
  });
  it("persists validated settings and rejects extra fields without replacing them", async () => {
    const f = await fixture();
    await f.service.saveSettings({
      quality: "1080p",
      proxy: "http://localhost:7890",
    });
    expect((await f.service.status()).settings.quality).toBe("1080p");
    const previous = await readFile(
      join(f.root, "download-settings.json"),
      "utf8",
    );
    await expect(
      f.service.saveSettings({
        quality: "best",
        proxy: "http://user:password@host",
      }),
    ).rejects.toThrow();
    expect(await readFile(join(f.root, "download-settings.json"), "utf8")).toBe(
      previous,
    );
  });
  it("rejects an existing unwritable directory before replacing saved settings", async () => {
    const f = await fixture();
    const before = await f.service.saveSettings({ quality: "720p", proxy: "" });
    const persisted = await readFile(
      join(f.root, "download-settings.json"),
      "utf8",
    );
    const directory = join(f.root, "denied-directory");
    await mkdir(directory);
    const sentinel = join(directory, "existing.txt");
    await writeFile(sentinel, "existing user bytes");
    vi.spyOn(files, "open").mockRejectedValueOnce(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );
    await expect(
      f.service.saveSettings({
        ...before.settings,
        directory,
        quality: "best",
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_DIRECTORY" });
    expect((await f.service.status()).settings).toEqual(before.settings);
    expect(await readFile(join(f.root, "download-settings.json"), "utf8")).toBe(
      persisted,
    );
    expect(await readdir(directory)).toEqual(["existing.txt"]);
    expect(await readFile(sentinel, "utf8")).toBe("existing user bytes");
  });
  it("cleans an exclusively created write probe after write failure and preserves an unowned collision", async () => {
    const f = await fixture();
    const directory = join(f.root, "selected-directory");
    await mkdir(directory);
    const realOpen = (await vi.importActual<typeof files>("node:fs/promises"))
      .open;
    vi.spyOn(files, "open").mockImplementationOnce(async (...args) => {
      const handle = await realOpen(...args);
      vi.spyOn(handle, "writeFile").mockRejectedValueOnce(
        Object.assign(new Error("full"), { code: "ENOSPC" }),
      );
      return handle;
    });
    await expect(
      f.service.saveSettings({ directory, proxy: "" }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_DIRECTORY" });
    expect(await readdir(directory)).toEqual([]);
    vi.spyOn(files, "open").mockImplementationOnce(async (path) => {
      await writeFile(path, "unowned collision");
      throw Object.assign(new Error("exists"), { code: "EEXIST" });
    });
    await expect(
      f.service.saveSettings({ directory, proxy: "" }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_DIRECTORY" });
    const names = await readdir(directory);
    expect(names).toHaveLength(1);
    expect(await readFile(join(directory, names[0] ?? "missing"), "utf8")).toBe(
      "unowned collision",
    );
  });
  it("preserves an unowned write-probe collision before downloading or creating a job", async () => {
    const f = await fixture();
    const directory = join(f.root, "selected-directory");
    await mkdir(directory);
    await f.service.saveSettings({ directory, proxy: "" });
    await f.service.install();
    let collision = "";
    vi.spyOn(files, "open").mockImplementationOnce(async (path) => {
      collision = String(path);
      await writeFile(path, "pre-existing probe bytes");
      throw Object.assign(new Error("exists"), { code: "EEXIST" });
    });
    await expect(
      f.service.importUrl("https://example.org/video"),
    ).rejects.toMatchObject({ code: "DOWNLOAD_DIRECTORY" });
    expect(collision).not.toBe("");
    expect(await readFile(collision, "utf8")).toBe("pre-existing probe bytes");
    expect(mocks.native).not.toHaveBeenCalled();
    expect(f.importer).not.toHaveBeenCalled();
    expect((await f.service.status()).settings.directory).toBe(directory);
  });
  it.each(["settings", "install"])(
    "preserves unowned %s staging collisions and the prior working snapshot",
    async (operation) => {
      const f = await fixture();
      await f.service.saveSettings({ quality: "720p", proxy: "" });
      await f.service.install();
      const settingsBefore = await readFile(
        join(f.root, "download-settings.json"),
        "utf8",
      );
      const activeBefore = await readFile(
        join(f.root, "download-tools", "active.json"),
        "utf8",
      );
      let collision = "";
      vi.spyOn(files, "open").mockImplementationOnce(async (path) => {
        collision = String(path);
        await writeFile(path, "unowned staging bytes");
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      });
      await expect(
        operation === "settings"
          ? f.service.saveSettings({ quality: "best", proxy: "" })
          : f.service.install(),
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(collision, "utf8")).toBe("unowned staging bytes");
      expect(
        await readFile(join(f.root, "download-settings.json"), "utf8"),
      ).toBe(settingsBefore);
      expect(
        await readFile(join(f.root, "download-tools", "active.json"), "utf8"),
      ).toBe(activeBefore);
      expect((await f.service.status()).ready).toBe(true);
    },
  );
  it.each(["settings", "install"])(
    "removes owned partial %s staging after a write failure without losing the prior snapshot",
    async (operation) => {
      const f = await fixture();
      await f.service.saveSettings({ quality: "720p", proxy: "" });
      await f.service.install();
      const settingsBefore = await readFile(
        join(f.root, "download-settings.json"),
        "utf8",
      );
      const activeBefore = await readFile(
        join(f.root, "download-tools", "active.json"),
        "utf8",
      );
      const realOpen = (await vi.importActual<typeof files>("node:fs/promises"))
        .open;
      let partial = "";
      vi.spyOn(files, "open").mockImplementationOnce(async (...args) => {
        partial = String(args[0]);
        const handle = await realOpen(...args);
        vi.spyOn(handle, "writeFile").mockImplementationOnce(async () => {
          await handle.write("partial bytes");
          throw Object.assign(new Error("full"), { code: "ENOSPC" });
        });
        return handle;
      });
      await expect(
        operation === "settings"
          ? f.service.saveSettings({ quality: "best", proxy: "" })
          : f.service.install(),
      ).rejects.toMatchObject({ code: "ENOSPC" });
      expect(await files.stat(partial).catch(() => undefined)).toBeUndefined();
      expect(
        await readFile(join(f.root, "download-settings.json"), "utf8"),
      ).toBe(settingsBefore);
      expect(
        await readFile(join(f.root, "download-tools", "active.json"), "utf8"),
      ).toBe(activeBefore);
      expect((await f.service.status()).ready).toBe(true);
    },
  );
  it("activates only after integrity and both exact version probes", async () => {
    const f = await fixture();
    const result = await f.service.install();
    expect(result.ready).toBe(true);
    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(mocks.process).toHaveBeenCalledTimes(2);
    expect(
      await readFile(join(f.root, "download-tools", "active.json"), "utf8"),
    ).toMatch(/^tool-/);
  });
  it.each(["integrity", "version"])(
    "failed %s update retains active working installation and cleans candidate",
    async (failure) => {
      const f = await fixture();
      await f.service.install();
      const previous = await readFile(
        join(f.root, "download-tools", "active.json"),
        "utf8",
      );
      if (failure === "integrity")
        mocks.download.mockRejectedValue(
          new AppError("INSTALL_INTEGRITY", "校验失败"),
        );
      else mocks.process.mockResolvedValue({ stdout: "wrong", stderr: "" });
      await expect(f.service.install()).rejects.toThrow();
      expect(
        await readFile(join(f.root, "download-tools", "active.json"), "utf8"),
      ).toBe(previous);
      expect((await readdir(join(f.root, "download-tools"))).sort()).toEqual(
        ["active.json", previous].sort(),
      );
      expect((await f.service.status()).ready).toBe(true);
    },
  );
  it("cancels install and releases busy guard without activating partial bytes", async () => {
    const f = await fixture();
    mocks.download.mockImplementation(async (_a, _p, signal: AbortSignal) => {
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new AppError("CANCELLED", "取消")),
          { once: true },
        ),
      );
    });
    const operation = f.service.install();
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalled());
    await expect(f.service.install()).rejects.toMatchObject({
      code: "DOWNLOAD_BUSY",
    });
    f.service.cancel();
    await expect(operation).rejects.toMatchObject({ code: "CANCELLED" });
    expect((await f.service.status()).state).toBe("cancelled");
    expect(await readdir(join(f.root, "download-tools"))).toEqual([]);
  });
  it("downloads in controlled folders, probes before import, retains prior files", async () => {
    const f = await fixture();
    await f.service.install();
    const first = await f.service.importUrl("https://example.org/one", {
      translationEnabled: false,
      sourceLanguage: "ja",
    });
    const second = await f.service.importUrl("https://example.org/two", {
      translationEnabled: true,
      targetLanguage: "zh-CN",
    });
    expect(first.inputPath).not.toBe(second.inputPath);
    expect(await readFile(first.inputPath, "utf8")).toBe("video");
    expect(f.probe.mock.invocationCallOrder[0]).toBeLessThan(
      f.importer.mock.invocationCallOrder[0] ?? 0,
    );
    expect(f.importer).toHaveBeenCalledTimes(2);
    expect(f.importer.mock.calls[0]?.[2]).toEqual({
      translationEnabled: false,
      sourceLanguage: "ja",
    });
    expect(f.importer.mock.calls[1]?.[2]).toEqual({
      translationEnabled: true,
      targetLanguage: "zh-CN",
    });
    expect(
      (await readdir(join(f.root, "downloads"))).every(
        (n) => !n.startsWith(".partial"),
      ),
    ).toBe(true);
  });
  it.each(["exit", "missing", "outside", "probe", "import"])(
    "failed %s download never leaves partial source or publishes a job",
    async (failure) => {
      const f = await fixture();
      await f.service.install();
      if (failure === "exit")
        mocks.native.mockRejectedValue(
          new AppError("DOWNLOAD_BLOCKED", "阻止"),
        );
      if (failure === "missing") mocks.native.mockResolvedValue(undefined);
      if (failure === "outside")
        mocks.native.mockImplementation(
          async (_e, _a, o: { cwd: string; onLine: (s: string) => void }) => {
            await writeFile(join(o.cwd, "source.mp4"), "video");
            o.onLine("SLICE_FILE:../../user-video.mp4");
          },
        );
      if (failure === "probe")
        f.probe.mockRejectedValue(new AppError("NO_VIDEO", "无视频"));
      if (failure === "import")
        f.importer.mockRejectedValue(new AppError("DB", "导入失败"));
      await expect(
        f.service.importUrl("https://example.org/video"),
      ).rejects.toThrow();
      expect(await readdir(join(f.root, "downloads"))).toEqual([]);
      if (failure !== "import") expect(f.importer).not.toHaveBeenCalled();
    },
  );
  it("rejects a persisted tool path outside application storage", async () => {
    const f = await fixture();
    await mkdir(join(f.root, "download-tools"));
    await writeFile(
      join(f.root, "download-tools", "active.json"),
      "../outside",
    );
    expect((await f.service.status()).ready).toBe(false);
    await expect(
      f.service.importUrl("https://example.org/video"),
    ).rejects.toMatchObject({ code: "DOWNLOAD_NOT_INSTALLED" });
    expect(mocks.native).not.toHaveBeenCalled();
  });
  it("cancellation during media validation creates no job and removes partial files", async () => {
    const f = await fixture();
    await f.service.install();
    f.probe.mockImplementation(async (_path: string, signal: AbortSignal) => {
      f.service.cancel();
      if (signal.aborted) throw new AppError("CANCELLED", "取消");
    });
    await expect(
      f.service.importUrl("https://example.org/video"),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(f.importer).not.toHaveBeenCalled();
    expect(await readdir(join(f.root, "downloads"))).toEqual([]);
  });
  it("cancellation after job commit retains successful job and original source", async () => {
    const f = await fixture();
    await f.service.install();
    f.importer.mockImplementation(async (path: string) => {
      f.service.cancel();
      return { id: "committed", inputPath: path } as Job;
    });
    const job = await f.service.importUrl("https://example.org/video");
    expect(job.id).toBe("committed");
    expect(await readFile(job.inputPath, "utf8")).toBe("video");
    expect((await f.service.status()).state).toBe("succeeded");
  });
  it("settings changes during active native download are rejected without changing arguments", async () => {
    const f = await fixture();
    await f.service.install();
    mocks.native.mockImplementation(
      async (_e, args: string[], o: { signal: AbortSignal }) => {
        expect(args).toContain("bv*[height<=?1080]+ba/b[height<=?1080]");
        await expect(
          f.service.saveSettings({ quality: "best", proxy: "" }),
        ).rejects.toMatchObject({ code: "DOWNLOAD_BUSY" });
        f.service.cancel();
        if (o.signal.aborted) throw new AppError("CANCELLED", "取消");
      },
    );
    await expect(
      f.service.importUrl("https://example.org/video"),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect((await f.service.status()).settings.quality).toBe("1080p");
  });
  it("migrates old settings while retaining chosen quality/proxy and supplies final defaults", async () => {
    const f = await fixture();
    await writeFile(
      join(f.root, "download-settings.json"),
      JSON.stringify({ quality: "720p", proxy: "" }),
    );
    expect((await f.service.status()).settings).toEqual({
      quality: "720p",
      proxy: "",
      directory: "",
      container: "mp4",
      videoCodec: "original",
    });
    expect(downloadSettingsSchema.parse({ proxy: "" })).toEqual({
      quality: "1080p",
      proxy: "",
      directory: "",
      container: "mp4",
      videoCodec: "original",
    });
  });
  it("retains existing files in explicitly selected download directories", async () => {
    const f = await fixture();
    const selected = join(f.root, "用户 下载位置");
    await mkdir(selected);
    await writeFile(join(selected, "source.mp4"), "existing");
    await f.service.saveSettings({
      quality: "480p",
      proxy: "",
      directory: selected,
      container: "mkv",
      videoCodec: "h265",
    });
    await f.service.install();
    const job = await f.service.importUrl("https://example.org/video");
    expect(job.inputPath.startsWith(selected)).toBe(true);
    expect(await readFile(join(selected, "source.mp4"), "utf8")).toBe(
      "existing",
    );
    expect(mocks.normalize).toHaveBeenCalledWith(
      expect.objectContaining({
        container: "mkv",
        videoCodec: "h265",
        maxHeight: 480,
      }),
    );
  });
  it("rejects nonexistent/non-directory/relative selected destinations without changing persisted settings", async () => {
    const f = await fixture();
    await f.service.saveSettings({ quality: "1080p", proxy: "" });
    const before = await readFile(
      join(f.root, "download-settings.json"),
      "utf8",
    );
    for (const directory of [
      "relative/path",
      join(f.root, "missing"),
      join(f.root, "download-settings.json"),
    ])
      await expect(
        f.service.saveSettings({ quality: "best", proxy: "", directory }),
      ).rejects.toMatchObject({ code: "DOWNLOAD_DIRECTORY" });
    expect(await readFile(join(f.root, "download-settings.json"), "utf8")).toBe(
      before,
    );
  });
  it("reserves room for retained tool cache and staging copies before starting downloads", async () => {
    const f = await fixture(); const status = await f.service.status();
    const available = BigInt(status.sizeBytes * 2 + 250_000_000 - 1);
    vi.spyOn(files, "statfs").mockResolvedValue({ type: 0n, bsize: 1n, blocks: available * 2n, bfree: available, bavail: available, files: 1000n, ffree: 1000n });
    await expect(f.service.install()).rejects.toMatchObject({ code: "INSTALL_SPACE" });
    expect(mocks.download).not.toHaveBeenCalled();
    expect((await f.service.status()).ready).toBe(false);
  });
});
