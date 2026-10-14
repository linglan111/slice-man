import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { managedArtifactIdSchema, type ArtifactCacheSummary, type ManagedArtifactId } from "../../../shared/artifact-cache-contracts";
import { AppError, checkAbort } from "../../lib/errors";
import type { Artifact } from "./manifest";
import { verifyArtifact } from "./artifacts";

export type ManagedArtifact = { id: ManagedArtifactId; name: string; artifact: Artifact };
export type ArtifactPhase = "downloading" | "resuming" | "restarting" | "verifying" | "cached";
export type ArtifactDownloadOptions = {
  cache: ArtifactCache;
  asset: ManagedArtifact;
  onPhase?: (phase: ArtifactPhase) => void;
};
const metadataSchema = z.object({
  version: z.literal(1),
  id: managedArtifactIdSchema,
  name: z.string().min(1).max(120),
  url: z.string().max(4096),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive().max(4_000_000_000),
  etag: z.string().max(260).optional(),
  phase: z.enum(["partial", "verified"]),
}).strict();
type Metadata = z.infer<typeof metadataSchema>;
// Shared by all service instances in this process; acquisition and clear never race.
const activeScopes = new Map<string, Set<string>>();
const clearingScopes = new Set<string>();

export function artifactCacheKey(asset: ManagedArtifact): string {
  return createHash("sha256").update(JSON.stringify([
    asset.id, asset.artifact.url, asset.artifact.sha256, asset.artifact.sizeBytes,
  ])).digest("hex");
}
function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function integrity(message: string): AppError {
  return new AppError("INSTALL_INTEGRITY", message);
}
function strongEtag(value: string | null | undefined): string | undefined {
  return value && /^"[\x21\x23-\x7e]{0,256}"$/.test(value) ? value : undefined;
}
async function safeDirectory(path: string, create: boolean): Promise<boolean> {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  if (parent !== absolute && !(await safeDirectory(parent, create))) return false;
  try {
    const info = await lstat(absolute);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new AppError("INSTALL_CACHE_PATH", "下载缓存目录不安全，请检查目录或重新选择应用数据位置。");
    return true;
  } catch (error) {
    if (!isMissing(error)) throw error;
    if (!create) return false;
    await mkdir(absolute).catch((reason: unknown) => {
      if (!(reason instanceof Error && "code" in reason && reason.code === "EEXIST")) throw reason;
    });
    return safeDirectory(absolute, false);
  }
}
async function fileSize(path: string): Promise<number | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      throw new AppError("INSTALL_CACHE_PATH", "下载缓存文件不安全，未访问其内容。");
    return info.size;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}
async function readMetadata(path: string): Promise<Metadata | undefined> {
  const size = await fileSize(path);
  if (size === undefined || size > 8192) return undefined;
  try {
    const parsed = metadataSchema.safeParse(JSON.parse(await readFile(path, "utf8")) as unknown);
    return parsed.success === true ? parsed.data : undefined;
  } catch (error) {
    if (error instanceof SyntaxError || isMissing(error)) return undefined;
    throw error;
  }
}
function matches(asset: ManagedArtifact, metadata: Metadata): boolean {
  return asset.id === metadata.id && asset.artifact.url === metadata.url &&
    asset.artifact.sha256 === metadata.sha256 && asset.artifact.sizeBytes === metadata.sizeBytes;
}
async function pause(signal: AbortSignal, ms: number): Promise<void> {
  checkAbort(signal);
  await new Promise<void>((finish, reject) => {
    const cancel = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reject(new AppError("CANCELLED", "操作已取消，已下载数据保留，可继续安装。"));
    };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); finish(); }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export class ArtifactCache {
  readonly directory: string;
  constructor(root: string, scope: "runtime" | "download") {
    this.directory = resolve(root, "managed-artifact-cache", scope);
  }
  private paths(asset: ManagedArtifact): { part: string; metadata: string; key: string } {
    const key = artifactCacheKey(asset);
    return { key, part: join(this.directory, key + ".part"), metadata: join(this.directory, key + ".json") };
  }
  private async writeMetadata(path: string, metadata: Metadata): Promise<void> {
    await safeDirectory(this.directory, true);
    await fileSize(path);
    const temporary = path + ".tmp-" + randomUUID();
    const handle = await open(temporary, "wx");
    try {
      try {
        await handle.writeFile(JSON.stringify(metadata));
        await handle.sync();
      } finally { await handle.close(); }
      await rename(temporary, path);
    }
    finally { await rm(temporary, { force: true }); }
  }
  private async reset(asset: ManagedArtifact): Promise<void> {
    const paths = this.paths(asset);
    await safeDirectory(this.directory, true);
    // Never follow links, delete directories, or accept a path from sidecar data.
    await fileSize(paths.part);
    await fileSize(paths.metadata);
    await rm(paths.part, { force: true });
    await rm(paths.metadata, { force: true });
  }
  async summary(assets: ManagedArtifact[]): Promise<ArtifactCacheSummary> {
    if (!(await safeDirectory(this.directory, false))) return { assets: [], totalBytes: 0 };
    const cached: ArtifactCacheSummary["assets"] = [];
    for (const asset of assets) {
      const paths = this.paths(asset);
      const metadata = await readMetadata(paths.metadata);
      if (!metadata || !matches(asset, metadata)) continue;
      const size = await fileSize(paths.part);
      if (!size || size > asset.artifact.sizeBytes) continue;
      cached.push({ id: asset.id, name: asset.name, downloadedBytes: size,
        totalBytes: asset.artifact.sizeBytes, state: metadata.phase === "verified" && size === asset.artifact.sizeBytes ? "verified" : "partial",
        resumable: true });
    }
    return { assets: cached, totalBytes: cached.reduce((sum, entry) => sum + entry.downloadedBytes, 0) };
  }
  async clear(): Promise<void> {
    if (clearingScopes.has(this.directory) || activeScopes.get(this.directory)?.size)
      throw new AppError("INSTALL_BUSY", "下载或安装正在进行，请暂停并等待结束后清除缓存。");
    clearingScopes.add(this.directory);
    try {
      if (!(await safeDirectory(this.directory, false))) return;
      for (const name of await readdir(this.directory)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        const path = join(this.directory, name);
        const metadata = await readMetadata(path);
        if (!metadata || artifactCacheKey({ id: metadata.id, name: metadata.name, artifact: metadata }) + ".json" !== name) continue;
        const isRuntime = metadata.id.startsWith("model-") || metadata.id.startsWith("whisper-");
        if ((this.directory.endsWith("runtime")) !== isRuntime) continue;
        await this.reset({ id: metadata.id, name: metadata.name, artifact: metadata });
      }
      // Unrelated files, unknown/corrupted entries and installed assets are left alone.
    } finally { clearingScopes.delete(this.directory); }
  }
  async acquire(asset: ManagedArtifact, destination: string, signal: AbortSignal,
    progress: (ratio: number) => void, onPhase?: (phase: ArtifactPhase) => void): Promise<void> {
    checkAbort(signal);
    metadataSchema.parse({ version: 1, ...asset.artifact, id: asset.id, name: asset.name, phase: "partial" });
    const url = new URL(asset.artifact.url);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw new AppError("INSTALL_NETWORK", "运行包下载地址无效。");
    const paths = this.paths(asset);
    const locks = activeScopes.get(this.directory) ?? new Set<string>();
    if (clearingScopes.has(this.directory) || locks.has(paths.key))
      throw new AppError("INSTALL_BUSY", "该工具下载已在进行，请等待完成。");
    locks.add(paths.key); activeScopes.set(this.directory, locks);
    try {
      await safeDirectory(this.directory, true);
      let metadata = await readMetadata(paths.metadata);
      let bytes = await fileSize(paths.part) ?? 0;
      if (!metadata || !matches(asset, metadata) || bytes > asset.artifact.sizeBytes) {
        await this.reset(asset); metadata = undefined; bytes = 0;
      }
      if (bytes === asset.artifact.sizeBytes) {
        onPhase?.("verifying");
        try { await verifyArtifact(paths.part, asset.artifact); }
        catch (error) { await this.reset(asset); throw error; }
      } else {
        let resetAfter416 = false;
        let hasVerified = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          checkAbort(signal);
          bytes = await fileSize(paths.part) ?? 0;
          const headers: Record<string, string> = { "Accept-Encoding": "identity" };
          if (bytes > 0) {
            headers.Range = `bytes=${bytes}-`;
            const validator = strongEtag(metadata?.etag);
            if (validator) headers["If-Range"] = validator;
          }
          onPhase?.(bytes > 0 ? "resuming" : "downloading");
          progress(Math.min(0.99, bytes / asset.artifact.sizeBytes));
          let response: Response | undefined;
          try {
            response = await fetch(asset.artifact.url, { headers,
              signal: AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]) });
            if (response.status === 416) {
              await response.body?.cancel();
              if (resetAfter416 || bytes === 0) throw integrity("服务器返回了无效下载范围，请重试。");
              resetAfter416 = true;
              await this.reset(asset); metadata = undefined;
              onPhase?.("restarting");
              continue;
            }
            if (![200, 206].includes(response.status) || !response.body)
              throw new AppError("INSTALL_NETWORK", `下载失败（HTTP ${response.status}），已有数据保留。`);
            const encoding = response.headers.get("content-encoding");
            if (encoding && encoding.toLowerCase() !== "identity") throw integrity("运行包使用了不支持的压缩传输，未合并下载数据。");
            let expectedBody = asset.artifact.sizeBytes;
            if (response.status === 206) {
              const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
              const start = Number(range?.[1]); const end = Number(range?.[2]); const total = Number(range?.[3]);
              if (!range || start !== bytes || total !== asset.artifact.sizeBytes || !Number.isSafeInteger(end) || end < start || end >= total)
                throw integrity("服务器返回的下载范围与已保存数据不一致，未合并文件。");
              expectedBody = end - start + 1;
              const oldTag = strongEtag(metadata?.etag); const newTag = strongEtag(response.headers.get("etag"));
              if (oldTag && newTag && oldTag !== newTag) throw integrity("运行包下载实体已改变，已清除该文件缓存，请重试。");
            } else if (bytes > 0) {
              onPhase?.("restarting");
              await this.reset(asset); bytes = 0;
            }
            const length = response.headers.get("content-length");
            if (length !== null && (!/^\d+$/.test(length) || Number(length) !== expectedBody))
              throw integrity("运行包响应长度与预期范围不一致。");
            metadata = { version: 1, id: asset.id, name: asset.name, ...asset.artifact,
              phase: "partial", etag: strongEtag(response.headers.get("etag")) };
            await this.writeMetadata(paths.metadata, metadata);
            await fileSize(paths.part);
            const handle = await open(paths.part, bytes > 0 ? "a" : "w");
            let received = 0;
            const reader = response.body.getReader();
            try {
              while (true) {
                checkAbort(signal);
                const next = await reader.read();
                if (next.done) break;
                if (received + next.value.length > expectedBody || bytes + next.value.length > asset.artifact.sizeBytes)
                  throw integrity("下载文件超过预期大小。");
                let written = 0;
                while (written < next.value.length) {
                  const result = await handle.write(next.value, written, next.value.length - written);
                  if (!result.bytesWritten) throw new AppError("INSTALL_CACHE_WRITE", "下载缓存无法写入，请检查磁盘空间。");
                  written += result.bytesWritten;
                }
                received += next.value.length; bytes += next.value.length;
                progress(Math.min(0.99, bytes / asset.artifact.sizeBytes));
              }
            } finally {
              try { await reader.cancel(); }
              finally { try { await handle.sync(); } finally { await handle.close(); } }
            }
            checkAbort(signal);
            if (received !== expectedBody || bytes !== asset.artifact.sizeBytes)
              throw new AppError("INSTALL_NETWORK", "下载连接提前结束，已保留下载进度。请继续安装。");
            onPhase?.("verifying");
            await verifyArtifact(paths.part, asset.artifact);
            hasVerified = true;
            break;
          } catch (error) {
            if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
            if (error instanceof AppError && error.code === "INSTALL_INTEGRITY") { await this.reset(asset); throw error; }
            checkAbort(signal);
            if (error instanceof AppError && error.code === "INSTALL_CACHE_WRITE") throw error;
            if (error instanceof Error && "code" in error && ["ENOSPC", "EDQUOT", "EACCES", "EPERM", "EROFS"].includes(String(error.code)))
              throw new AppError("INSTALL_CACHE_WRITE", "下载缓存无法写入，请检查磁盘空间和目录权限；已有下载数据保留。");
            if (attempt === 2) throw new AppError("INSTALL_NETWORK", "下载失败，已有数据保留；检查网络后可继续安装。");
            await pause(signal, 300 * (attempt + 1));
          }
        }
        // A final416 cannot accidentally fall through to install an incomplete body.
        if (!hasVerified) throw new AppError("INSTALL_NETWORK", "下载范围已重置，请继续安装以获取完整文件。");
      }
      checkAbort(signal);
      await this.writeMetadata(paths.metadata, { version: 1, ...asset.artifact, id: asset.id, name: asset.name,
        phase: "verified", etag: metadata?.etag });
      onPhase?.("cached");
      await mkdir(dirname(destination), { recursive: true });
      // Exclusive staging copy; never consume the cache or hard-link mutable executables.
      await fileSize(paths.part);
      const input = await open(paths.part, "r");
      let output: Awaited<ReturnType<typeof open>> | undefined;
      try {
        output = await open(destination, "wx");
        const buffer = Buffer.alloc(1024 * 1024);
        while (true) {
          checkAbort(signal);
          const next = await input.read(buffer);
          if (!next.bytesRead) break;
          let offset = 0;
          while (offset < next.bytesRead) {
            const result = await output.write(buffer, offset, next.bytesRead - offset);
            if (!result.bytesWritten) throw new AppError("INSTALL_CACHE_WRITE", "安装文件无法写入，请检查磁盘空间。");
            offset += result.bytesWritten;
          }
        }
        checkAbort(signal);
      } catch (error) {
        if (output) { await output.close(); await rm(destination, { force: true }); }
        throw error;
      } finally { try { await output?.close(); } finally { await input.close(); } }
      checkAbort(signal);
      progress(1);
    } catch (error) {
      if (error instanceof Error && "code" in error && ["ENOSPC", "EDQUOT", "EACCES", "EPERM", "EROFS"].includes(String(error.code)))
        throw new AppError("INSTALL_CACHE_WRITE", "下载缓存或安装副本无法写入，请检查磁盘空间和目录权限；已有下载数据保留。");
      throw error;
    } finally {
      locks.delete(paths.key);
      if (!locks.size) activeScopes.delete(this.directory);
    }
  }
}
