import { refreshReview, staleReview } from "../services/jobs/lib/reprocessing";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Job, Profile, ProfileInput } from "../../shared/contracts";
import {
  profileInputSchema,
  jobSchema,
  profileSchema,
} from "../../shared/contracts";
import type { ProviderSecret } from "../services/providers/types";
import { AppError } from "../lib/errors";
import * as schema from "./schema";
import { MIGRATIONS } from "./migrations";
export class Store {
  readonly sqlite: Database.Database;
  readonly db;
  private readonly sessionKeys = new Map<string, string>();
  constructor(
    path: string,
    private readonly secrets: ProviderSecret,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new Database(path);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    const version = Number(
      this.sqlite.pragma("user_version", { simple: true }),
    );
    if (version > MIGRATIONS.length)
      throw new AppError("DB_VERSION", "数据库由较新版本创建，请升级应用。");
    for (let i = version; i < MIGRATIONS.length; i++) {
      const sql = MIGRATIONS[i];
      if (sql)
        this.sqlite.transaction(() => {
          this.sqlite.exec(sql);
          this.sqlite.pragma(`user_version = ${i + 1}`);
        })();
    }
    this.db = drizzle(this.sqlite, { schema });
    for (const job of this.listJobs()) {
      let changed = false;
      for (const stage of Object.values(job.stages)) {
        if (stage.state === "running") {
          stage.state = "interrupted";
          stage.message = "上次运行中断，可重试此阶段";
          changed = true;
        }
      }
      if (job.previewUrl) {
        delete job.previewUrl;
        job.stages.preview = {
          state: "idle",
          progress: 0,
          message: "重新打开后请生成新的参考预览",
        };
        changed = true;
      }
      if (changed) this.saveJob(job);
    }
  }
  close(): void {
    this.sessionKeys.clear();
    this.sqlite.close();
  }
  listJobs(): Job[] {
    return this.db
      .select()
      .from(schema.jobs)
      .orderBy(desc(schema.jobs.updatedAt))
      .all()
      .map((row) => {
        const job = jobSchema.parse(JSON.parse(row.payload));
        refreshReview(job);
        return job;
      });
  }
  getJob(id: string): Job {
    const row = this.db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, id))
      .get();
    if (!row) throw new AppError("NOT_FOUND", "找不到视频任务");
    const job = jobSchema.parse(JSON.parse(row.payload));
    refreshReview(job);
    return job;
  }
  saveJob(job: Job): Job {
    refreshReview(job);
    jobSchema.parse(job);
    job.updatedAt = Date.now();
    this.db.transaction((tx) => {
      tx.insert(schema.jobs)
        .values({
          id: job.id,
          payload: JSON.stringify(job),
          createdAt: new Date(job.createdAt),
          updatedAt: new Date(job.updatedAt),
        })
        .onConflictDoUpdate({
          target: schema.jobs.id,
          set: {
            payload: JSON.stringify(job),
            updatedAt: new Date(job.updatedAt),
          },
        })
        .run();
      tx.delete(schema.segments).where(eq(schema.segments.jobId, job.id)).run();
      for (const s of job.segments)
        tx.insert(schema.segments)
          .values({
            id: s.id,
            jobId: job.id,
            startMs: s.startMs,
            endMs: s.endMs,
            payload: JSON.stringify(s),
          })
          .run();
      tx.delete(schema.stages).where(eq(schema.stages.jobId, job.id)).run();
      for (const [name, stage] of Object.entries(job.stages))
        tx.insert(schema.stages)
          .values({
            jobId: job.id,
            name,
            payload: JSON.stringify(stage),
            updatedAt: new Date(job.updatedAt),
          })
          .run();
    });
    return job;
  }
  listProfiles(): Profile[] {
    return this.db
      .select()
      .from(schema.profiles)
      .all()
      .map((row) => {
        const value = profileSchema.parse(JSON.parse(row.payload));
        return {
          ...value,
          hasKey: !!row.encryptedKey || this.sessionKeys.has(row.id),
        };
      });
  }
  getProfile(id: string): Profile {
    const p = this.listProfiles().find((v) => v.id === id);
    if (!p) throw new AppError("PROFILE_MISSING", "请选择有效的 AI 配置");
    return p;
  }
  saveProfile(raw: ProfileInput): Profile {
    const input = profileInputSchema.parse(raw);
    const id = input.id ?? randomUUID();
    const existing = this.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, id))
      .get();
    let encryptedKey = existing?.encryptedKey ?? null;
    let nextSessionKey = this.sessionKeys.get(id);
    const keyToMove =
      input.apiKey ??
      (input.sessionOnly && encryptedKey
        ? this.key(id)
        : !input.sessionOnly
          ? nextSessionKey
          : undefined);
    if (keyToMove !== undefined) {
      if (input.sessionOnly) {
        nextSessionKey = keyToMove;
        encryptedKey = null;
      } else {
        if (!this.secrets.isEncryptionAvailable())
          throw new AppError(
            "KEY_PROTECTION_UNAVAILABLE",
            "系统密钥保护不可用，请选择仅本次会话使用。",
          );
        try {
          encryptedKey = this.secrets
            .encryptString(keyToMove)
            .toString("base64");
          nextSessionKey = undefined;
        } catch {
          throw new AppError(
            "KEY_SAVE_FAILED",
            "密钥加密失败，请选择仅本次会话使用。",
          );
        }
      }
    }
    const { apiKey: _key, ...publicInput } = input;
    const value: Profile = {
      ...publicInput,
      id,
      hasKey: !!encryptedKey || !!nextSessionKey,
    };
    const previous = existing
      ? profileSchema.parse(JSON.parse(existing.payload))
      : undefined;
    const isMaterialChange =
      previous &&
      (["protocol", "mode", "baseUrl", "model"] as const).some(
        (field) => previous[field] !== value[field],
      );
    this.sqlite.transaction(() => {
      this.db
        .insert(schema.profiles)
        .values({
          id,
          payload: JSON.stringify(value),
          encryptedKey,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.profiles.id,
          set: {
            payload: JSON.stringify(value),
            encryptedKey,
            updatedAt: new Date(),
          },
        })
        .run();
      if (isMaterialChange) this.invalidateProfileDependents(id);
    })();
    if (nextSessionKey !== undefined) this.sessionKeys.set(id, nextSessionKey);
    else this.sessionKeys.delete(id);
    return value;
  }
  private invalidateProfileDependents(id: string): void {
    for (const job of this.listJobs()) {
      const recognitionChanged =
        job.options.recognition === "cloud" &&
        job.options.recognitionProfileId === id;
      const translationChanged =
        recognitionChanged || job.options.translationProfileId === id;
      const styleChanged = job.options.styleProfileId === id;
      const reviewChanged =
        job.options.reviewProfileId === id ||
        job.reviewReport?.profileId === id;
      if (reviewChanged && job.reviewReport) {
        staleReview(job);
        this.saveJob(job);
      }
      if (!recognitionChanged && !translationChanged && !styleChanged) continue;
      if (recognitionChanged)
        job.stages.recognize = {
          state: "idle",
          progress: 0,
          message: "识别服务配置已改变，需重新识别",
        };
      if (translationChanged) {
        job.segments = job.segments.map((segment) => ({
          ...segment,
          translationStale: true,
        }));
        job.stages.translate = {
          state: "idle",
          progress: 0,
          message: "AI 服务配置已改变，需重新翻译",
        };
      }
      if (styleChanged)
        job.stages.style = {
          state: "idle",
          progress: 0,
          message: "样式服务配置已改变，下次设计将使用新配置；当前样式已保留",
        };
      job.revision++;
      delete job.previewUrl;
      job.stages.preview = {
        state: "idle",
        progress: 0,
        message: "服务配置已改变，需重新预览",
      };
      job.stages.export = {
        state: "idle",
        progress: 0,
        message: "服务配置已改变",
      };
      this.saveJob(job);
    }
  }
  key(id: string): string {
    const session = this.sessionKeys.get(id);
    if (session) return session;
    const row = this.db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.id, id))
      .get();
    if (!row?.encryptedKey)
      throw new AppError("KEY_MISSING", "请填写此配置的 API Key");
    if (!this.secrets.isEncryptionAvailable())
      throw new AppError("KEY_PROTECTION_UNAVAILABLE", "系统密钥保护不可用");
    try {
      return this.secrets.decryptString(
        Buffer.from(row.encryptedKey, "base64"),
      );
    } catch {
      throw new AppError("KEY_READ_FAILED", "密钥解密失败，请重新填写 API Key");
    }
  }
  removeProfile(id: string): void {
    this.invalidateProfileDependents(id);
    this.db.delete(schema.profiles).where(eq(schema.profiles.id, id)).run();
    this.sessionKeys.delete(id);
  }
}
