import { describe, expect, it } from "vitest";
import { runProcess } from "../../../src/main/lib/process";

describe("independent native process lifecycle", () => {
  const executable = process.execPath;
  it("passes literal shell metacharacters as one argument", async () => {
    const literal = "中文 space & $(echo unsafe) ; `whoami`";
    const result = await runProcess(executable, [
      "-e",
      "process.stdout.write(process.argv[1])",
      literal,
    ]);
    expect(result.stdout).toBe(literal);
  });
  it("classifies missing executables without exposing path or native diagnostics", async () => {
    await expect(
      runProcess("missing-slice-check-executable", []),
    ).rejects.toMatchObject({
      code: "PROCESS_START",
    });
  });
  it("classifies a nonzero exit and discards process diagnostics", async () => {
    await expect(
      runProcess(executable, [
        "-e",
        "process.stderr.write('private native text');process.exit(7)",
      ]),
    ).rejects.toMatchObject({
      code: "PROCESS_FAILED",
    });
  });
  it("terminates a running child when cancelled", async () => {
    const controller = new AbortController();
    const pending = runProcess(
      executable,
      ["-e", "process.stderr.write('ready');setInterval(()=>{},1000)"],
      {
        signal: controller.signal,
        onStderr: () => controller.abort(),
      },
    );
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });
  it("terminates and classifies a timed out child", async () => {
    await expect(
      runProcess(executable, ["-e", "setInterval(()=>{},1000)"], {
        timeoutMs: 50,
      }),
    ).rejects.toMatchObject({
      code: "PROCESS_TIMEOUT",
    });
  });
});
