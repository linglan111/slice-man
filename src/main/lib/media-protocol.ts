import * as files from "node:fs/promises";
import { extname } from "node:path";

type ByteRange = { start: number; end: number };
type ParsedRange = ByteRange | "full" | "unsatisfiable";
const CHUNK_BYTES = 64 * 1024;
const MAX_RANGE_HEADER = 4096;

/** Only one bytes range is supported. Unknown units/multipart are ignored. */
export function parseMediaRange(
  header: string | null,
  size: number,
): ParsedRange {
  if (header === null) return "full";
  if (header.length > MAX_RANGE_HEADER) return "unsatisfiable";
  const unit = /^([^=\s]+)=(.*)$/.exec(header.trim());
  if (!unit?.[1] || unit[2] === undefined) return "unsatisfiable";
  if (unit[1].toLowerCase() !== "bytes") return "full";
  if (unit[2].includes(",")) return "full";
  const match = /^(\d*)-(\d*)$/.exec(unit[2].trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return "unsatisfiable";
  const length = BigInt(size);
  if (!match[1]) {
    const suffix = BigInt(match[2] ?? "0");
    if (suffix === 0n) return "unsatisfiable";
    return {
      start: Number(suffix >= length ? 0n : length - suffix),
      end: size - 1,
    };
  }
  const start = BigInt(match[1]);
  const requestedEnd = match[2] ? BigInt(match[2]) : length - 1n;
  if (start >= length || requestedEnd < start) return "unsatisfiable";
  return {
    start: Number(start),
    end: Number(requestedEnd >= length ? length - 1n : requestedEnd),
  };
}

function contentType(path: string): string {
  const types: Record<string, string> = {
    ".mp4": "video/mp4",
    ".m4v": "video/x-m4v",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
  };
  return types[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** Serve only registered opaque tokens; URLs never supply filesystem paths. */
export async function serveMediaRequest(
  request: Request,
  paths: ReadonlyMap<string, string>,
): Promise<Response> {
  const isHead = request.method === "HEAD";
  const url = new URL(request.url);
  const token = /^\/[a-zA-Z0-9-]{1,100}$/.test(url.pathname)
    ? url.pathname.slice(1)
    : undefined;
  const path =
    url.protocol === "app-media:" &&
    url.host === "local" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    token
      ? paths.get(token)
      : undefined;
  if (!path) return new Response(isHead ? null : "Not found", { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  let file: files.FileHandle;
  try {
    file = await files.open(path, "r");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    return new Response(isHead ? null : "Media unavailable", {
      status:
        code === "ENOENT"
          ? 404
          : code === "EACCES" || code === "EPERM"
            ? 403
            : 500,
    });
  }
  let closed: Promise<void> | undefined;
  const close = (): Promise<void> => {
    request.signal.removeEventListener("abort", abort);
    return (closed ??= file.close());
  };
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let isCancelled = false;
  const abort = (): void => {
    isCancelled = true;
    const error = new DOMException("Media request aborted", "AbortError");
    void close().then(
      () => controller?.error(error),
      () => controller?.error(error),
    );
  };
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || !Number.isSafeInteger(metadata.size)) {
      await close();
      return new Response(isHead ? null : "Media unavailable", { status: 404 });
    }
    if (request.signal.aborted) {
      await close();
      throw new DOMException("Media request aborted", "AbortError");
    }
    const modified = metadata.mtime.toUTCString();
    // Range is GET-only. A mismatched If-Range validator also requests the full representation.
    const range =
      isHead ||
      (request.headers.has("if-range") &&
        request.headers.get("if-range") !== modified)
        ? "full"
        : parseMediaRange(request.headers.get("range"), metadata.size);
    const headers = new Headers({
      "Content-Type": contentType(path),
      "Accept-Ranges": "bytes",
      "Last-Modified": modified,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (range === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${metadata.size}`);
      headers.set("Content-Length", "0");
      await close();
      return new Response(null, { status: 416, headers });
    }
    const start = range === "full" ? 0 : range.start;
    const end = range === "full" ? metadata.size - 1 : range.end;
    headers.set("Content-Length", String(Math.max(0, end - start + 1)));
    if (range !== "full")
      headers.set("Content-Range", `bytes ${start}-${end}/${metadata.size}`);
    const status = range === "full" ? 200 : 206;
    if (isHead || metadata.size === 0) {
      await close();
      return new Response(null, { status, headers });
    }
    let position = start;
    const body = new ReadableStream<Uint8Array>(
      {
        start(streamController): void {
          controller = streamController;
        },
        async pull(streamController): Promise<void> {
          try {
            if (isCancelled) return;
            const data = new Uint8Array(
              Math.min(CHUNK_BYTES, end - position + 1),
            );
            const { bytesRead } = await file.read(
              data,
              0,
              data.length,
              position,
            );
            if (isCancelled) return;
            if (bytesRead === 0) throw new Error("Media changed during read");
            position += bytesRead;
            streamController.enqueue(data.subarray(0, bytesRead));
            if (position > end) {
              streamController.close();
              await close();
            }
          } catch {
            if (!isCancelled)
              streamController.error(new Error("Unable to read media"));
            await close();
          }
        },
        async cancel(): Promise<void> {
          isCancelled = true;
          await close();
        },
      },
      { highWaterMark: 0 },
    );
    request.signal.addEventListener("abort", abort, { once: true });
    return new Response(body, { status, headers });
  } catch (error) {
    await close();
    throw error;
  }
}
