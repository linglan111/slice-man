import { contextBridge, ipcRenderer } from "electron";
import type { AppApi, ProgressEvent, Result } from "../shared/contracts";
import { PROGRESS_CHANNEL, DOWNLOAD_STATUS_CHANNEL } from "../shared/channels";
import { downloadStatusSchema } from "../shared/download-contracts";
import { resultSchema, progressSchema } from "../shared/ipc-validation";
async function invoke<T>(channel: string, input?: unknown): Promise<Result<T>> {
  const result = resultSchema(channel).safeParse(
    await ipcRenderer.invoke(channel, input),
  );
  return result.success
    ? (result.data as Result<T>)
    : {
        success: false,
        error: "应用数据格式无效，请重启或更新应用。",
        code: "IPC_OUTPUT_INVALID",
      };
}
const api: AppApi = {
  diagnostics: {
    list: (input) => invoke("diagnostics:list", input),
    detail: (id) => invoke("diagnostics:detail", id),
    readAnswer: (id) => invoke("diagnostics:readAnswer", id),
    clear: (ids) => invoke("diagnostics:clear", ids),
  },
  chapterCriteria: {
    list: () => invoke("chapterCriteria:list"),
    save: (input) => invoke("chapterCriteria:save", input),
    copy: (input) => invoke("chapterCriteria:copy", input),
    remove: (input) => invoke("chapterCriteria:remove", input),
    select: (input) => invoke("chapterCriteria:select", input),
  },
  chapterExports: {
    export: (input) => invoke("chapterExports:export", input),
    list: (jobId) => invoke("chapterExports:list", jobId),
  },
  exportSettings: {
    status: () => invoke("exportSettings:status"),
    saveSettings: (input) => invoke("exportSettings:saveSettings", input),
    chooseDirectory: () => invoke("exportSettings:chooseDirectory"),
  },
  download: {
    status: () => invoke("download:status"),
    saveSettings: (input) => invoke("download:saveSettings", input),
    chooseDirectory: () => invoke("download:chooseDirectory"),
    install: () => invoke("download:install"),
    importUrl: (input) => invoke("download:importUrl", input),
    cancel: () => invoke("download:cancel"),
    clearDownloadCache: () => invoke("download:clearDownloadCache"),
  },
  onDownloadStatus: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      raw: unknown,
    ): void => {
      const result = downloadStatusSchema.safeParse(raw);
      if (result.success) handler(result.data);
    };
    ipcRenderer.on(DOWNLOAD_STATUS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(DOWNLOAD_STATUS_CHANNEL, listener);
  },
  profiles: {
    list: () => invoke("profiles:list"),
    save: (input) => invoke("profiles:save", input),
    remove: (id) => invoke("profiles:remove", id),
    test: (id, purpose = "text") => invoke("profiles:test", { id, purpose }),
  },
  runtime: {
    status: () => invoke("runtime:status"),
    clearDownloadCache: () => invoke("runtime:clearDownloadCache"),
    install: (input) => invoke("runtime:install", input),
    cancel: () => invoke("runtime:cancel"),
  },
  jobs: {
    list: () => invoke("jobs:list"),
    get: (id) => invoke("jobs:get", id),
    importVideo: (options) => invoke("jobs:importVideo", options),
    planChapters: (input) => invoke("jobs:planChapters", input),
    updateChapters: (input) => invoke("jobs:updateChapters", input),
    planReprocess: (input) => invoke("jobs:planReprocess", input),
    recognizePartial: (input) => invoke("jobs:recognizePartial", input),
    translatePartial: (input) => invoke("jobs:translatePartial", input),
    reviewSubtitles: (input) => invoke("jobs:reviewSubtitles", input),
    analyzeNames: (input) => invoke("jobs:analyzeNames", input),
    applyNames: (input) => invoke("jobs:applyNames", input),
    undoNames: (input) => invoke("jobs:undoNames", input),
    repairLoop: (input) => invoke("jobs:repairLoop", input),
    acknowledgeFinding: (input) => invoke("jobs:acknowledgeFinding", input),
    updateOptions: (input) => invoke("jobs:updateOptions", input),
    recognize: (id) => invoke("jobs:recognize", id),
    recognizeAgain: (input) => invoke("jobs:recognizeAgain", input),
    translate: (input) => invoke("jobs:translate", input),
    editSegment: (input) => invoke("jobs:editSegment", input),
    addSegment: (input) => invoke("jobs:addSegment", input),
    removeSegment: (input) => invoke("jobs:removeSegment", input),
    setStyle: (input) => invoke("jobs:setStyle", input),
    designStyle: (input) => invoke("jobs:designStyle", input),
    preview: (input) => invoke("jobs:preview", input),
    playback: (id) => invoke("jobs:playback", id),
    export: (input) => invoke("jobs:export", input),
    cancel: (id) => invoke("jobs:cancel", id),
  },
  onProgress: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      event: ProgressEvent,
    ): void => {
      const parsed = progressSchema.safeParse(event);
      if (parsed.success) handler(parsed.data);
    };
    ipcRenderer.on(PROGRESS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(PROGRESS_CHANNEL, listener);
  },
};
contextBridge.exposeInMainWorld("api", api);
