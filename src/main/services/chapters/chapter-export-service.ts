import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { Job, ProgressEvent } from '../../../shared/contracts';
import { chapterExportInputSchema, chapterExportRunSchema, type ChapterExportInput, type ChapterExportRun } from '../../../shared/chapter-export-contracts';
import { AppError, checkAbort } from '../../lib/errors';
import { chapterSourceFingerprint, validateChapterPlan } from '../jobs/lib/chapters';
import type { JobService } from '../jobs/lib/job-service';
import { publish } from '../media/lib/media-service';
import type { MediaService } from '../media/lib/media-service';
import { clipChapterTimeline } from '../subtitles/lib/chapter-timeline';
import { compileSubtitles } from '../subtitles/lib/compiler';

const storedSchema = z.object({ run: chapterExportRunSchema, input: chapterExportInputSchema, directory: z.string().min(1) }).strict();
const rowSchema = z.object({ payload: z.string() });
type StoredRun = z.infer<typeof storedSchema>;
export function safeChapterTitle(title: string): string {
  const cleaned = [...title.normalize('NFC')].map((character) => character.charCodeAt(0) < 32 ? '_' : character).join('').replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 90).replace(/[. ]+$/g, '');
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? `_${cleaned}` : cleaned || '未命名章节';
}
function identity(job: Job, input: ChapterExportInput): string {
  const { runId: _runId, ...options } = input;
  return createHash('sha256').update(JSON.stringify({ options, input: job.inputPath, media: job.media, segments: job.segments, style: job.style, bilingual: job.options.bilingual, translationEnabled: job.options.translationEnabled })).digest('hex');
}
async function digest(path: string, signal?: AbortSignal): Promise<string | undefined> {
  try { checkAbort(signal); if (!(await lstat(path)).isFile()) return undefined; const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) { checkAbort(signal); hash.update(chunk); } checkAbort(signal); return hash.digest('hex'); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined; throw error; }
}
export class ChapterExportService {
  constructor(private readonly sqlite: Database.Database, private readonly jobs: Pick<JobService, 'runChapterExport'>, private readonly media: MediaService, private readonly workspaces: string, private readonly onProgress?: (event: ProgressEvent) => void) {
    for (const raw of sqlite.prepare('SELECT payload FROM chapter_exports').all()) {
      const stored = storedSchema.parse(JSON.parse(rowSchema.parse(raw).payload));
      if (stored.run.state === 'running') {
        stored.run.state = 'interrupted'; stored.run.endedAt = Date.now();
        for (const clip of stored.run.clips) if (clip.state === 'running') clip.state = 'pending';
        this.save(stored);
      }
    }
  }
  private save(stored: StoredRun): void {
    const value = storedSchema.parse(stored);
    this.sqlite.prepare('INSERT INTO chapter_exports(id,job_id,payload) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(value.run.id, value.run.jobId, JSON.stringify(value));
  }
  list(jobId: string): ChapterExportRun[] {
    return this.sqlite.prepare('SELECT payload FROM chapter_exports WHERE job_id=? ORDER BY rowid DESC LIMIT 50').all(z.string().min(1).max(100).parse(jobId)).map((row) => storedSchema.parse(JSON.parse(rowSchema.parse(row).payload)).run);
  }
  async export(raw: unknown, directory?: string): Promise<ChapterExportRun> {
    const input = chapterExportInputSchema.parse(raw);
    return this.jobs.runChapterExport(input.jobId, input.revision, async (job, signal, assertFresh) => {
      const plan = [job.chapterPlan, job.customChapterPlan].find((entry) => entry?.id === input.planId);
      if (!plan || plan.revision !== input.planRevision || plan.state !== 'current' || plan.sourceFingerprint !== chapterSourceFingerprint(job)) throw new AppError('STALE_CHAPTER_PLAN', '章节已变化，请重新确认后导出');
      validateChapterPlan(plan, job.media.durationMs);
      const selected = plan.chapters.filter((chapter) => input.chapterIds.includes(chapter.id));
      if (selected.length !== input.chapterIds.length) throw new AppError('CHAPTER_INVALID', '所选章节不存在');
      const fingerprint = identity(job, input);
      let stored: StoredRun;
      if (input.runId) {
        const row = this.sqlite.prepare('SELECT payload FROM chapter_exports WHERE id=? AND job_id=?').get(input.runId, input.jobId);
        if (!row) throw new AppError('NOT_FOUND', '找不到上次章节导出');
        stored = storedSchema.parse(JSON.parse(rowSchema.parse(row).payload));
        if (stored.run.identity !== fingerprint || (directory && resolve(directory) !== stored.directory)) throw new AppError('STALE_CHAPTER_EXPORT', '字幕、章节或导出设置已变化，请重新导出');
      } else {
        if (!directory) throw new AppError('DIRECTORY_REQUIRED', '请选择导出目录');
        stored = { input, directory: resolve(directory), run: { version: 1, id: randomUUID(), jobId: job.id, planId: plan.id, planRevision: plan.revision, identity: fingerprint, input, state: 'running', startedAt: Date.now(), clips: selected.map((chapter) => ({ chapterId: chapter.id, title: chapter.title, state: 'pending' })) } };
      }
      if (!(await lstat(stored.directory)).isDirectory()) throw new AppError('DIRECTORY_REQUIRED', '导出目录不存在');
      stored.run.state = 'running'; delete stored.run.endedAt; this.save(stored);
      const workspace = join(this.workspaces, 'chapter-exports', stored.run.id, randomUUID());
      try {
        await mkdir(workspace, { recursive: true });
        const used = new Set((await readdir(stored.directory)).map((name) => name.toLowerCase()));
        for (const clip of stored.run.clips) {
          checkAbort(signal);
          if (clip.path && clip.sha256 && await digest(clip.path, signal) === clip.sha256) {
            // A process may have stopped after atomic publication but before its
            // final SQLite state write. The pre-publication identity checkpoint
            // lets a retry reuse that exact verified file without duplicating it.
            clip.state = 'complete'; delete clip.code; this.save(stored); continue;
          }
          const chapter = selected.find((item) => item.id === clip.chapterId);
          if (!chapter) throw new AppError('CHAPTER_INVALID', '章节选择已变化');
          const base = safeChapterTitle(chapter.title);
          let name = `${base}.${input.format}`;
          for (let suffix = 2; used.has(name.toLowerCase()); suffix++) name = `${base} (${suffix}).${input.format}`;
          used.add(name.toLowerCase());
          const path = join(stored.directory, name);
          clip.state = 'running'; delete clip.code; delete clip.path; delete clip.sha256; this.save(stored);
          const completed = stored.run.clips.filter((entry) => entry.state === 'complete').length;
          this.onProgress?.({ jobId: job.id, stage: 'export', progress: completed / selected.length, message: `章节导出 ${completed}/${selected.length} · ${chapter.title}` });
          const temporary = join(stored.directory, `.slice-chapter-${randomUUID()}.${input.format}`);
          try {
            const segments = clipChapterTimeline(job.segments, chapter.startMs, chapter.endMs);
            const format = input.format === 'mp4' || input.format === 'mkv' ? 'ass' : input.format;
            const subtitles = compileSubtitles(segments, job.style, { ...job.media, durationMs: chapter.endMs - chapter.startMs }, job.options.bilingual, format, job.options.translationEnabled);
            if (input.format === 'mp4' || input.format === 'mkv') await this.media.render(job.inputPath, workspace, subtitles, job.media, temporary, input.quality ?? 'balanced', signal, undefined, undefined, { videoCodec: input.videoCodec, resolution: input.resolution }, chapter);
            else await writeFile(temporary, subtitles, { encoding: 'utf8', flag: 'wx' });
            const sha256 = await digest(temporary, signal);
            if (!sha256) throw new AppError('OUTPUT_VALIDATION', '章节输出无法校验，未发布文件');
            clip.path = path; clip.sha256 = sha256; this.save(stored);
            await assertFresh(); checkAbort(signal); await publish(temporary, path);
            clip.state = 'complete'; this.save(stored);
          } catch (error) {
            clip.state = 'failed'; clip.code = error instanceof AppError ? error.code : 'EXPORT_FAILED'; throw error;
          } finally { await rm(temporary, {force:true}); }
        }
        stored.run.state = 'complete';
      } catch (error) {
        stored.run.state = signal.aborted ? 'cancelled' : 'failed'; stored.run.endedAt = Date.now(); this.save(stored); throw error;
      } finally { await rm(workspace, { recursive: true, force: true }); }
      stored.run.endedAt = Date.now(); this.save(stored);
      this.onProgress?.({jobId: job.id, stage: 'export', progress: 1, message: `章节导出完成 · ${selected.length} 个文件`});
      return stored.run;
    });
  }
}
