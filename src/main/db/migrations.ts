// Versioned migrations are bundled in the main entry, including installed ASAR builds.
export const MIGRATIONS = [
  `CREATE TABLE jobs(id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE profiles(id TEXT PRIMARY KEY, payload TEXT NOT NULL, encrypted_key TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE segments(id TEXT NOT NULL,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,start_ms INTEGER NOT NULL,end_ms INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(job_id,id));
CREATE TABLE stages(job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,name TEXT NOT NULL,payload TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(job_id,name));`,
  `CREATE TABLE ai_requests(id TEXT PRIMARY KEY, job_id TEXT, state TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, payload TEXT NOT NULL);
CREATE INDEX ai_requests_started ON ai_requests(started_at DESC);
CREATE INDEX ai_requests_job ON ai_requests(job_id,started_at DESC);`,
  `CREATE TABLE chapter_criteria(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE chapter_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE chapter_exports(id TEXT PRIMARY KEY, job_id TEXT NOT NULL, payload TEXT NOT NULL);
CREATE INDEX chapter_exports_job ON chapter_exports(job_id);`,
];
