import { describe, it, expect } from "vitest";
import { runProcess } from "../../../src/main/lib/process";
import {
  resultSchema,
  progressSchema,
} from "../../../src/shared/ipc-validation";
import { IPC_CHANNELS } from "../../../src/shared/channels";
describe("native process lifecycle", () => {
  it("uses argument arrays preserving Unicode spaces and shell metacharacters", async () => {
    const result = await runProcess(process.execPath, [
      "-e",
      "process.stdout.write(process.argv[1])",
      "中文 space & literal",
    ]);
    expect(result.stdout).toBe("中文 space & literal");
  });
  it("reports startup failures and bounded native timeout", async () => {
    await expect(
      runProcess("missing-executable-slice-1234", []),
    ).rejects.toMatchObject({ code: "PROCESS_START" });
    await expect(
      runProcess(process.execPath, ["-e", "setTimeout(()=>{},10000)"], {
        timeoutMs: 30,
      }),
    ).rejects.toMatchObject({ code: "PROCESS_TIMEOUT" });
  });
  it("kills a running native child when cancelled", async () => {
    const c = new AbortController();
    const pending = runProcess(
      process.execPath,
      ["-e", "setTimeout(()=>{},10000)"],
      { signal: c.signal },
    );
    c.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
describe("IPC output validation", () => {
  it("covers every exposed channel and rejects key-bearing ordinary profile responses", () => {
    for (const [domain, methods] of Object.entries(IPC_CHANNELS))
      for (const method of methods)
        expect(() => resultSchema(`${domain}:${method}`)).not.toThrow();
    expect(
      resultSchema("profiles:list").safeParse({
        success: true,
        data: [{ id: "p", apiKey: "secret" }],
      }).success,
    ).toBe(false);
    expect(() => resultSchema("arbitrary:command")).toThrow();
  });
  it("validates structured failures and rejects malformed progress", () => {
    expect(
      resultSchema("jobs:get").safeParse({
        success: false,
        error: "failed",
        code: "NOT_FOUND",
      }).success,
    ).toBe(true);
    expect(
      resultSchema("jobs:get").safeParse({
        success: false,
        error: "failed",
        stack: "private",
      }).success,
    ).toBe(false);
    expect(
      progressSchema.safeParse({
        stage: "export",
        progress: 3,
        message: "wrong",
      }).success,
    ).toBe(false);
    expect(
      progressSchema.safeParse({
        stage: "install",
        progress: 0.5,
        message: "downloading",
      }).success,
    ).toBe(true);
  });
});
