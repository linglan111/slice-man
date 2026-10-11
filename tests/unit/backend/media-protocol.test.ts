import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as files from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseMediaRange,
  serveMediaRequest,
} from "../../../src/main/lib/media-protocol";
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof files>();
  return { ...actual, open: vi.fn(actual.open) };
});

describe("single byte range parser", () => {
  it.each([
    [null, "full"],
    ["bytes=0-3", { start: 0, end: 3 }],
    ["bytes=5-", { start: 5, end: 9 }],
    ["bytes=-3", { start: 7, end: 9 }],
    ["bytes=-999999999999999999999999999", { start: 0, end: 9 }],
    ["bytes=0-999999999999999999999999999", { start: 0, end: 9 }],
    ["bytes=999999999999999999999999999-", "unsatisfiable"],
    ["bytes=0-0", { start: 0, end: 0 }],
    ["bytes=10-11", "unsatisfiable"],
    ["bytes=5-3", "unsatisfiable"],
    ["bytes=-0", "unsatisfiable"],
    ["bytes=-", "unsatisfiable"],
    ["bytes=nope", "unsatisfiable"],
    ["bytes=1.5-4", "unsatisfiable"],
    ["bytes=+1-4", "unsatisfiable"],
    ["items=0-1", "full"],
    ["bytes=0-1,4-5", "full"],
    [" Bytes=0-3 ", { start: 0, end: 3 }],
    ["not-a-range", "unsatisfiable"],
  ])("parses %s with exact integer boundaries", (header, expected) => {
    expect(parseMediaRange(header as string | null, 10)).toEqual(expected);
  });
  it("bounds enormous headers and rejects every byte range for an empty file", () => {
    expect(parseMediaRange(`bytes=${"9".repeat(5000)}-`, 10)).toBe(
      "unsatisfiable",
    );
    expect(parseMediaRange("bytes=0-", 0)).toBe("unsatisfiable");
  });
});

describe("registered-token streaming media handler", () => {
  let root: string;
  let path: string;
  let paths: Map<string, string>;
  const url = "app-media://local/opaque-token";
  const handles: files.FileHandle[] = [];
  beforeEach(async () => {
    root = await files.mkdtemp(join(tmpdir(), "slice-stream-中文 space-"));
    path = join(root, "media.mp4");
    await files.writeFile(
      path,
      Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
    );
    paths = new Map([["opaque-token", path]]);
    const realOpen = (await vi.importActual<typeof files>("node:fs/promises"))
      .open;
    vi.mocked(files.open)
      .mockClear()
      .mockImplementation(async (...args) => {
        const handle = await realOpen(...args);
        handles.push(handle);
        vi.spyOn(handle, "close");
        vi.spyOn(handle, "read");
        return handle;
      });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const handle of handles.splice(0)) await handle.close();
    await files.rm(root, { recursive: true, force: true });
  });
  async function response(
    range?: string,
    method = "GET",
    signal?: AbortSignal,
  ): Promise<Response> {
    return serveMediaRequest(
      new Request(url, {
        method,
        signal,
        headers: range ? { Range: range } : {},
      }),
      paths,
    );
  }
  it("returns exact 206 byte payload and complete browser range metadata", async () => {
    const result = await response("bytes=100-103");
    expect(result.status).toBe(206);
    expect(result.headers.get("Content-Range")).toBe("bytes 100-103/256");
    expect(result.headers.get("Content-Length")).toBe("4");
    expect(result.headers.get("Accept-Ranges")).toBe("bytes");
    expect(result.headers.get("Content-Type")).toBe("video/mp4");
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([
      100, 101, 102, 103,
    ]);
    expect(handles[0]?.close).toHaveBeenCalledTimes(1);
  });
  it("handles suffix/open-ended requests and clips the end at actual EOF", async () => {
    for (const range of [
      "bytes=-2",
      "bytes=254-",
      "bytes=254-999999999999999999999999",
    ]) {
      const result = await response(range);
      expect(result.status).toBe(206);
      expect(result.headers.get("Content-Range")).toBe("bytes 254-255/256");
      expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([
        254, 255,
      ]);
    }
  });
  it("returns 416 with unsatisfied Content-Range and no body for bad/out-of-file ranges", async () => {
    for (const range of [
      "bytes=256-",
      "bytes=5-1",
      "bytes=-0",
      "bytes=abc",
      `bytes=${"9".repeat(5000)}-`,
    ]) {
      const result = await response(range);
      expect(result.status).toBe(416);
      expect(result.headers.get("Content-Range")).toBe("bytes */256");
      expect(result.headers.get("Content-Length")).toBe("0");
      expect(await result.text()).toBe("");
    }
  });
  it("returns full 200 for unknown units and unsupported multiple ranges", async () => {
    for (const range of ["items=1-2", "bytes=0-1,4-5"]) {
      const result = await response(range);
      expect(result.status).toBe(200);
      expect(result.headers.get("Content-Length")).toBe("256");
      expect(result.headers.has("Content-Range")).toBe(false);
      expect((await result.arrayBuffer()).byteLength).toBe(256);
    }
  });
  it("HEAD ignores Range and closes without reading bytes", async () => {
    const result = await response("bytes=100-103", "HEAD");
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Length")).toBe("256");
    expect(result.headers.get("Content-Range")).toBeNull();
    expect(result.body).toBeNull();
    expect(handles[0]?.read).not.toHaveBeenCalled();
    expect(handles[0]?.close).toHaveBeenCalledTimes(1);
  });
  it("ignores Range when If-Range does not match the representation", async () => {
    const result = await serveMediaRequest(
      new Request(url, {
        headers: { Range: "bytes=10-19", "If-Range": "not-a-validator" },
      }),
      paths,
    );
    expect(result.status).toBe(200);
    await result.body?.cancel();
  });
  it("preserves PNG/JPEG reference-image types and binary fallback", async () => {
    for (const [extension, mime] of [
      ["png", "image/png"],
      ["JPG", "image/jpeg"],
      ["unknown", "application/octet-stream"],
    ]) {
      const image = join(root, `reference.${extension}`);
      await files.writeFile(image, "image");
      paths.set("image-token", image);
      const result = await serveMediaRequest(
        new Request("app-media://local/image-token"),
        paths,
      );
      expect(result.headers.get("Content-Type")).toBe(mime);
      expect(await result.text()).toBe("image");
    }
  });
  it("never opens paths supplied through unknown tokens/hosts/URL components", async () => {
    for (const rejected of [
      "app-media://local/unknown",
      "app-media://evil/opaque-token",
      "app-media://local/%2e%2e/private",
      "app-media://local/opaque-token?path=private",
      "app-media://local/opaque-token#private",
      "app-media://local:8080/opaque-token",
    ]) {
      expect(
        (await serveMediaRequest(new Request(rejected), paths)).status,
      ).toBe(404);
    }
    expect(() => new Request("app-media://user@local/opaque-token")).toThrow();
    expect(files.open).not.toHaveBeenCalled();
  });
  it("rejects unsupported methods without opening the file", async () => {
    const result = await response(undefined, "POST");
    expect(result.status).toBe(405);
    expect(result.headers.get("Allow")).toBe("GET, HEAD");
    expect(files.open).not.toHaveBeenCalled();
  });
  it("maps missing files to a safe 404 and keeps HEAD errors bodyless", async () => {
    await files.rm(path);
    const result = await response();
    expect(result.status).toBe(404);
    expect(await result.text()).not.toContain(path);
    const head = await response(undefined, "HEAD");
    expect(head.status).toBe(404);
    expect(head.body).toBeNull();
  });
  it("serves empty files without creating a body stream", async () => {
    await files.writeFile(path, "");
    const result = await response();
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Length")).toBe("0");
    expect(result.body).toBeNull();
    expect((await response("bytes=0-")).status).toBe(416);
  });
  it("does not eagerly read the file and stops bounded reads on consumer cancellation", async () => {
    await files.truncate(path, 8 * 1024 * 1024);
    const result = await response();
    const handle = handles[0];
    if (!handle) throw new Error("No file handle");
    expect(handle.read).not.toHaveBeenCalled();
    const reader = result.body?.getReader();
    if (!reader) throw new Error("No response stream");
    const first = await reader.read();
    expect(first.value?.byteLength).toBe(65536);
    await reader.cancel();
    expect(handle.read).toHaveBeenCalledTimes(1);
    expect(handle.close).toHaveBeenCalledTimes(1);
  });
  it("aborts an unread response and closes its descriptor exactly once", async () => {
    const abort = new AbortController();
    const result = await response(undefined, "GET", abort.signal);
    const reader = result.body?.getReader();
    if (!reader) throw new Error("No response stream");
    abort.abort();
    await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
    expect(handles[0]?.read).not.toHaveBeenCalled();
    expect(handles[0]?.close).toHaveBeenCalledTimes(1);
  });
  it("closes an already aborted request without reading media", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(response(undefined, "GET", abort.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(handles[0]?.read).not.toHaveBeenCalled();
    expect(handles[0]?.close).toHaveBeenCalledTimes(1);
  });
  it("stops a partially consumed response on request abort", async () => {
    await files.truncate(path, 8 * 1024 * 1024);
    const abort = new AbortController();
    const result = await response(undefined, "GET", abort.signal);
    const reader = result.body?.getReader();
    if (!reader) throw new Error("No response stream");
    expect((await reader.read()).value?.byteLength).toBe(65536);
    abort.abort();
    await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
    expect(handles[0]?.read).toHaveBeenCalledTimes(1);
    expect(handles[0]?.close).toHaveBeenCalledTimes(1);
  });
  it("fails safely and closes if media is truncated during a response", async () => {
    await files.truncate(path, 8 * 1024 * 1024);
    const result = await response();
    const reader = result.body?.getReader();
    if (!reader) throw new Error("No response stream");
    expect((await reader.read()).value?.byteLength).toBe(65536);
    await files.truncate(path, 0);
    await expect(reader.read()).rejects.toThrow("Unable to read media");
    // Stream failure is observable before its asynchronous descriptor cleanup.
    await vi.waitFor(() => expect(handles[0]?.close).toHaveBeenCalledTimes(1));
  });
});
