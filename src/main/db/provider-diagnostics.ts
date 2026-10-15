import type Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, lstat, open, rename, rm, readFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import { providerDiagnosticSchema, diagnosticsListInputSchema } from "../../shared/provider-diagnostics-contracts";
import type { ProviderDiagnostic, DiagnosticsListInput, DiagnosticsLiveInput, ProviderLiveSnapshot } from "../../shared/provider-diagnostics-contracts";
import { AppError } from "../lib/errors";

import { LiveProviderStreams } from "../services/providers/lib/live-streams";

const ACTIVE = new Set(["waiting", "receiving"]);
const LIMIT_BYTES = 4_000_000;
export type DiagnosticStart = Omit<ProviderDiagnostic, "id" | "state" | "artifact" | "elapsedMs" | "wireBytes" | "textBytes" | "events" | "heartbeats">;

/** Only trusted main-process code supplies metadata; generated answers never enter SQL. */
export class ProviderDiagnosticsRepository {
  readonly root: string;
  readonly liveStreams = new LiveProviderStreams();
  live(input?: DiagnosticsLiveInput): ProviderLiveSnapshot[] { return this.liveStreams.list(input); }
  constructor(private readonly sqlite: Database.Database, userData: string) {
    this.root = resolve(userData, "ai-responses");
    this.recoverInterrupted();
  }
  private persist(record: ProviderDiagnostic): void {
    const value = providerDiagnosticSchema.parse(record);
    try { this.sqlite.prepare(`INSERT INTO ai_requests(id,job_id,state,started_at,ended_at,payload) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,ended_at=excluded.ended_at,payload=excluded.payload`).run(
      value.id, value.jobId ?? null, value.state, value.startedAt, value.endedAt ?? null, JSON.stringify(value),
    ); this.liveStreams.update(value); } catch { throw new AppError("DIAGNOSTIC_STORAGE", "AI 请求日志无法保存，请检查磁盘空间和数据库权限。"); }
  }
  update(record: ProviderDiagnostic): void { this.persist(record); }
  list(input: DiagnosticsListInput = {}): ProviderDiagnostic[] {
    const parsed = diagnosticsListInputSchema.parse(input);
    const rows = this.sqlite.prepare(`SELECT payload FROM ai_requests WHERE (? IS NULL OR job_id=?) AND (? IS NULL OR started_at<? OR (started_at=? AND id<?)) ORDER BY started_at DESC,id DESC LIMIT ?`).all(
      parsed.jobId ?? null, parsed.jobId ?? null, parsed.before ?? null, parsed.before ?? null, parsed.before ?? null, parsed.beforeId ?? null, parsed.limit,
    ) as { payload: string }[];
    return rows.map((row) => providerDiagnosticSchema.parse(JSON.parse(row.payload)));
  }
  detail(id: string): ProviderDiagnostic {
    const row = this.sqlite.prepare("SELECT payload FROM ai_requests WHERE id=?").get(id) as { payload: string } | undefined;
    if (!row) throw new AppError("NOT_FOUND", "找不到请求日志");
    return providerDiagnosticSchema.parse(JSON.parse(row.payload));
  }
  recoverInterrupted(): void {
    const rows = this.sqlite.prepare("SELECT payload FROM ai_requests WHERE state IN ('waiting','receiving')").all() as { payload: string }[];
    this.sqlite.transaction(() => {
      for (const row of rows) {
        const value = providerDiagnosticSchema.parse(JSON.parse(row.payload));
        this.persist({ ...value, state: "interrupted", endedAt: Date.now(), elapsedMs: Math.max(0, Date.now() - value.startedAt), errorCode: "INTERRUPTED" });
      }
    })();
  }
  private async safeRoot(): Promise<void> {
    // Check every existing ancestor, including junctions on Windows.
    let cursor = this.root;
    const parents: string[] = [];
    for (;;) {
      parents.push(cursor);
      const parent = resolve(cursor, "..");
      if (parent === cursor) break;
      cursor = parent;
    }
    for (const path of parents.reverse()) {
      try { const info = await lstat(path); if (info.isSymbolicLink() || !info.isDirectory()) throw new AppError("DIAGNOSTIC_STORAGE", "日志目录不安全，请选择本地数据目录。"); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    }
    await mkdir(this.root, { recursive: true });
  }
  async begin(input: DiagnosticStart): Promise<DiagnosticWriter> {
    const id = randomUUID();
    const record = providerDiagnosticSchema.parse({ ...input, id, state: "waiting", elapsedMs: 0, wireBytes: 0, textBytes: 0, events: 0, heartbeats: 0, artifact: `${id}/answer.partial.txt` });
    try {
      await this.safeRoot();
      await mkdir(join(this.root, id));
      const handle = await open(join(this.root, record.artifact), "wx");
      try { this.persist(record); } catch (error) { await handle.close(); throw error; }
      this.liveStreams.start(record);
      return new DiagnosticWriter(this, record, handle);
    } catch { throw new AppError("DIAGNOSTIC_STORAGE", "无法创建 AI 响应日志，请检查磁盘空间和数据目录权限。"); }
  }
  async artifactPath(id: string): Promise<string> {
    const record = this.detail(id);
    await this.safeRoot();
    const directory = join(this.root, record.id);
    if ((await lstat(directory)).isSymbolicLink()) throw new AppError("DIAGNOSTIC_STORAGE", "日志文件路径不安全");
    const path = join(this.root, record.artifact);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > LIMIT_BYTES) throw new AppError("DIAGNOSTIC_STORAGE", "日志文件无效");
    return path;
  }
  async readAnswer(id: string): Promise<string> { return readFile(await this.artifactPath(id), "utf8"); }
  markValidated(id: string): void {
    const record = this.detail(id);
    if (record.state !== "transport_complete") throw new AppError("DIAGNOSTIC_STATE", "请求尚未完成，不能标记校验成功");
    this.persist({ ...record, state: "validated" });
  }
  markPublished(id: string): void {
    const record = this.detail(id);
    if (record.state !== "validated") throw new AppError("DIAGNOSTIC_STATE", "结果尚未校验，不能标记保存成功");
    this.persist({ ...record, state: "published" });
  }
  markValidationFailed(id: string, code: string): void {
    const record = this.detail(id);
    if (!["transport_complete", "validated"].includes(record.state)) throw new AppError("DIAGNOSTIC_STATE", "请求尚未完成，不能记录结果校验失败");
    this.persist({ ...record, state: "failed", errorCode: /^[A-Z0-9_]{1,80}$/.test(code) ? code : "VALIDATION_ERROR", errorPhase: "validation" });
  }
  async clear(ids?: string[]): Promise<void> {
    const rows = this.sqlite.prepare("SELECT payload FROM ai_requests WHERE state NOT IN ('waiting','receiving')").all() as { payload: string }[];
    const selected = ids ? new Set(ids) : undefined;
    await this.safeRoot();
    for (const row of rows) {
      const record = providerDiagnosticSchema.parse(JSON.parse(row.payload));
      if (selected && !selected.has(record.id)) continue;
      const directory = join(this.root, record.id);
      try {
        const stat = await lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AppError("DIAGNOSTIC_STORAGE", "日志文件路径不安全");
        // Remove tracked files only; unrelated files in the directory survive.
        for (const name of ["answer.partial.txt", "answer.complete.txt"]) {
          const path = join(directory, name);
          try { const file = await lstat(path); if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1) throw new AppError("DIAGNOSTIC_STORAGE", "日志文件路径不安全"); await rm(path); }
          catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
        }
      } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
      this.liveStreams.clear(record.id);
      this.sqlite.prepare("DELETE FROM ai_requests WHERE id=? AND state NOT IN ('waiting','receiving')").run(record.id);
    }
  }
  async prune(now = Date.now()): Promise<void> {
    const rows = this.sqlite.prepare("SELECT payload FROM ai_requests WHERE state NOT IN ('waiting','receiving') ORDER BY started_at DESC,id DESC").all() as { payload: string }[];
    const ids = rows.map((row) => providerDiagnosticSchema.parse(JSON.parse(row.payload))).filter((record, index) => index >= 1000 || (record.endedAt ?? record.startedAt) < now - 30 * 86400000).map((record) => record.id);
    if (ids.length) await this.clear(ids);
  }
}

export class DiagnosticWriter {
  private lastCheckpoint = 0;
  private readonly hash = createHash("sha256");
  private closed = false;
  constructor(private readonly repository: ProviderDiagnosticsRepository, readonly record: ProviderDiagnostic, private readonly handle: FileHandle) {}
  async append(text: string): Promise<void> {
    const bytes = Buffer.from(text);
    if (this.record.textBytes + bytes.length > LIMIT_BYTES) throw new AppError("RESPONSE_LIMIT", "AI 返回内容过大");
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const result = await this.handle.write(bytes, offset, bytes.length - offset, null);
        if (!result.bytesWritten) throw new Error("zero write");
        this.hash.update(bytes.subarray(offset, offset + result.bytesWritten));
        offset += result.bytesWritten;
        this.record.textBytes += result.bytesWritten;
      }
      if (!this.record.firstAnswerAt) this.record.firstAnswerAt = Date.now();
      await this.checkpoint();
    } catch (error) { if (error instanceof AppError) throw error; throw new AppError("DIAGNOSTIC_STORAGE", "AI 响应写入失败，请检查磁盘空间；已收到内容已保留。"); }
  }
  async checkpoint(force = false): Promise<void> {
    if (!force && Date.now() - this.lastCheckpoint < 1000) return;
    this.record.elapsedMs = Math.max(0, Date.now() - this.record.startedAt);
    try { await this.handle.sync(); this.repository.update(this.record); this.lastCheckpoint = Date.now(); }
    catch { throw new AppError("DIAGNOSTIC_STORAGE", "无法保存 AI 响应日志，请检查磁盘空间。"); }
  }
  async finish(state: ProviderDiagnostic["state"], errorCode?: string, phase?: ProviderDiagnostic["errorPhase"]): Promise<void> {
    if (this.closed || !ACTIVE.has(this.record.state)) return;
    this.closed = true;
    try {
      try { await this.handle.sync(); } finally { await this.handle.close(); }
      if (state === "transport_complete") {
        await rename(join(this.repository.root, this.record.artifact), join(this.repository.root, this.record.id, "answer.complete.txt"));
        this.record.artifact = `${this.record.id}/answer.complete.txt`;
        this.record.sha256 = this.hash.digest("hex");
      }
      Object.assign(this.record, { state, endedAt: Date.now(), elapsedMs: Math.max(0, Date.now() - this.record.startedAt), ...(errorCode ? { errorCode } : {}), ...(phase ? { errorPhase: phase } : {}) });
      this.repository.update(this.record);
    } catch {
      // Do not turn a local write/sync/SQL failure into a misleading network error.
      Object.assign(this.record, { state: "failed", errorCode: "DIAGNOSTIC_STORAGE", errorPhase: "storage", endedAt: Date.now(), elapsedMs: Math.max(0, Date.now() - this.record.startedAt) });
      try { this.repository.update(this.record); } catch { /* Original storage failure is reported below; startup reconciles unfinished rows. */ }
      throw new AppError("DIAGNOSTIC_STORAGE", "无法完成 AI 响应日志写入，请检查磁盘空间；已收到内容已保留。");
    }
  }
}
