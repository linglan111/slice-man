import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import type { Store } from "../../../src/main/db/store";
import type { JobService } from "../../../src/main/services/jobs/lib/job-service";
import type { RuntimeService } from "../../../src/main/services/runtime/runtime-service";
import type { DownloadService } from "../../../src/main/services/download/lib/download-service";
import type { ExportSettingsService } from "../../../src/main/services/export-settings/lib/export-settings-service";

const mocks = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (event: unknown, raw: unknown) => Promise<unknown>
  >(),
  removed: [] as string[],
  listProfiles: vi.fn(() => []),
  saveProfile: vi.fn(),
  recognizeAgain: vi.fn(async () => ({ id: "test-job" })),
  addSegment: vi.fn(() => ({ id: "test-job" })),
  removeSegment: vi.fn(() => ({ id: "test-job" })),
  exportSettingsStatus: vi.fn(async () => ({
    directory: "F:/isolated/Exports",
    videoFormat: "mp4",
    videoCodec: "original",
    resolution: "1080p",
    quality: "balanced",
    subtitleFormat: "srt",
  })),
  exportSettingsSave: vi.fn(),
  prepareDirectory: vi.fn(async () => {}),
  exportJob: vi.fn(async () => ({ path: "F:/isolated/chosen.mp4" })),
  getJob: vi.fn(() => ({ name: "anonymous.mp4" })),
  showSaveDialog: vi.fn(async (_window: unknown, _options: unknown) => ({
    filePath: "F:/isolated/chosen.mp4",
  })),
  showOpenDialog: vi.fn(async () => ({ filePaths: [] as string[] })),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, raw: unknown) => Promise<unknown>,
    ) => mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.removed.push(channel),
  },
  dialog: {
    showSaveDialog: mocks.showSaveDialog,
    showOpenDialog: mocks.showOpenDialog,
  },
}));
vi.mock("../../../src/main/env-setup", () => ({ isE2e: false }));
import { registerIpc } from "../../../src/main/ipc";

beforeEach(() => {
  mocks.handlers.clear();
  mocks.removed.length = 0;
  vi.clearAllMocks();
});
describe("independent narrow IPC trust boundary", () => {
  function fixture(): {
    invoke: (
      channel: string,
      raw: unknown,
      event?: unknown,
    ) => Promise<unknown>;
    dispose: () => void;
    mainFrame: object;
    webContents: { mainFrame: object };
  } {
    const mainFrame = {};
    const webContents = { mainFrame };
    const window = { webContents } as unknown as BrowserWindow;
    const dispose = registerIpc({
      window,
      store: {
        listProfiles: mocks.listProfiles,
        saveProfile: mocks.saveProfile,
        getJob: mocks.getJob,
      } as unknown as Store,
      jobs: {
        recognizeAgain: mocks.recognizeAgain,
        addSegment: mocks.addSegment,
        removeSegment: mocks.removeSegment,
        export: mocks.exportJob,
      } as unknown as JobService,
      runtime: {} as RuntimeService,
      download: { cancel: vi.fn() } as unknown as DownloadService,
      exportSettings: {
        status: mocks.exportSettingsStatus,
        saveSettings: mocks.exportSettingsSave,
        prepareDirectory: mocks.prepareDirectory,
        assertIdle: vi.fn(),
      } as unknown as ExportSettingsService,
    });
    const invoke = async (
      channel: string,
      raw: unknown,
      event: unknown = { sender: webContents, senderFrame: mainFrame },
    ): Promise<unknown> => {
      const handler = mocks.handlers.get(channel);
      if (!handler) throw new Error("Missing handler");
      return handler(event, raw);
    };
    return { invoke, dispose, mainFrame, webContents };
  }
  it("accepts only the application's main frame", async () => {
    const f = fixture();
    expect(await f.invoke("profiles:list", undefined)).toEqual({
      success: true,
      data: [],
    });
    expect(
      await f.invoke("profiles:list", undefined, {
        sender: {},
        senderFrame: f.mainFrame,
      }),
    ).toMatchObject({ success: false, code: "IPC_DENIED" });
    expect(
      await f.invoke("profiles:list", undefined, {
        sender: f.webContents,
        senderFrame: {},
      }),
    ).toMatchObject({ success: false, code: "IPC_DENIED" });
    expect(mocks.listProfiles).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed and unknown input fields before storage mutation", async () => {
    const f = fixture();
    expect(
      await f.invoke("profiles:save", {
        name: "incomplete",
        apiKey: "test-only",
      }),
    ).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(await f.invoke("profiles:list", { arbitrary: true })).toMatchObject({
      success: false,
      code: "VALIDATION_ERROR",
    });
    expect(mocks.saveProfile).not.toHaveBeenCalled();
    expect(mocks.listProfiles).not.toHaveBeenCalled();
  });
  it("does not pass exception text or secrets through structured errors", async () => {
    const f = fixture();
    mocks.listProfiles.mockImplementationOnce(() => {
      throw new Error("private test-only secret");
    });
    const result = await f.invoke("profiles:list", undefined);
    expect(result).toMatchObject({ success: false, code: "OPERATION_FAILED" });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("requires an explicit current revision for a new recognition run", async () => {
    const f = fixture();
    for (const raw of [
      "test-job",
      { jobId: "test-job" },
      { jobId: "test-job", revision: -1 },
      { jobId: "test-job", revision: 0.5 },
      { jobId: "test-job", revision: 2, force: true },
    ])
      expect(await f.invoke("jobs:recognizeAgain", raw)).toMatchObject({
        success: false,
        code: "VALIDATION_ERROR",
      });
    expect(mocks.recognizeAgain).not.toHaveBeenCalled();
    expect(
      await f.invoke("jobs:recognizeAgain", { jobId: "test-job", revision: 2 }),
    ).toMatchObject({ success: true });
    expect(mocks.recognizeAgain).toHaveBeenCalledExactlyOnceWith("test-job", 2);
  });
  it("removes every registered handler when disposed", () => {
    const f = fixture();
    f.dispose();
    expect(new Set(mocks.removed)).toEqual(new Set(mocks.handlers.keys()));
    expect(mocks.removed).toHaveLength(32);
  });
  it("validates export defaults and passes only operation choices, using configured native-dialog location", async () => {
    const f = fixture();
    const settings = await mocks.exportSettingsStatus();
    expect(
      await f.invoke("exportSettings:saveSettings", {
        ...settings,
        videoCodec: "vp9",
      }),
    ).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(
      await f.invoke("exportSettings:saveSettings", {
        ...settings,
        command: "shell",
      }),
    ).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(
      await f.invoke("jobs:export", {
        jobId: "job",
        format: "mp4",
        destination: "renderer file",
      }),
    ).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(mocks.exportSettingsSave).not.toHaveBeenCalled();
    expect(mocks.exportJob).not.toHaveBeenCalled();
    expect(
      await f.invoke("jobs:export", {
        jobId: "job",
        format: "mkv",
        quality: "small",
        videoCodec: "h265",
        resolution: "720p",
      }),
    ).toMatchObject({ success: true });
    expect(mocks.showSaveDialog.mock.calls[0]?.[1]).toMatchObject({
      defaultPath: expect.stringContaining("Exports"),
      filters: [{ name: "MKV", extensions: ["mkv"] }],
    });
    expect(mocks.exportJob).toHaveBeenLastCalledWith(
      "job",
      "mkv",
      "small",
      "F:/isolated/chosen.mp4",
      { videoCodec: "h265", resolution: "720p" },
    );
    expect(
      await f.invoke("jobs:export", { jobId: "job", format: "srt" }),
    ).toMatchObject({ success: true });
    expect(mocks.exportJob).toHaveBeenLastCalledWith(
      "job",
      "srt",
      "balanced",
      "F:/isolated/chosen.mp4",
      { videoCodec: undefined, resolution: undefined },
    );
    expect(mocks.exportSettingsSave).not.toHaveBeenCalled();
  });
  it("returns null on cancelled native export/directory dialogs and merges only chosen directory", async () => {
    const f = fixture();
    expect(await f.invoke("exportSettings:chooseDirectory", undefined)).toEqual(
      { success: true, data: null },
    );
    expect(mocks.exportSettingsSave).not.toHaveBeenCalled();
    mocks.showOpenDialog.mockResolvedValueOnce({
      filePaths: ["F:/isolated/new-folder"],
    });
    const settings = await mocks.exportSettingsStatus();
    await f.invoke("exportSettings:chooseDirectory", undefined);
    expect(mocks.exportSettingsSave).toHaveBeenCalledWith({
      ...settings,
      directory: "F:/isolated/new-folder",
    });
    mocks.showSaveDialog.mockResolvedValueOnce({ filePath: "" });
    expect(
      await f.invoke("jobs:export", { jobId: "job", format: "vtt" }),
    ).toEqual({ success: true, data: null });
    expect(mocks.exportJob).not.toHaveBeenCalled();
  });
  it("strictly validates manual cue additions/deletions before calling job procedures", async () => {
    const f = fixture();
    const valid = {
      jobId: "test-job",
      revision: 2,
      segment: { startMs: 0, endMs: 1, sourceText: "manual" },
    };
    for (const raw of [
      { ...valid, revision: -1 },
      { ...valid, revision: 0.5 },
      { ...valid, force: true },
      { ...valid, segment: { ...valid.segment, id: "supplied-id" } },
      { ...valid, segment: { ...valid.segment, translationStale: false } },
      { ...valid, segment: { ...valid.segment, endMs: 0 } },
      { ...valid, segment: { ...valid.segment, sourceText: " " } },
      {
        ...valid,
        segment: { ...valid.segment, translatedText: "x".repeat(20001) },
      },
    ])
      expect(await f.invoke("jobs:addSegment", raw)).toMatchObject({
        success: false,
        code: "VALIDATION_ERROR",
      });
    for (const raw of [
      { jobId: "test-job", segmentId: "first" },
      { jobId: "test-job", revision: 2, segmentId: "" },
      { jobId: "test-job", revision: 2, segmentId: "x".repeat(101) },
      { jobId: "test-job", revision: 2, segmentId: "first", all: true },
    ])
      expect(await f.invoke("jobs:removeSegment", raw)).toMatchObject({
        success: false,
        code: "VALIDATION_ERROR",
      });
    expect(mocks.addSegment).not.toHaveBeenCalled();
    expect(mocks.removeSegment).not.toHaveBeenCalled();
    expect(await f.invoke("jobs:addSegment", valid)).toMatchObject({
      success: true,
    });
    expect(mocks.addSegment).toHaveBeenCalledExactlyOnceWith(
      "test-job",
      valid.segment,
      2,
    );
    expect(
      await f.invoke("jobs:removeSegment", {
        jobId: "test-job",
        revision: 3,
        segmentId: "first",
      }),
    ).toMatchObject({ success: true });
    expect(mocks.removeSegment).toHaveBeenCalledExactlyOnceWith(
      "test-job",
      "first",
      3,
    );
  });
});
