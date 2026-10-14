import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  encryptedKey: text("encrypted_key"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
export const aiRequests = sqliteTable("ai_requests", {
  id: text("id").primaryKey(), jobId: text("job_id"), state: text("state").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }), payload: text("payload").notNull(),
});
export const segments = sqliteTable(
  "segments",
  {
    id: text("id").notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [primaryKey({ columns: [table.jobId, table.id] })],
);
export const stages = sqliteTable(
  "stages",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    payload: text("payload").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.jobId, table.name] })],
);
