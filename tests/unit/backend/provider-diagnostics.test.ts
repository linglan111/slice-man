import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, open, readFile, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../../../src/main/db/migrations";
import { DiagnosticWriter, ProviderDiagnosticsRepository, type DiagnosticStart } from "../../../src/main/db/provider-diagnostics";
import { providerDiagnosticSchema } from "../../../src/shared/provider-diagnostics-contracts";

const roots: string[] = [];
const dbs: Database.Database[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of dbs.splice(0)) db.close();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const start = (startedAt = Date.now()): DiagnosticStart => ({ runId: "run", operation: "review", profileId: "profile", model: "model", protocol: "openai", mode: "chat", attempt: 0, targetCount: 1, promptBytes: 10, streamRequested: true, timeoutMs: 120000, textTimeoutMs: 1800000, startedAt });
async function fixture(): Promise<{ root: string; db: Database.Database; repo: ProviderDiagnosticsRepository }> {
  const root = await mkdtemp(join(tmpdir(), "slice-diagnostics-")); roots.push(root);
  const db = new Database(join(root, "app.db")); dbs.push(db);
  for (const migration of MIGRATIONS) db.exec(migration);
  return { root, db, repo: new ProviderDiagnosticsRepository(db, root) };
}

describe("SQLite diagnostic files and restart integrity", () => {
  it("adds the diagnostic migration to a legacy v1 database without touching jobs/protected keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "slice-diagnostic-upgrade-")); roots.push(root);
    const db = new Database(join(root, "app.db")); dbs.push(db);
    const first = MIGRATIONS[0]; const diagnosticMigration = MIGRATIONS[1];
    if (!first || !diagnosticMigration) throw new Error("Missing bundled migration");
    db.exec(first); db.pragma("user_version = 1");
    db.prepare("INSERT INTO jobs VALUES (?,?,?,?)").run("job", "{legacy:true}", 100, 200);
    db.prepare("INSERT INTO profiles VALUES (?,?,?,?)").run("profile", "{old:true}", "protected-key-not-read", 300);
    db.transaction(() => { db.exec(diagnosticMigration); db.pragma("user_version = 2"); })();
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    expect(db.prepare("SELECT * FROM jobs").all()).toEqual([{ id: "job", payload: "{legacy:true}", created_at: 100, updated_at: 200 }]);
    expect(db.prepare("SELECT encrypted_key FROM profiles").get()).toEqual({ encrypted_key: "protected-key-not-read" });
    const repo = new ProviderDiagnosticsRepository(db, root);
    const writer = await repo.begin(start()); await writer.append("{}"); await writer.finish("transport_complete");
    expect(repo.list()[0]?.state).toBe("transport_complete");
  });
  it("reconciles abrupt receiving rows on reopen, keeps bytes and never starts work", async () => {
    const f = await fixture();
    const writer = await f.repo.begin(start()); await writer.append("猫");
    // Persist an unfinished state as an abrupt process exit would leave it.
    const record = { ...writer.record };
    await writer.finish("cancelled", "CANCELLED", "cancel");
    f.repo.update({ ...record, state: "receiving" });
    f.db.close(); dbs.splice(dbs.indexOf(f.db), 1);
    const reopened = new Database(join(f.root, "app.db")); dbs.push(reopened);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const restored = new ProviderDiagnosticsRepository(reopened, f.root);
    expect(restored.detail(record.id)).toMatchObject({ state: "interrupted", errorCode: "INTERRUPTED", textBytes: Buffer.byteLength("猫") });
    expect(await restored.readAnswer(record.id)).toBe("猫"); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("recovers a real fsynced streamed response after an isolated generation process is killed", async () => {
    const f = await fixture(); const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ id: "stream", choices: [{ index: 0, delta: { content: '{"partial":' }, finish_reason: null }] })}\n\n`);
    }); servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("address");
    const require = createRequire(import.meta.url);
    const repository = fileURLToPath(new URL("../../../src/main/db/provider-diagnostics.ts", import.meta.url));
    const provider = fileURLToPath(new URL("../../../src/main/services/providers/lib/text-provider.ts", import.meta.url));
    const script = join(f.root, "isolated-stream.cjs");
    await writeFile(script, `const fs=require('node:fs'); const esbuild=require(${JSON.stringify(require.resolve("esbuild"))});
require.extensions['.ts']=(mod,path)=>mod._compile(esbuild.transformSync(fs.readFileSync(path,'utf8'),{loader:'ts',format:'cjs',target:'node24'}).code,path);
const Database=require(${JSON.stringify(require.resolve("better-sqlite3"))});
const {ProviderDiagnosticsRepository}=require(${JSON.stringify(repository)});const {generateText}=require(${JSON.stringify(provider)});
const repo=new ProviderDiagnosticsRepository(new Database(${JSON.stringify(join(f.root, "app.db"))}),${JSON.stringify(f.root)});
const timer=setInterval(()=>{const row=repo.list()[0];if(row?.textBytes){clearInterval(timer);process.send?.({id:row.id});}},10);
generateText({id:'fixture',name:'fixture',protocol:'openai',mode:'chat',model:'fixture',timeoutMs:5000,maxUploadBytes:100000,sessionOnly:true,hasKey:true,structuredOutput:true,baseUrl:${JSON.stringify(`http://127.0.0.1:${address.port}`)}},'test-only','fixture',undefined,{diagnostics:repo,operation:'review'}).catch(error=>{console.error(error);process.exitCode=1;});`);
    const child = spawn(process.execPath, [script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let errors = ""; child.stderr?.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      const id = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("No persisted stream prefix: " + errors)), 10000);
        child.once("message", (value: unknown) => { clearTimeout(timer); if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") reject(new Error("Invalid child receipt")); else resolve(value.id); });
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", () => { clearTimeout(timer); reject(new Error("Stream child exited early: " + errors)); });
      });
      child.kill("SIGKILL"); await exited;
      const fetchSpy = vi.spyOn(globalThis, "fetch"); const restored = new ProviderDiagnosticsRepository(f.db, f.root);
      expect(restored.detail(id)).toMatchObject({ state: "interrupted", errorCode: "INTERRUPTED", textBytes: Buffer.byteLength('{"partial":') });
      expect(await restored.readAnswer(id)).toBe('{"partial":'); expect(fetchSpy).not.toHaveBeenCalled();
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } }
  }, 15000);
  it("marks invalid completed JSON separately from protocol success and prevents publication", async () => {
    const { repo } = await fixture(); const writer = await repo.begin(start());
    await writer.append("{bad"); await writer.finish("transport_complete");
    repo.markValidationFailed(writer.record.id, "INVALID_JSON");
    expect(repo.detail(writer.record.id)).toMatchObject({ state: "failed", errorCode: "INVALID_JSON", errorPhase: "validation" });
    expect(() => repo.markPublished(writer.record.id)).toThrow(); expect(await repo.readAnswer(writer.record.id)).toBe("{bad");
  });
  it("paginates same-millisecond rows with an ID tie-break and preserves legacy timestamp-only cursors", async () => {
    const { repo } = await fixture(); const writer = await repo.begin(start()); await writer.finish("cancelled");
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort().reverse();
    for (const id of ids) repo.update({ ...writer.record, id, jobId: "page", artifact: `${id}/answer.partial.txt`, state: "failed", startedAt: 1000, endedAt: 1001 });
    const older = randomUUID(); repo.update({ ...writer.record, id: older, jobId: "page", artifact: `${older}/answer.partial.txt`, state: "failed", startedAt: 900, endedAt: 901 });
    const found: string[] = [];
    let cursor: { before: number; beforeId: string } | undefined;
    for (;;) {
      const page = repo.list({ jobId: "page", limit: 1, ...cursor });
      const row = page[0]; if (!row) break;
      found.push(row.id); cursor = { before: row.startedAt, beforeId: row.id };
    }
    expect(found).toEqual([...ids, older]);
    expect(repo.list({ jobId: "page", before: 1000 }).map((record) => record.id)).toEqual([older]);
    expect(() => repo.list({ beforeId: older })).toThrow();
  });
  it("retains only terminal rows for 30 days/1000 records and leaves active/unrelated files untouched", async () => {
    const { repo, db } = await fixture();
    const writer = await repo.begin(start()); await writer.append("active");
    const now = Date.now();
    db.transaction(() => { for (let i = 0; i < 1002; i++) {
      const id = randomUUID();
      repo.update({ ...writer.record, id, artifact: `${id}/answer.partial.txt`, state: "failed", startedAt: now - i, endedAt: now - i });
    } })();
    const old = randomUUID(); repo.update({ ...writer.record, id: old, artifact: `${old}/answer.partial.txt`, state: "failed", startedAt: 1, endedAt: 1 });
    const oldDir = join(repo.root, old); await mkdir(oldDir); await writeFile(join(oldDir, "answer.partial.txt"), "old"); await writeFile(join(oldDir, "keep.txt"), "unrelated");
    await repo.prune(now);
    expect(repo.list({ limit: 100 })).toHaveLength(100);
    expect(() => repo.detail(old)).toThrow(); expect(await readFile(join(oldDir, "keep.txt"), "utf8")).toBe("unrelated");
    expect(repo.detail(writer.record.id).state).toBe("waiting"); expect(await repo.readAnswer(writer.record.id)).toBe("active");
    expect(db.prepare("SELECT count(*) AS count FROM ai_requests").get()).toEqual({ count: 1001 });
    await repo.clear([writer.record.id]); expect(repo.detail(writer.record.id).state).toBe("waiting");
    await writer.finish("cancelled");
  });
  it("rejects cross-request artifact references and junction traversal", async () => {
    const f = await fixture(); const writer = await f.repo.begin(start()); await writer.finish("cancelled");
    expect(providerDiagnosticSchema.safeParse({ ...writer.record, artifact: `${randomUUID()}/answer.partial.txt` }).success).toBe(false);
    const outside = join(f.root, "outside"); await mkdir(outside); await writeFile(join(outside, "answer.partial.txt"), "keep");
    const directory = join(f.repo.root, writer.record.id); await rm(directory, { recursive: true }); await symlink(outside, directory, "junction");
    await expect(f.repo.readAnswer(writer.record.id)).rejects.toMatchObject({ code: "DIAGNOSTIC_STORAGE" });
    await expect(f.repo.clear()).rejects.toMatchObject({ code: "DIAGNOSTIC_STORAGE" });
    expect(await readFile(join(outside, "answer.partial.txt"), "utf8")).toBe("keep");
  });
  it("serializes actual partial writes and preserves successfully written bytes on ENOSPC", async () => {
    const { repo } = await fixture(); const original = await repo.begin(start()); await original.finish("cancelled");
    const record = { ...original.record, state: "receiving" as const, endedAt: undefined };
    const handle = await open(await repo.artifactPath(record.id), "w");
    const realWrite = handle.write.bind(handle); let calls = 0;
    const writable = handle as unknown as { write: (bytes: Uint8Array, offset: number, length: number, position: null) => Promise<{ bytesWritten: number; buffer: Uint8Array }> };
    vi.spyOn(writable, "write").mockImplementation(async (bytes) => {
      if (++calls === 2) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      return realWrite(bytes, 0, 1, null);
    });
    const writer = new DiagnosticWriter(repo, record, handle);
    await expect(writer.append("abc")).rejects.toMatchObject({ code: "DIAGNOSTIC_STORAGE" });
    await writer.finish("failed", "DIAGNOSTIC_STORAGE", "storage");
    expect(repo.detail(record.id).textBytes).toBe(1); expect(await repo.readAnswer(record.id)).toBe("a");
  });
  it("classifies final fsync failure as storage and leaves a terminal failed record", async () => {
    const { repo } = await fixture(); const original = await repo.begin(start()); await original.finish("cancelled");
    const handle = await open(await repo.artifactPath(original.record.id), "a");
    vi.spyOn(handle, "sync").mockRejectedValueOnce(new Error("ENOSPC"));
    const writer = new DiagnosticWriter(repo, { ...original.record, state: "receiving" }, handle);
    await expect(writer.finish("transport_complete")).rejects.toMatchObject({ code: "DIAGNOSTIC_STORAGE" });
    expect(repo.detail(original.record.id)).toMatchObject({ state: "failed", errorCode: "DIAGNOSTIC_STORAGE", errorPhase: "storage" });
  });
});
