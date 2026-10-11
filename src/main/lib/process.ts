import { spawn } from "node:child_process";
import { AppError, checkAbort } from "./errors";
export function runProcess(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    signal?: AbortSignal;
    onStderr?: (text: string) => void;
    timeoutMs?: number;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  checkAbort(options.signal);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let isFinished = false;
    let isTimedOut = false;
    const cancel = (): void => {
      child.kill();
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      isTimedOut = true;
      child.kill();
    }, options.timeoutMs ?? 3600000);
    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    };
    child.stdout.on("data", (data: Buffer) => {
      if (stdout.length < 32_000_000) stdout += data.toString();
      else child.kill();
    });
    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr = (stderr + text).slice(-200000);
      options.onStderr?.(text);
    });
    child.once("error", () => {
      if (isFinished) return;
      isFinished = true;
      cleanup();
      reject(
        new AppError("PROCESS_START", "无法启动本地程序，请检查安装是否完整。"),
      );
    });
    child.once("close", (code) => {
      if (isFinished) return;
      isFinished = true;
      cleanup();
      if (options.signal?.aborted)
        reject(new AppError("CANCELLED", "操作已取消"));
      else if (isTimedOut)
        reject(new AppError("PROCESS_TIMEOUT", "本地程序运行超时"));
      else if (code !== 0)
        reject(
          new AppError(
            "PROCESS_FAILED",
            "本地程序失败，请检查输入文件或运行环境。",
          ),
        );
      else resolve({ stdout, stderr });
    });
  });
}
