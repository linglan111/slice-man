import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { AppError, checkAbort } from "../../../lib/errors";

export function downloadFailure(text: string): AppError {
  if (
    /sign in|login|cookies|private video|age.restricted|members.only/i.test(
      text,
    )
  )
    return new AppError(
      "DOWNLOAD_AUTH",
      "网站要求登录或视频受访问限制；请使用可公开访问的链接，或手动下载后导入。",
    );
  if (/429|too many requests|rate.limit/i.test(text))
    return new AppError(
      "DOWNLOAD_RATE_LIMIT",
      "网站限制下载频率，请稍后重试。",
    );
  if (/unsupported url|not supported/i.test(text))
    return new AppError(
      "DOWNLOAD_UNSUPPORTED",
      "此链接不受当前下载工具支持，请更新工具或手动导入视频。",
    );
  if (/403|forbidden|bot|blocked/i.test(text))
    return new AppError(
      "DOWNLOAD_BLOCKED",
      "网站阻止了当前网络的下载请求，请检查网络、代理或稍后重试。",
    );
  return new AppError(
    "DOWNLOAD_FAILED",
    "下载失败，请检查链接、网络或更新下载工具；未导入未完成的视频。",
  );
}
export function runDownloadProcess(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    signal: AbortSignal;
    onLine: (line: string) => void;
    timeoutMs?: number;
  },
): Promise<void> {
  checkAbort(options.signal);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let hasTimedOut = false;
    let termination: Promise<void> | undefined;
    const kill = (): void => {
      if (termination) return;
      termination = new Promise((done) => {
        if (process.platform === "win32" && child.pid) {
          const killer = spawn(
            "taskkill.exe",
            ["/PID", String(child.pid), "/T", "/F"],
            { shell: false, windowsHide: true, stdio: "ignore" },
          );
          killer.once("error", () => {
            child.kill();
            done();
          });
          killer.once("close", () => done());
        } else {
          child.kill();
          done();
        }
      });
    };
    const timer = setTimeout(
      () => {
        hasTimedOut = true;
        kill();
      },
      options.timeoutMs ?? 6 * 60 * 60_000,
    );
    options.signal.addEventListener("abort", kill, { once: true });
    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", kill);
    };
    child.stderr.on("data", (buffer: Buffer) => {
      stderr = (stderr + buffer.toString()).slice(-16000);
    });
    let parserError: unknown;
    const emitLine = (line: string): void => {
      try {
        options.onLine(line);
      } catch (error) {
        parserError = error;
        kill();
      }
    };
    child.stdout.on("data", (buffer: Buffer) => {
      pending += decoder.write(buffer);
      const lines = pending.split(/\r?\n/);
      pending = (lines.pop() ?? "").slice(-8192);
      for (const line of lines) if (line.length <= 8192) emitLine(line);
    });
    child.once("error", () => {
      cleanup();
      reject(new AppError("PROCESS_START", "无法启动下载工具，请重新安装。"));
    });
    child.once("close", () => {
      void (async (): Promise<void> => {
        cleanup();
        await termination;
        if (parserError)
          throw new AppError("DOWNLOAD_OUTPUT", "下载工具输出格式无效。");
        checkAbort(options.signal);
        if (hasTimedOut)
          throw new AppError(
            "DOWNLOAD_TIMEOUT",
            "下载超时，请检查网络并重试。",
          );
        if (child.exitCode !== 0) throw downloadFailure(stderr);
        pending += decoder.end();
        if (pending) emitLine(pending);
        if (parserError)
          throw new AppError("DOWNLOAD_OUTPUT", "下载工具输出格式无效。");
        resolve();
      })().catch(reject);
    });
    if (options.signal.aborted) kill();
  });
}
