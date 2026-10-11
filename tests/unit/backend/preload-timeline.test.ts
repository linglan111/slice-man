import { describe, expect, it, vi } from "vitest";
import type { AppApi } from "../../../src/shared/contracts";
const bridge = vi.hoisted(() => ({
  api: undefined as AppApi | undefined,
  invoke: vi.fn(),
}));
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: AppApi) => {
      bridge.api = api;
    },
  },
  ipcRenderer: { invoke: bridge.invoke, on: vi.fn(), removeListener: vi.fn() },
}));
import "../../../src/preload/index";

describe("manual timeline preload", () => {
  it("validates independent export settings responses and preserves picker cancellation", async () => {
    const api = bridge.api;
    if (!api) throw new Error("Missing bridge");
    bridge.invoke.mockResolvedValue({
      success: true,
      data: { directory: "F:/isolated" },
    });
    expect(await api.exportSettings.status()).toMatchObject({
      success: false,
      code: "IPC_OUTPUT_INVALID",
    });
    expect(bridge.invoke).toHaveBeenLastCalledWith(
      "exportSettings:status",
      undefined,
    );
    bridge.invoke.mockResolvedValue({ success: true, data: null });
    expect(await api.exportSettings.chooseDirectory()).toEqual({
      success: true,
      data: null,
    });
    expect(bridge.invoke).toHaveBeenLastCalledWith(
      "exportSettings:chooseDirectory",
      undefined,
    );
  });
  it("routes narrow requests and rejects malformed successful job output", async () => {
    const api = bridge.api;
    if (!api) throw new Error("Missing context bridge API");
    bridge.invoke.mockResolvedValue({
      success: true,
      data: { id: "incomplete" },
    });
    const input = {
      jobId: "job",
      revision: 3,
      segment: { startMs: 0, endMs: 1, sourceText: "manual" },
    };
    expect(await api.jobs.addSegment(input)).toMatchObject({
      success: false,
      code: "IPC_OUTPUT_INVALID",
    });
    expect(bridge.invoke).toHaveBeenLastCalledWith("jobs:addSegment", input);
    const remove = { jobId: "job", revision: 3, segmentId: "first" };
    expect(await api.jobs.removeSegment(remove)).toMatchObject({
      success: false,
      code: "IPC_OUTPUT_INVALID",
    });
    expect(bridge.invoke).toHaveBeenLastCalledWith(
      "jobs:removeSegment",
      remove,
    );
  });
  it("preserves structured stale failures rather than presenting a successful change", async () => {
    const api = bridge.api;
    if (!api) throw new Error("Missing context bridge API");
    const failure = {
      success: false,
      code: "STALE_REVISION",
      error: "Refresh the current job.",
    };
    bridge.invoke.mockResolvedValue(failure);
    expect(
      await api.jobs.removeSegment({
        jobId: "job",
        revision: 0,
        segmentId: "first",
      }),
    ).toEqual(failure);
  });
});
