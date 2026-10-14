import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import * as yauzl from "yauzl";
import { AppError, checkAbort } from "../../lib/errors";
import type { Artifact } from "./manifest";
import { ArtifactCache, type ArtifactDownloadOptions } from "./artifact-cache";

export async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyArtifact(
  path: string,
  artifact: Artifact,
): Promise<void> {
  const metadata = await stat(path);
  if (
    (artifact.sizeBytes > 0 && metadata.size !== artifact.sizeBytes) ||
    (await sha256(path)) !== artifact.sha256
  ) {
    throw new AppError(
      "INSTALL_INTEGRITY",
      "下载文件校验失败，请重试；原有可用安装已保留。",
    );
  }
}

export async function downloadArtifact(
  artifact: Artifact,
  destination: string,
  signal: AbortSignal,
  progress: (ratio: number) => void,
  options?: ArtifactDownloadOptions,
): Promise<void> {
  const cache = options?.cache ?? new ArtifactCache(dirname(destination), "runtime");
  const asset = options?.asset ?? { id: "model-base" as const, name: "下载文件", artifact };
  await cache.acquire(asset, destination, signal, progress, options?.onPhase);
}

export function archiveDestination(root: string, name: string): string {
  if (!name || /(^[\\/]|:|[\\]|(^|\/)\.\.(\/|$)|\0)/i.test(name))
    throw new AppError("INSTALL_ARCHIVE", "运行包包含不安全路径。");
  const destination = resolve(root, name);
  if (!destination.startsWith(resolve(root) + sep))
    throw new AppError("INSTALL_ARCHIVE", "运行包路径越界。");
  return destination;
}

export async function extractArchive(
  archive: string,
  root: string,
  signal: AbortSignal,
): Promise<void> {
  await mkdir(root, { recursive: true });
  checkAbort(signal);
  return new Promise((resolvePromise, reject) => {
    yauzl.open(
      archive,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(new AppError("INSTALL_ARCHIVE", "无法打开运行包。"));
          return;
        }
        let total = 0;
        const fail = (reason: unknown): void => {
          zip.close();
          signal.removeEventListener("abort", cancel);
          reject(reason);
        };
        const cancel = (): void =>
          fail(new AppError("CANCELLED", "操作已取消"));
        signal.addEventListener("abort", cancel, { once: true });
        zip.on("error", fail);
        zip.on("end", () => {
          signal.removeEventListener("abort", cancel);
          resolvePromise();
        });
        zip.on("entry", (entry: yauzl.Entry) => {
          void (async (): Promise<void> => {
            checkAbort(signal);
            total += entry.uncompressedSize;
            if (
              total > 4_000_000_000 ||
              ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
            )
              throw new AppError(
                "INSTALL_ARCHIVE",
                "运行包大小或文件类型无效。",
              );
            const destination = archiveDestination(root, entry.fileName);
            if (entry.fileName.endsWith("/")) {
              await mkdir(destination, { recursive: true });
              zip.readEntry();
              return;
            }
            await mkdir(dirname(destination), { recursive: true });
            await new Promise<void>((resolveEntry, rejectEntry) => {
              zip.openReadStream(entry, (streamError, stream) => {
                if (streamError || !stream) {
                  rejectEntry(
                    new AppError("INSTALL_ARCHIVE", "无法读取运行包文件。"),
                  );
                  return;
                }
                pipeline(
                  stream,
                  createWriteStream(destination, { flags: "wx" }),
                  { signal },
                ).then(() => resolveEntry(), rejectEntry);
              });
            });
            zip.readEntry();
          })().catch(fail);
        });
        zip.readEntry();
      },
    );
  });
}

export function hasGpuExecution(log: string): boolean {
  return (
    /CUDA\d+\s+(?:total size|compute buffer|buffer size)|CUDA\d+.*(?:model buffer|compute buffer)/i.test(
      log,
    ) && !/CUDA error|no kernel image|failed to initialize/i.test(log)
  );
}
