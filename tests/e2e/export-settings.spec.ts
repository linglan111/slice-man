import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, stat, readdir, mkdir, rename, unlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FFMPEG, FFPROBE, launchApp, makeVideo } from './helpers';
import type { ExportSettings } from '../../src/shared/export-contracts';

const execute = promisify(execFile);
async function makeSource(path: string, codec: 'h264' | 'h265' | 'mpeg4', size = '1920x1080', seconds = '2'): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await execute(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x182b3e:s=${size}:r=10`, '-f', 'lavfi', '-i', `sine=frequency=400:sample_rate=16000:duration=${seconds}`, '-t', seconds, '-c:v', codec === 'h264' ? 'libx264' : codec === 'h265' ? 'libx265' : 'mpeg4', ...(codec === 'mpeg4' ? [] : ['-preset', 'ultrafast']), ...(codec === 'h265' ? ['-x265-params', 'pools=2'] : []), '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path], { windowsHide: true });
}
async function hash(path: string): Promise<string> { return createHash('sha256').update(await readFile(path)).digest('hex'); }
async function seedManualCue(page: Page, endMs = 1800): Promise<void> {
  await expect(page.getByRole('button', { name: '＋ 导入视频', exact: true })).toBeEnabled();
  await expect.poll(async () => { const listed = await page.evaluate(() => window.api.jobs.list()); return listed.success ? listed.data.length : 0; }).toBeGreaterThan(0);
  await page.evaluate(async (end) => {
    const listed = await window.api.jobs.list(); if (!listed.success || !listed.data[0]) throw new Error('Fixture job missing');
    const job = listed.data[0];
    const added = await window.api.jobs.addSegment({ jobId: job.id, revision: job.revision, segment: { startMs: 123, endMs: end, sourceText: 'Anonymous original', translatedText: '最终译文' } });
    if (!added.success) throw new Error(added.error);
  }, endMs);
  await expect(page.getByTestId('segment-0')).toContainText('最终译文');
}
async function openExport(page: Page, subtitle = false): Promise<void> {
  await page.getByRole('button', { name: subtitle ? '导出字幕文件' : '导出作品 ↗', exact: true }).click();
  await expect(page.getByLabel('导出格式', { exact: true })).toBeEnabled();
}
async function finishExport(page: Page): Promise<void> {
  await page.getByRole('button', { name: '选择保存位置并导出', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导出作品', exact: true })).not.toBeVisible({ timeout: 90000 });
}
async function inspect(path: string): Promise<{ width: number; height: number; codec: string; format: string; subtitleTracks: number }> {
  const result = await execute(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { windowsHide: true });
  const info = z.object({ streams: z.array(z.object({ codec_type: z.string(), codec_name: z.string(), width: z.number().optional(), height: z.number().optional() }).passthrough()), format: z.object({ format_name: z.string() }).passthrough() }).parse(JSON.parse(result.stdout) as unknown);
  const video = info.streams.find((stream) => stream.codec_type === 'video');
  return { width: video?.width ?? 0, height: video?.height ?? 0, codec: video?.codec_name ?? '', format: info.format.format_name, subtitleTracks: info.streams.filter((stream) => stream.codec_type === 'subtitle').length };
}
async function assertSubtitlePixels(path: string): Promise<void> {
  const result = await execute(FFMPEG, ['-v', 'error', '-ss', '0.6', '-i', path, '-frames:v', '1', '-vf', 'crop=iw:ih/2:0:ih/2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', windowsHide: true, maxBuffer: 15_000_000 });
  let pixels = 0;
  for (let index = 0; index < result.stdout.length; index += 3) if ((result.stdout[index] ?? 0) > 180 && (result.stdout[index + 1] ?? 0) > 180 && (result.stdout[index + 2] ?? 0) > 180) pixels++;
  expect(pixels, 'Decoded track-free video contains actual burned-in glyph pixels').toBeGreaterThan(20);
}
async function assertNoAI(page: Page): Promise<void> {
  const jobs = await page.evaluate(() => window.api.jobs.list());
  if (!jobs.success) throw new Error(jobs.error);
  expect(jobs.data.every((job) => !job.actualBackend && !job.options.translationProfileId && job.stages.translate.state === 'idle')).toBe(true);
}

test('export defaults and native directory selection persist across restart; per-export overrides stay local and separate subtitle files use current CRUD', async ({ playwright: _p }, info) => {
  const input = info.outputPath('anonymous-defaults.mp4'); await makeVideo(input);
  const sourceHash = await hash(input);
  const directory = info.outputPath('chosen-export-directory'); await mkdir(directory, { recursive: true });
  const videoOutput = join(directory, 'temporary-override.mp4');
  const subtitleOutputs = ['srt', 'ass', 'vtt'].map((format) => join(directory, `current-subtitles.${format}`));
  const userData = info.outputPath('isolated-user-data'); let app: ElectronApplication | undefined;
  try {
    const initial = await launchApp(userData, [input], [], { APP_E2E_EXPORT_DIRECTORIES: JSON.stringify([directory, '']) }); app = initial.app; let page = initial.page;
    await page.getByRole('button', { name: '＋ 导入视频', exact: true }).click(); await seedManualCue(page);
    await page.getByRole('button', { name: '导出设置', exact: true }).click();
    await expect(page.getByLabel('视频编码', { exact: true })).toHaveValue('original');
    await expect(page.getByLabel('导出分辨率', { exact: true })).toHaveValue('1080p');
    await expect(page.getByLabel('默认视频格式', { exact: true })).toHaveValue('mp4');
    await expect(page.getByLabel('默认字幕格式', { exact: true })).toHaveValue('srt');
    await page.getByLabel('默认视频格式', { exact: true }).selectOption('mkv');
    await page.getByLabel('视频编码', { exact: true }).selectOption('h265');
    await page.getByLabel('导出分辨率', { exact: true }).selectOption('480p');
    await page.getByLabel('画质', { exact: true }).selectOption('high');
    await page.getByLabel('默认字幕格式', { exact: true }).selectOption('vtt');
    await page.getByRole('button', { name: '选择默认导出位置', exact: true }).click();
    await expect(page.getByLabel('默认导出位置', { exact: true })).toHaveValue(directory);
    await expect(page.getByLabel('视频编码', { exact: true })).toHaveValue('h265');
    await page.getByRole('button', { name: '选择默认导出位置', exact: true }).click();
    await expect(page.getByRole('button', { name: '选择默认导出位置', exact: true })).toBeEnabled();
    await expect(page.getByLabel('默认导出位置', { exact: true })).toHaveValue(directory);
    await expect(page.getByLabel('导出分辨率', { exact: true })).toHaveValue('480p');
    // Real directory write failure surfaces in UI and keeps the settings draft.
    const movedDirectory = info.outputPath('temporary-export-directory'); await rename(directory, movedDirectory); await writeFile(directory, 'existing directory obstacle');
    await page.getByRole('button', { name: '保存导出设置', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/无法|权限|目录/);
    await expect(page.getByLabel('视频编码', { exact: true })).toHaveValue('h265');
    expect(await readFile(directory, 'utf8')).toBe('existing directory obstacle');
    await unlink(directory); await rename(movedDirectory, directory);
    await page.getByRole('button', { name: '保存导出设置', exact: true }).click();
    await expect(page.getByText('导出默认设置已保存。', { exact: true })).toBeVisible();
    const evidence = resolve('.trellis/tasks/10-07-video-translation-subtitles/evidence'); await mkdir(evidence, { recursive: true });
    await page.getByRole('dialog', { name: '导出设置', exact: true }).screenshot({ path: join(evidence, 'export-settings-anonymous.png') });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    const saved = await page.evaluate(() => window.api.exportSettings.status()); if (!saved.success) throw new Error(saved.error);
    expect(saved.data).toMatchObject({ directory, videoFormat: 'mkv', videoCodec: 'h265', resolution: '480p', quality: 'high', subtitleFormat: 'vtt' });
    const downloadSettings = await page.evaluate(() => window.api.download.status()); if (!downloadSettings.success) throw new Error(downloadSettings.error);
    expect(downloadSettings.data.settings.directory).not.toBe(directory);
    await app.close(); app = undefined;
    const restarted = await launchApp(userData, [], [videoOutput, ...subtitleOutputs]); app = restarted.app; page = restarted.page;
    await openExport(page);
    await expect(page.getByLabel('导出格式', { exact: true })).toHaveValue('mkv');
    await expect(page.getByLabel('视频编码', { exact: true })).toHaveValue('h265');
    await page.getByLabel('导出格式', { exact: true }).selectOption('mp4');
    await page.getByLabel('视频编码', { exact: true }).selectOption('h264');
    await page.getByLabel('导出分辨率', { exact: true }).selectOption('original');
    await page.getByLabel('画质', { exact: true }).selectOption('small'); await finishExport(page);
    expect(await inspect(videoOutput)).toMatchObject({ width: 640, height: 360, codec: 'h264', subtitleTracks: 0 }); await assertSubtitlePixels(videoOutput);
    const persisted = await page.evaluate(() => window.api.exportSettings.status()); expect(persisted).toEqual(saved);
    // Actual inline CRUD modifies both timing/text, inserts and removes a cue.
    await page.getByLabel('编辑字幕 1', { exact: true }).click();
    await page.getByLabel('开始时间（秒）', { exact: true }).fill('.234'); await page.getByLabel('结束时间（秒）', { exact: true }).fill('1.678');
    await page.getByLabel('原文', { exact: true }).fill('Corrected original'); await page.getByLabel('译文', { exact: true }).fill('精确校对译文');
    await page.getByRole('button', { name: '保存字幕', exact: true }).click(); await expect(page.locator('.segment-editor')).toHaveCount(0);
    await page.getByRole('button', { name: '＋ 添加字幕', exact: true }).click();
    await page.getByLabel('开始时间（秒）', { exact: true }).fill('2'); await page.getByLabel('结束时间（秒）', { exact: true }).fill('3'); await page.getByLabel('原文', { exact: true }).fill('Removed cue');
    await page.getByRole('button', { name: '保存字幕', exact: true }).click(); await expect(page.locator('.segment-editor')).toHaveCount(0);
    await page.getByLabel('删除字幕 2', { exact: true }).click(); await expect(page.locator('.subtitle-row')).toHaveCount(1);
    // Moving only this synthetic source proves standalone export does not need decoding/ASR.
    const moved = info.outputPath('temporarily-moved-source.mp4'); await rename(input, moved);
    try {
      for (const format of ['srt', 'ass', 'vtt']) {
        await openExport(page, true); await expect(page.getByLabel('导出格式', { exact: true })).toHaveValue('vtt');
        await expect(page.getByLabel('视频编码', { exact: true })).toHaveCount(0);
        await page.getByLabel('导出格式', { exact: true }).selectOption(format); await finishExport(page);
        const text = await readFile(join(directory, `current-subtitles.${format}`), 'utf8');
        expect(text).toContain('精确校对译文'); expect(text).not.toContain('Removed cue');
        if (format === 'srt') expect(text).toContain('00:00:00,234 --> 00:00:01,678');
        if (format === 'vtt') expect(text).toContain('00:00:00.234 --> 00:00:01.678');
        if (format === 'ass') { expect(text).toContain('0:00:00.23,0:00:01.68'); expect(text).toContain('Noto Sans CJK SC'); }
      }
    } finally { await rename(moved, input); }
    const dialogs = z.array(z.object({ defaultPath: z.string(), format: z.string() })).parse(JSON.parse(await readFile(join(userData, 'export-dialogs.json'), 'utf8')) as unknown);
    expect(dialogs).toHaveLength(4);
    for (const dialog of dialogs) expect(dirname(dialog.defaultPath)).toBe(directory);
    expect(dialogs.map((dialog) => dialog.format)).toEqual(['mp4', 'srt', 'ass', 'vtt']);
    await assertNoAI(page); expect(await hash(input)).toBe(sourceHash);
  } finally { await app?.close(); }
});

test('actual Electron video export matrix verifies MP4/MKV, original/H264/H265, every resolution and quality, subtitle pixels and no upscaling', async ({ playwright: _p }, info) => {
  test.setTimeout(240000);
  const input = info.outputPath('anonymous-h264-1080.mp4'); await makeSource(input, 'h264'); const sourceHash = await hash(input);
  const rows: { format: 'mp4' | 'mkv'; codec: ExportSettings['videoCodec']; resolution: ExportSettings['resolution']; quality: ExportSettings['quality']; width: number; height: number }[] = [
    { format: 'mp4', codec: 'original', resolution: '1080p', quality: 'balanced', width: 1920, height: 1080 },
    { format: 'mkv', codec: 'original', resolution: 'original', quality: 'small', width: 1920, height: 1080 },
    { format: 'mp4', codec: 'h264', resolution: '360p', quality: 'high', width: 640, height: 360 },
    { format: 'mkv', codec: 'h264', resolution: '480p', quality: 'balanced', width: 852, height: 480 },
    { format: 'mp4', codec: 'h265', resolution: '720p', quality: 'small', width: 1280, height: 720 },
    { format: 'mkv', codec: 'h265', resolution: '1440p', quality: 'high', width: 1920, height: 1080 },
    { format: 'mp4', codec: 'h264', resolution: '2160p', quality: 'balanced', width: 1920, height: 1080 },
  ];
  const outputs = rows.map((row, index) => info.outputPath(`matrix-${index}.${row.format}`));
  const hevc = info.outputPath('anonymous-original-hevc.mp4'); await makeSource(hevc, 'h265', '640x360'); const hevcHash = await hash(hevc);
  const hevcOutputs = ['mp4', 'mkv'].map((format) => info.outputPath(`original-hevc.${format}`));
  const { app, page } = await launchApp(info.outputPath('isolated-matrix-user-data'), [input, hevc], [...outputs, ...hevcOutputs]);
  const observed: unknown[] = [];
  try {
    await page.getByRole('button', { name: '＋ 导入视频', exact: true }).click(); await seedManualCue(page);
    for (const [index, row] of rows.entries()) {
      await openExport(page); await page.getByLabel('导出格式', { exact: true }).selectOption(row.format);
      await page.getByLabel('视频编码', { exact: true }).selectOption(row.codec); await page.getByLabel('导出分辨率', { exact: true }).selectOption(row.resolution); await page.getByLabel('画质', { exact: true }).selectOption(row.quality);
      await finishExport(page); const path = outputs[index]; if (!path) throw new Error('Output absent');
      const result = await inspect(path); expect(result).toMatchObject({ width: row.width, height: row.height, codec: row.codec === 'h265' ? 'hevc' : 'h264', subtitleTracks: 0 });
      expect(result.format).toContain(row.format === 'mp4' ? 'mp4' : 'matroska'); await assertSubtitlePixels(path); observed.push({ ...row, ...result });
    }
    await page.getByRole('button', { name: '＋ 导入视频', exact: true }).click(); await seedManualCue(page);
    for (const [index, format] of ['mp4', 'mkv'].entries()) {
      await openExport(page); await page.getByLabel('导出格式', { exact: true }).selectOption(format);
      await expect(page.getByLabel('视频编码', { exact: true })).toHaveValue('original'); await expect(page.getByLabel('导出分辨率', { exact: true })).toHaveValue('1080p'); await finishExport(page);
      const path = hevcOutputs[index]; if (!path) throw new Error('HEVC output absent'); const result = await inspect(path);
      expect(result).toMatchObject({ width: 640, height: 360, codec: 'hevc', subtitleTracks: 0 }); await assertSubtitlePixels(path); observed.push({ source: 'hevc', selectedCodec: 'original', selectedFormat: format, ...result });
    }
    expect(await hash(input)).toBe(sourceHash); expect(await hash(hevc)).toBe(hevcHash); await assertNoAI(page);
    const directory = resolve('.trellis/tasks/10-07-video-translation-subtitles/evidence'); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'export-settings-matrix.json'), JSON.stringify({ fixture: 'Generated anonymous H264/HEVC media and isolated userData', realFFmpeg: true, noAI: true, sourceHashesUnchanged: true, observed }, null, 2));
  } finally { await app.close(); }
});

test('unsupported original codec, destination/source protection, native save cancellation and actual encode cancellation preserve existing bytes and subtitles', async ({ playwright: _p }, info) => {
  test.setTimeout(180000);
  const input = info.outputPath('anonymous-mpeg4.mp4'); await makeSource(input, 'mpeg4', '640x360'); const sourceHash = await hash(input);
  const unsupported = info.outputPath('unsupported.mp4'); const recovered = info.outputPath('recovered.mp4'); const existing = info.outputPath('existing.mp4'); await writeFile(existing, 'existing untouched file');
  const long = info.outputPath('anonymous-cancel.mp4'); await makeSource(long, 'h264', '1920x1080', '60'); const longHash = await hash(long); const cancelled = info.outputPath('cancelled.mkv');
  const userData = info.outputPath('isolated-errors-data');
  const { app, page } = await launchApp(userData, [input, long], [unsupported, recovered, existing, input, '', cancelled]);
  try {
    await page.getByRole('button', { name: '＋ 导入视频', exact: true }).click(); await seedManualCue(page);
    await openExport(page); await page.getByRole('button', { name: '选择保存位置并导出', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/H.264.*H.265/);
    expect(await stat(unsupported).catch(() => undefined)).toBeUndefined();
    await page.getByLabel('视频编码', { exact: true }).selectOption('h264'); await finishExport(page);
    expect((await inspect(recovered)).codec).toBe('h264'); await assertSubtitlePixels(recovered);
    await openExport(page); await page.getByLabel('视频编码', { exact: true }).selectOption('h264'); await page.getByRole('button', { name: '选择保存位置并导出', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/已存在|覆盖/); expect(await readFile(existing, 'utf8')).toBe('existing untouched file');
    await page.getByRole('button', { name: '返回工作区', exact: true }).click();
    await openExport(page); await page.getByLabel('视频编码', { exact: true }).selectOption('h264'); await page.getByRole('button', { name: '选择保存位置并导出', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('不能覆盖原视频'); expect(await hash(input)).toBe(sourceHash);
    await page.getByRole('button', { name: '返回工作区', exact: true }).click();
    // Native save cancellation returns null and does not start another stage.
    await openExport(page); const before = await page.evaluate(() => window.api.jobs.list()); await page.getByRole('button', { name: '选择保存位置并导出', exact: true }).click();
    await expect(page.getByRole('button', { name: '选择保存位置并导出', exact: true })).toBeEnabled();
    await expect(page.getByRole('dialog', { name: '导出作品', exact: true })).toBeVisible(); expect(await page.evaluate(() => window.api.jobs.list())).toEqual(before);
    await page.getByRole('button', { name: '返回工作区', exact: true }).click();
    await page.getByRole('button', { name: '＋ 导入视频', exact: true }).click(); await seedManualCue(page, 14000);
    await openExport(page); await page.getByLabel('导出格式', { exact: true }).selectOption('mkv'); await page.getByLabel('视频编码', { exact: true }).selectOption('h265');
    await page.getByRole('button', { name: '选择保存位置并导出', exact: true }).click();
    await page.getByRole('button', { name: '返回工作区', exact: true }).click();
    await expect.poll(async () => { const files = await readdir(info.outputDir); const partials = files.filter((name) => name.startsWith('.slice-') && name.endsWith('.mkv')); const sizes = await Promise.all(partials.map((name) => stat(join(info.outputDir, name)).then((value) => value.size).catch(() => 0))); return Math.max(0, ...sizes); }, { timeout: 30000, intervals: [50, 100, 250] }).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: '取消当前处理', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消当前处理', exact: true }).click();
    await expect(page.locator('.stage-pill').filter({ hasText: '导出' })).toContainText('已取消');
    expect(await stat(cancelled).catch(() => undefined)).toBeUndefined();
    await expect.poll(() => readdir(info.outputDir).then((files) => files.filter((name) => name.startsWith('.slice-') || name.startsWith('.slice-stage-')))).toEqual([]);
    await expect(page.getByTestId('segment-0')).toContainText('最终译文'); expect(await hash(long)).toBe(longHash); expect(await hash(input)).toBe(sourceHash); await assertNoAI(page);
  } finally { await app.close(); }
});
