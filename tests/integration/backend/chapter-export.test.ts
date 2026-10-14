import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ChapterCriteriaRepository } from '../../../src/main/db/chapter-criteria';
import { MIGRATIONS } from '../../../src/main/db/migrations';
import { ChapterExportService, safeChapterTitle } from '../../../src/main/services/chapters/chapter-export-service';
import { chapterSourceFingerprint } from '../../../src/main/services/jobs/lib/chapters';
import { MediaService } from '../../../src/main/services/media/lib/media-service';
import { runProcess } from '../../../src/main/lib/process';
import { DEFAULT_STYLE, optionsSchema, type Job } from '../../../src/shared/contracts';
import type { ChapterExportInput } from '../../../src/shared/chapter-export-contracts';

const roots: string[] = [];
const databases: Database.Database[] = [];
const media = new MediaService({ffmpeg: resolve('resources/media/ffmpeg.exe'), ffprobe: resolve('resources/media/ffprobe.exe'), fonts: resolve('resources/fonts')});
afterEach(async () => {for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});});
function database(path = ':memory:'): Database.Database {const db = new Database(path); for (const migration of MIGRATIONS) db.exec(migration); databases.push(db); return db;}
async function fixture(): Promise<{root: string; job: Job; db: Database.Database; service: ChapterExportService; input: ChapterExportInput}> {
  const root = await mkdtemp(join(tmpdir(), 'chapter-export-')); roots.push(root);
  const inputPath = join(root, 'source.mp4');
  await runProcess(media.paths.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=25:d=4', '-itsoffset', '2', '-f', 'lavfi', '-i', 'sine=frequency=700:duration=2', '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', '-pix_fmt', 'yuv420p', inputPath]);
  const job: Job = {id: 'job', name: 'source', inputPath, media: await media.probe(inputPath), options: optionsSchema.parse({translationEnabled: false}), segments: [
    {id: 'cross', startMs: 200, endMs: 800, sourceText: 'crossing', translatedText: '', translationStale: false},
    {id: 'middle', startMs: 900, endMs: 2000, sourceText: 'middle', translatedText: '', translationStale: false},
    {id: 'after', startMs: 3500, endMs: 4000, sourceText: 'after', translatedText: '', translationStale: false},
  ], style: DEFAULT_STYLE, revision: 2, createdAt: 0, updatedAt: 0, stages: Object.fromEntries(['recognize','translate','style','preview','export'].map((name) => [name, {state:'idle', progress:0, message:''}])) as Job['stages'], outputs: []};
  job.customChapterPlan = {version:1, id:'plan', revision:0, kind:'custom', sourceFingerprint:chapterSourceFingerprint(job), state:'current', createdAt:0, criterion:{id:'c', revision:1, name:'core', instructions:'core'}, chapters:[{id:'one', startMs:500, endMs:2500, title:'CON', summary:'first'}, {id:'two', startMs:2500, endMs:4000, title:'CON', summary:'second'}]};
  const db = database();
  const service = new ChapterExportService(db, {runChapterExport: async (_id, _revision, executor) => executor(structuredClone(job), new AbortController().signal, async () => {})}, media, root);
  return {root, job, db, service, input:{jobId:job.id, revision:2, planId:'plan', planRevision:0, chapterIds:['one','two'], format:'srt'}};
}
describe('chapter criteria library', () => {
  it('seeds once, versions edits and preserves explicit empty selection/library across SQLite reopen', async () => {
    const root=await mkdtemp(join(tmpdir(),'chapter-criteria-')); roots.push(root); const path=join(root,'criteria.sqlite');
    const db = database(path); const repo = new ChapterCriteriaRepository(db);
    expect(repo.list().items).toHaveLength(3);
    const first = repo.list().items[0]; if (!first) throw new Error('seed missing');
    expect(repo.select({id:first.id}).selectedId).toBe(first.id);
    expect(repo.copy({id:first.id, revision:1}).items).toHaveLength(4);
    expect(repo.save({id:first.id, revision:1, name:'new', instructions:'changed'}).items[0]?.revision).toBe(2);
    expect(() => repo.save({id:first.id, revision:1, name:'stale', instructions:'stale'})).toThrow();
    repo.remove({id:first.id, revision:2}); expect(repo.list().selectedId).toBeUndefined();
    for (const item of repo.list().items) repo.remove({id:item.id, revision:item.revision});
    expect(new ChapterCriteriaRepository(db).list()).toEqual({items:[]});
    db.close(); databases.splice(databases.indexOf(db),1); const reopened=new Database(path); databases.push(reopened);
    expect(new ChapterCriteriaRepository(reopened).list()).toEqual({items:[]});
    expect(first.instructions).not.toBe('changed');
  });
});
describe('selected chapter publication', () => {
  it('recovers publication interrupted before its final state checkpoint without duplicate encoding/files', async () => {
    const {root, job, service, input, db} = await fixture();
    const result = await service.export(input, root);
    const before = await readdir(root);
    const row = db.prepare('SELECT payload FROM chapter_exports WHERE id=?').get(result.id) as {payload: string};
    const stored = JSON.parse(row.payload);
    stored.run.state = 'running'; stored.run.clips[1].state = 'running';
    db.prepare('UPDATE chapter_exports SET payload=? WHERE id=?').run(JSON.stringify(stored), result.id);
    const restarted = new ChapterExportService(db, {runChapterExport: async (_id, _revision, action) => action(job, new AbortController().signal, async () => {})}, media, root);
    const render = vi.spyOn(media, 'render');
    try {
      const resumed = await restarted.export({...input, runId: result.id});
      expect(resumed.state).toBe('complete');
      expect(resumed.clips.map((clip) => clip.path)).toEqual(result.clips.map((clip) => clip.path));
      expect(await readdir(root)).toEqual(before);
      expect(render).not.toHaveBeenCalled();
    } finally {render.mockRestore();}
  });
  it('clips/rebases text, allocates safe duplicate/existing names and does not mutate canonical cues', async () => {
    const {root, job, service, input} = await fixture();
    await writeFile(join(root, '_CON.srt'), 'existing');
    const before = JSON.stringify(job);
    const result = await service.export(input, root);
    expect(result.state).toBe('complete');
    expect(result.clips.map((clip) => clip.path?.split(/[\\/]/).pop())).toEqual(['_CON (2).srt','_CON (3).srt']);
    const firstPath = result.clips[0]?.path; if (!firstPath) throw new Error('missing output');
    const text = await readFile(firstPath,'utf8'); expect(text).toContain('00:00:00,000 --> 00:00:00,300'); expect(text).toContain('00:00:00,400 --> 00:00:01,500'); expect(text).not.toContain('after');
    expect(await readFile(join(root,'_CON.srt'),'utf8')).toBe('existing'); expect(JSON.stringify(job)).toBe(before);
    expect(safeChapterTitle('../A:*?  ')).toBe('.._A___'); expect(safeChapterTitle('nul.txt')).toBe('_nul.txt');
  });
  it('retains verified clips after failure, resumes exact options, and marks restart interruption', async () => {
    const {root, job, service, input, db} = await fixture();
    const second = job.customChapterPlan?.chapters[1]; if (!second) throw new Error('missing chapter');
    // Fault-inject the second encode after the first clip was really encoded and published.
    second.title = 'bad';
    const originalRender = media.render.bind(media); let calls = 0;
    media.render = async (...args) => {calls++; if (calls === 2) throw new Error('fixture interrupted'); return originalRender(...args);};
    const videoInput = {...input, format:'mp4' as const};
    try {
      await expect(service.export(videoInput,root)).rejects.toThrow('fixture interrupted');
      const failed = service.list(job.id)[0]; if (!failed) throw new Error('missing run');
      expect(failed.state).toBe('failed'); expect(failed.clips[0]?.state).toBe('complete');
      const first = failed.clips[0]?.path; if (!first) throw new Error('missing first clip');
      const before = await readFile(first);
      await expect(service.export({...videoInput, quality:'high', runId:failed.id})).rejects.toThrow('设置已变化');
      const resumed = await service.export({...videoInput, runId:failed.id}); expect(resumed.state).toBe('complete'); expect(calls).toBe(3); expect(await readFile(first)).toEqual(before);
      const row = db.prepare('SELECT payload FROM chapter_exports WHERE id=?').get(failed.id) as {payload:string};
      const saved = JSON.parse(row.payload); saved.run.state = 'running'; saved.run.clips[1].state = 'running'; db.prepare('UPDATE chapter_exports SET payload=? WHERE id=?').run(JSON.stringify(saved),failed.id);
      const restarted = new ChapterExportService(db,{runChapterExport:async (_id,_revision,action) => action(job,new AbortController().signal,async () => {})},media,root);
      expect(restarted.list(job.id)[0]?.state).toBe('interrupted'); expect(restarted.list(job.id)[0]?.clips[0]?.state).toBe('complete');
    } finally {media.render = originalRender;}
    expect((await readdir(root)).some((name) => name.startsWith('.slice-'))).toBe(false);
  });
  it('retains an already published clip when cancellation stops the next clip', async () => {
    const {root,job,db,input}=await fixture(); const controller=new AbortController();
    const service=new ChapterExportService(db,{runChapterExport:async (_id,_revision,action) => action(job,controller.signal,async () => {})},media,root,(event) => {if(event.progress>0) controller.abort();});
    await expect(service.export(input,root)).rejects.toThrow('取消');
    const run=service.list(job.id)[0]; expect(run?.state).toBe('cancelled'); expect(run?.clips[0]?.state).toBe('complete'); expect(run?.clips[1]?.state).toBe('failed');
    const path=run?.clips[0]?.path; if(!path) throw new Error('missing retained clip'); expect(await readFile(path,'utf8')).toContain('crossing');
  });
  it('checks lease freshness after a real encode and before final publication', async () => {
    const {root,job,db,input}=await fixture();
    const service=new ChapterExportService(db,{runChapterExport:async (_id,_revision,action) => action(job,new AbortController().signal,async () => {throw new Error('source changed during encode');})},media,root);
    await expect(service.export({...input,format:'mp4',chapterIds:['one']},root)).rejects.toThrow('source changed');
    expect(service.list(job.id)[0]?.state).toBe('failed');
    expect((await readdir(root)).filter((name) => name.endsWith('.mp4'))).toEqual(['source.mp4']);
    expect((await readdir(root)).some((name) => name.startsWith('.slice-'))).toBe(false);
  });
  it('encodes exact ranges with delayed audio preserved in MP4/MKV and supports ASS/VTT', async () => {
    const {root, job, service, input} = await fixture();
    for (const format of ['mp4','mkv'] as const) {
      const result = await service.export({...input, format, chapterIds:['one'], videoCodec:'h264', resolution:'original'},root);
      const path = result.clips[0]?.path; if (!path) throw new Error('missing video');
      const info = await media.probe(path); expect(Math.abs(info.durationMs - 2000)).toBeLessThan(100); expect(info.width).toBe(320); expect(info.hasAudio).toBe(true);
      expect(Math.abs(info.audioOffsetMs - (job.media.audioOffsetMs - 500))).toBeLessThan(100);
    }
    for (const format of ['ass','vtt'] as const) {const result = await service.export({...input,format,chapterIds:['one']},root); const path=result.clips[0]?.path; if(!path) throw new Error('missing subtitle'); expect(await readFile(path,'utf8')).toContain('crossing');}
    const stale = job.customChapterPlan; if(!stale) throw new Error('missing plan'); stale.state='stale'; await expect(service.export(input,root)).rejects.toThrow('章节已变化');
  });
  it.each(['mp4', 'mkv'] as const)('exports a silent tail after the delayed source audio stream has ended (%s)', async (sourceFormat) => {
    const {root, job, service, input} = await fixture();
    const tailSource = join(root, `audio-tail.${sourceFormat}`);
    await runProcess(media.paths.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=25:d=4', '-itsoffset', '1', '-f', 'lavfi', '-i', 'sine=frequency=700:duration=1', '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', '-pix_fmt', 'yuv420p', tailSource]);
    job.inputPath = tailSource; job.media = await media.probe(tailSource);
    const plan = job.customChapterPlan; if (!plan) throw new Error('missing plan');
    plan.chapters = [{id: 'one', startMs: 2500, endMs: 4000, title: 'Silent tail', summary: ''}];
    plan.sourceFingerprint = chapterSourceFingerprint(job);
    const run = await service.export({...input, format: 'mp4', chapterIds: ['one']}, root);
    const path = run.clips[0]?.path; if (!path) throw new Error('missing output');
    const output = await media.probe(path);
    expect(output.hasAudio).toBe(false); expect(Math.abs(output.durationMs - 1500)).toBeLessThan(100);
  });
});
