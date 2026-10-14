import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, link } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArtifactCache, artifactCacheKey, type ManagedArtifact } from "../../../src/main/services/runtime/artifact-cache";
import { downloadArtifact } from "../../../src/main/services/runtime/artifacts";
import { managedArtifactIdSchema } from "../../../src/shared/artifact-cache-contracts";

const roots: string[] = [];
const servers: Server[] = [];
const content = Buffer.from(Array.from({ length: 131072 }, (_, i) => i % 251));
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((finish) => {
    server.closeAllConnections(); server.close(() => finish());
  });
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(handler: (request: IncomingMessage, response: ServerResponse, count: number) => void): Promise<{
  root: string; asset: ManagedArtifact; cache: ArtifactCache; requests: { range?: string; validator?: string; encoding?: string }[];
}> {
  const root = await mkdtemp(join(tmpdir(), "slice-resume-")); roots.push(root);
  const requests: { range?: string; validator?: string; encoding?: string }[] = [];
  const server = createServer((request, response) => {
    requests.push({ range: request.headers.range, validator: request.headers["if-range"] as string | undefined, encoding: request.headers["accept-encoding"] });
    handler(request, response, requests.length);
  });
  servers.push(server);
  await new Promise<void>((finish) => server.listen(0, "127.0.0.1", finish));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No address");
  const asset: ManagedArtifact = { id: "model-base", name: "fixture", artifact: {
    url: `http://127.0.0.1:${address.port}/asset`, sha256: createHash("sha256").update(content).digest("hex"), sizeBytes: content.length,
  } };
  return { root, asset, cache: new ArtifactCache(root, "runtime"), requests };
}
function sendRange(request: IncomingMessage, response: ServerResponse): void {
  const offset = Number(request.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0);
  response.writeHead(offset ? 206 : 200, {
    "content-length": content.length - offset, etag: '"fixture-v1"',
    ...(offset ? { "content-range": `bytes ${offset}-${content.length - 1}/${content.length}` } : {}),
  });
  response.end(content.subarray(offset));
}
async function retainPrefix(f: Awaited<ReturnType<typeof fixture>>, asset = f.asset, scope: "runtime" | "download" = "runtime"): Promise<number> {
  const cache = new ArtifactCache(f.root, scope);
  const controller = new AbortController();
  await expect(cache.acquire(asset, join(f.root, "aborted-stage"), controller.signal, (ratio) => {
    if (ratio > 0) controller.abort();
  })).rejects.toMatchObject({ code: "CANCELLED" });
  const summary = await cache.summary([asset]);
  expect(summary.totalBytes).toBeGreaterThan(0);
  expect(summary.totalBytes).toBeLessThan(content.length);
  await expect(readFile(join(f.root, "aborted-stage"))).rejects.toMatchObject({ code: "ENOENT" });
  return summary.totalBytes;
}
function prefixResponse(_request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, { "content-length": content.length, etag: '"fixture-v1"' });
  response.write(content.subarray(0, 8192));
}
describe("durable pinned artifact downloads", () => {
  it.each(managedArtifactIdSchema.options)("resumes %s after cancellation and service restart at actual byte offset", async (id) => {
    const f = await fixture((req, res, count) => count === 1 ? prefixResponse(req, res) : sendRange(req, res));
    const asset = { ...f.asset, id }; const scope = id === "yt-dlp" || id === "deno" ? "download" : "runtime";
    const bytes = await retainPrefix(f, asset, scope);
    const restored = new ArtifactCache(f.root, scope);
    expect((await restored.summary([asset])).assets[0]?.state).toBe("partial");
    await restored.acquire(asset, join(f.root, "resumed"), new AbortController().signal, () => {});
    expect(f.requests.map(({ range, validator }) => ({ range, validator }))).toEqual([
      { range: undefined, validator: undefined },
      { range: `bytes=${bytes}-`, validator: '"fixture-v1"' },
    ]);
    // Electron/undici can duplicate the identity token for Range requests;
    // no compressed representation may be requested in either case.
    expect(f.requests.every((request) => request.encoding?.split(',').every((value) => value.trim() === 'identity'))).toBe(true);
    expect(await readFile(join(f.root, "resumed"))).toEqual(content);
    expect((await restored.summary([asset])).assets[0]?.state).toBe("verified");
    // Complete cache remains usable for a later failed multi-asset install and never requests again.
    await restored.acquire(asset, join(f.root, "reused"), new AbortController().signal, () => {});
    expect(f.requests).toHaveLength(2);
  });
  it("continues at the saved prefix after a network drop without retransferring it", async () => {
    let connection: ServerResponse | undefined;
    const f = await fixture((req, res, count) => {
      if (count !== 1) { sendRange(req, res); return; }
      prefixResponse(req, res);
      connection = res;
    });
    await f.cache.acquire(f.asset, join(f.root, "done"), new AbortController().signal, (ratio) => { if (ratio > 0 && f.requests.length === 1) connection?.destroy(); });
    expect(f.requests[1]?.range).toBe("bytes=8192-");
    expect(await readFile(join(f.root, "done"))).toEqual(content);
  });
  it.each(["ignored range", "changed entity"])("restarts a full200 body for %s without appending", async (mode) => {
    const phases: string[] = [];
    const f = await fixture((req, res, count) => {
      if (count === 1) { prefixResponse(req, res); return; }
      res.writeHead(200, { "content-length": content.length, etag: mode === "changed entity" ? '"fixture-v2"' : '"fixture-v1"' }); res.end(content);
    });
    await retainPrefix(f);
    await f.cache.acquire(f.asset, join(f.root, "done"), new AbortController().signal, () => {}, (phase) => phases.push(phase));
    expect(phases).toContain("restarting");
    expect(await readFile(join(f.root, "done"))).toEqual(content);
  });
  it.each(["wrong start", "wrong total", "wrong end", "changed validator", "compressed", "overlong"])("invalidates only its own entry on %s", async (mode) => {
    const f = await fixture((req, res, count) => {
      if (count === 1) { prefixResponse(req, res); return; }
      const offset = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1]);
      res.writeHead(206, {
        "content-range": `bytes ${mode === "wrong start" ? offset + 1 : offset}-${mode === "wrong end" ? content.length : content.length - 1}/${mode === "wrong total" ? content.length + 1 : content.length}`,
        etag: mode === "changed validator" ? '"changed"' : '"fixture-v1"',
        ...(mode === "compressed" ? { "content-encoding": "gzip" } : {}),
      });
      res.end(mode === "overlong" ? Buffer.concat([content.subarray(offset), Buffer.from("extra")]) : content.subarray(offset));
    });
    await retainPrefix(f);
    await writeFile(join(f.cache.directory, "unrelated.txt"), "keep");
    await expect(f.cache.acquire(f.asset, join(f.root, "bad"), new AbortController().signal, () => {})).rejects.toMatchObject({ code: "INSTALL_INTEGRITY" });
    expect((await f.cache.summary([f.asset])).totalBytes).toBe(0);
    expect(await readFile(join(f.cache.directory, "unrelated.txt"), "utf8")).toBe("keep");
  });
  it("resets an incomplete416 once and obtains a fresh pinned full body", async () => {
    const f = await fixture((req, res, count) => {
      if (count === 1) prefixResponse(req, res);
      else if (count === 2) { res.writeHead(416, { "content-range": `bytes */${content.length}` }); res.end(); }
      else sendRange(req, res);
    });
    await retainPrefix(f);
    await f.cache.acquire(f.asset, join(f.root, "done"), new AbortController().signal, () => {});
    expect(f.requests.map((r) => r.range)).toEqual([undefined, "bytes=8192-", undefined]);
    expect(await readFile(join(f.root, "done"))).toEqual(content);
  });
  it("rejects same-size corrupted data and retains other complete assets across explicit clear", async () => {
    const f = await fixture((_req, res) => res.end(Buffer.alloc(content.length)));
    await expect(f.cache.acquire(f.asset, join(f.root, "bad"), new AbortController().signal, () => {})).rejects.toMatchObject({ code: "INSTALL_INTEGRITY" });
    expect((await f.cache.summary([f.asset])).totalBytes).toBe(0);
  });
  it("checks cached full-file hash again rather than trusting metadata and never mixes different pins", async () => {
    const f = await fixture(sendRange);
    await f.cache.acquire(f.asset, join(f.root, "good"), new AbortController().signal, () => {});
    const changed = { ...f.asset, artifact: { ...f.asset.artifact, sha256: "0".repeat(64) } };
    expect(artifactCacheKey(changed)).not.toBe(artifactCacheKey(f.asset));
    await expect(f.cache.acquire(changed, join(f.root, "bad-pin"), new AbortController().signal, () => {})).rejects.toMatchObject({ code: "INSTALL_INTEGRITY" });
    expect((await f.cache.summary([f.asset])).totalBytes).toBe(content.length);
    await writeFile(join(f.cache.directory, artifactCacheKey(f.asset) + ".part"), Buffer.alloc(content.length));
    await expect(f.cache.acquire(f.asset, join(f.root, "bad-cache"), new AbortController().signal, () => {})).rejects.toMatchObject({ code: "INSTALL_INTEGRITY" });
    expect(f.requests).toHaveLength(2);
  });
  it("restarts corrupted sidecar from zero and explicit clear preserves unrelated files", async () => {
    const f = await fixture((req, res, count) => count === 1 ? prefixResponse(req, res) : sendRange(req, res));
    await retainPrefix(f);
    await writeFile(join(f.cache.directory, artifactCacheKey(f.asset) + ".json"), JSON.stringify({ version: 1, path: "../../outside" }));
    await f.cache.acquire(f.asset, join(f.root, "done"), new AbortController().signal, () => {});
    expect(f.requests[1]?.range).toBeUndefined();
    await writeFile(join(f.cache.directory, "not-owned.part"), "keep");
    await f.cache.clear();
    expect(await readdir(f.cache.directory)).toEqual(["not-owned.part"]);
  });
  it("rejects junction/symlink cache ancestors without traversing or deleting target files", async () => {
    const f = await fixture(sendRange); const outside = join(f.root, "outside"); await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "keep");
    await symlink(outside, join(f.root, "managed-artifact-cache"), "junction");
    await expect(f.cache.acquire(f.asset, join(f.root, "bad"), new AbortController().signal, () => {})).rejects.toMatchObject({ code: "INSTALL_CACHE_PATH" });
    await expect(f.cache.clear()).rejects.toMatchObject({ code: "INSTALL_CACHE_PATH" });
    expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
  });
  it("refuses clear or a competing acquire while an entry is downloading", async () => {
    const f = await fixture(prefixResponse); const controller = new AbortController();
    let reached: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { reached = resolve; });
    const operation = downloadArtifact(f.asset.artifact, join(f.root, "first"), controller.signal, (ratio) => { if (ratio > 0) reached?.(); }, { cache: f.cache, asset: f.asset });
    const rejection = expect(operation).rejects.toMatchObject({ code: "CANCELLED" });
    await ready;
    await expect(f.cache.clear()).rejects.toMatchObject({ code: "INSTALL_BUSY" });
    await expect(new ArtifactCache(f.root, "runtime").acquire(f.asset, join(f.root, "second"), controller.signal, () => {})).rejects.toMatchObject({ code: "INSTALL_BUSY" });
    controller.abort(); await rejection;
    await f.cache.clear(); expect((await f.cache.summary([f.asset])).totalBytes).toBe(0);
  });
  it("resumes after an actual isolated download process is killed without graceful cancellation", async () => {
    const f = await fixture((req, res, count) => count === 1 ? prefixResponse(req, res) : sendRange(req, res));
    const require = createRequire(import.meta.url);
    const entry = fileURLToPath(new URL("../../../src/main/services/runtime/artifact-cache.ts", import.meta.url));
    const childScript = join(f.root, "isolated-download.cjs");
    // The test-only loader transforms source in the isolated embedded-Node child;
    // it launches no Electron UI, installed application or external artifact.
    await writeFile(childScript, `const fs=require('node:fs'); const esbuild=require(${JSON.stringify(require.resolve("esbuild"))});
require.extensions['.ts']=(mod,path)=>mod._compile(esbuild.transformSync(fs.readFileSync(path,'utf8'),{loader:'ts',format:'cjs',target:'node24'}).code,path);
const {ArtifactCache}=require(${JSON.stringify(entry)});
new ArtifactCache(${JSON.stringify(f.root)},'runtime').acquire(${JSON.stringify(f.asset)},${JSON.stringify(join(f.root, "child-stage"))},new AbortController().signal,(ratio)=>{if(ratio>0)process.send?.({prefix:true});}).catch(error=>{console.error(error);process.exitCode=1;});`);
    const child = spawn(process.execPath, [childScript], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
    let errors = ""; child.stderr?.on("data", (value: Buffer) => { errors += value.toString(); });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Isolated download never reached prefix: " + errors)), 10000);
        child.once("message", () => { clearTimeout(timer); resolve(); });
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", () => { clearTimeout(timer); reject(new Error("Download exited early: " + errors)); });
      });
      child.kill("SIGKILL"); await exited;
      const restored = new ArtifactCache(f.root, "runtime"); const bytes = (await restored.summary([f.asset])).totalBytes;
      expect(bytes).toBe(8192);
      await restored.acquire(f.asset, join(f.root, "after-process-restart"), new AbortController().signal, () => {});
      expect(f.requests.map((r) => r.range)).toEqual([undefined, `bytes=${bytes}-`]);
      expect(await readFile(join(f.root, "after-process-restart"))).toEqual(content);
      await expect(readFile(join(f.root, "child-stage"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } }
  }, 15000);
  it("resumes without a strong validator and never sends weak ETag as If-Range", async () => {
    const f = await fixture((req, res, count) => {
      if (count === 1) { res.writeHead(200, { "content-length": content.length, etag: 'W/"weak"' }); res.write(content.subarray(0, 8192)); }
      else sendRange(req, res);
    });
    const bytes = await retainPrefix(f);
    await f.cache.acquire(f.asset, join(f.root, "weak-resumed"), new AbortController().signal, () => {});
    expect(f.requests[1]?.range).toBe(`bytes=${bytes}-`); expect(f.requests[1]?.validator).toBeUndefined();
    expect(await readFile(join(f.root, "weak-resumed"))).toEqual(content);
  });
  it("continues after a clean short response and validates a partial206 subrange before the next range", async () => {
    const f = await fixture((req, res, count) => {
      const offset = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0);
      if (count === 1) { res.writeHead(200); res.end(content.subarray(0, 8192)); }
      else if (count === 2) { res.writeHead(206, { "content-range": `bytes ${offset}-${offset + 4095}/${content.length}`, "content-length": 4096 }); res.end(content.subarray(offset, offset + 4096)); }
      else sendRange(req, res);
    });
    await f.cache.acquire(f.asset, join(f.root, "subranges"), new AbortController().signal, () => {});
    expect(f.requests.map((r) => r.range)).toEqual([undefined, "bytes=8192-", "bytes=12288-"]);
    expect(await readFile(join(f.root, "subranges"))).toEqual(content);
  });
  it("refuses hard-linked owned cache files and keeps external bytes intact", async () => {
    const f = await fixture(sendRange);
    await f.cache.acquire(f.asset, join(f.root, "first-copy"), new AbortController().signal, () => {});
    const path = join(f.cache.directory, artifactCacheKey(f.asset) + ".part");
    const outside = join(f.root, "external-link"); await link(path, outside);
    await expect(f.cache.acquire(f.asset, join(f.root, "second-copy"), new AbortController().signal, () => {})).rejects.toMatchObject({ code: "INSTALL_CACHE_PATH" });
    await expect(f.cache.clear()).rejects.toMatchObject({ code: "INSTALL_CACHE_PATH" });
    expect(await readFile(outside)).toEqual(content);
  });
  it("never overwrites an existing staging destination and retains complete cache for a safe retry", async () => {
    const f = await fixture(sendRange); const destination = join(f.root, "existing");
    await writeFile(destination, "user-owned");
    await expect(f.cache.acquire(f.asset, destination, new AbortController().signal, () => {})).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(destination, "utf8")).toBe("user-owned");
    await f.cache.acquire(f.asset, join(f.root, "new-copy"), new AbortController().signal, () => {});
    expect(f.requests).toHaveLength(1); expect(await readFile(join(f.root, "new-copy"))).toEqual(content);
  });
});
