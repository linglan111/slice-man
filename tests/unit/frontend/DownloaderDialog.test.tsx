// @vitest-environment jsdom
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DownloaderDialog } from "../../../src/renderer/src/components/DownloaderDialog";
import { downloadSettingsSchema } from "../../../src/shared/download-contracts";
import type { DownloadStatus, Result } from "../../../src/shared/contracts";
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (): void {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (): void {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function status(directory = ""): DownloadStatus {
  return {
    ready: true,
    version: "test",
    denoVersion: "test",
    sizeBytes: 60_000_000,
    defaultDirectory: "C:/Videos/Slice Man",
    settings: downloadSettingsSchema.parse({
      quality: "720p",
      proxy: "",
      directory,
    }),
    state: "idle",
    progress: 0,
    message: "",
  };
}
describe("download settings draft ownership", () => {
  it("shows retained tool bytes after restart, does no automatic download, and clears cache explicitly", async () => {
    const initial = { ...status(), downloadCache: { totalBytes: 8192, assets: [{ id: "yt-dlp" as const, name: "yt-dlp", downloadedBytes: 8192, totalBytes: 100000, state: "partial" as const, resumable: true }] } };
    const install = vi.fn(); const clear = vi.fn().mockResolvedValue({ success: true, data: { ...status(), downloadCache: { assets: [], totalBytes: 0 } } });
    vi.stubGlobal("api", { download: { status: vi.fn().mockResolvedValue({ success: true, data: initial }), install, clearDownloadCache: clear }, onDownloadStatus: vi.fn(() => vi.fn()) });
    render(<DownloaderDialog onClose={vi.fn()} />);
    await screen.findByRole("button", { name: "继续安装下载工具" });
    expect(screen.getByText(/yt-dlp · 8.0 KB/)).toBeTruthy(); expect(install).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除下载缓存" }));
    await screen.findByRole("button", { name: "重新安装固定版本" });
    expect(clear).toHaveBeenCalledOnce(); expect(install).not.toHaveBeenCalled(); expect(screen.getByText(/下载工具已就绪/)).toBeTruthy();
  });
  it("keeps fields disabled until initial persisted settings arrive, even if an early status event arrives", async () => {
    let complete: ((value: Result<DownloadStatus>) => void) | undefined;
    let subscriber: ((value: DownloadStatus) => void) | undefined;
    vi.stubGlobal("api", {
      download: {
        status: vi.fn(
          () =>
            new Promise<Result<DownloadStatus>>((done) => {
              complete = done;
            }),
        ),
      },
      onDownloadStatus: (callback: (value: DownloadStatus) => void) => {
        subscriber = callback;
        return vi.fn();
      },
    });
    render(<DownloaderDialog onClose={vi.fn()} />);
    await act(async () => subscriber?.(status()));
    expect(
      (screen.getByLabelText("下载视频编码") as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "保存下载设置",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () =>
      complete?.({ success: true, data: status("C:/chosen") }),
    );
    expect(
      (screen.getByLabelText("下载视频编码") as HTMLSelectElement).disabled,
    ).toBe(false);
    expect((screen.getByLabelText("下载位置") as HTMLInputElement).value).toBe(
      "C:/chosen",
    );
  });
  it("native directory selection changes only directory and retains unsaved codec/format/quality", async () => {
    const save = vi
      .fn()
      .mockResolvedValue({ success: true, data: status("C:/new") });
    vi.stubGlobal("api", {
      download: {
        status: vi.fn().mockResolvedValue({ success: true, data: status() }),
        chooseDirectory: vi
          .fn()
          .mockResolvedValue({ success: true, data: status("C:/new") }),
        saveSettings: save,
      },
      onDownloadStatus: vi.fn(() => vi.fn()),
    });
    render(<DownloaderDialog onClose={vi.fn()} />);
    await waitFor(() =>
      expect(
        (screen.getByLabelText("下载视频编码") as HTMLSelectElement).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("下载视频编码"), {
      target: { value: "h265" },
    });
    fireEvent.change(screen.getByLabelText("下载容器格式"), {
      target: { value: "original" },
    });
    fireEvent.change(screen.getByLabelText("视频下载清晰度"), {
      target: { value: "480p" },
    });
    fireEvent.click(screen.getByRole("button", { name: "选择下载位置" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("下载位置") as HTMLInputElement).value,
      ).toBe("C:/new"),
    );
    expect(
      (screen.getByLabelText("下载视频编码") as HTMLSelectElement).value,
    ).toBe("h265");
    fireEvent.click(screen.getByRole("button", { name: "保存下载设置" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          directory: "C:/new",
          videoCodec: "h265",
          container: "original",
          quality: "480p",
        }),
      ),
    );
  });
});
