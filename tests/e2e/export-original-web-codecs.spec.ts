import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { FFMPEG, FFPROBE, launchApp } from './helpers';

const execute = promisify(execFile);

test('default original encoding burns subtitles into actual AV1 MP4 and VP9/VP8 MKV without upscaling or AI', async ({ playwright: _p }, info) => {
  test.setTimeout(180000);
  const rows = [
    { codec: 'av1', encoder: 'libaom-av1', format: 'mp4', options: ['-cpu-used', '8', '-crf', '35', '-b:v', '0'] },
    { codec: 'vp9', encoder: 'libvpx-vp9', format: 'mkv', options: ['-deadline', 'realtime', '-cpu-used', '8', '-crf', '35', '-b:v', '0'] },
    { codec: 'vp8', encoder: 'libvpx', format: 'mkv', options: ['-deadline', 'realtime', '-cpu-used', '8', '-b:v', '500k'] },
  ];
  const sources: string[] = []; const hashes: string[] = [];
  for (const row of rows) {
    const input = info.outputPath(`anonymous-${row.codec}.${row.format}`); sources.push(input);
    await execute(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x182b3e:s=320x180:r=10', '-t', '1', '-c:v', row.encoder, ...row.options, '-threads', '2', '-pix_fmt', 'yuv420p', input], { windowsHide: true });
    hashes.push(createHash('sha256').update(await readFile(input)).digest('hex'));
  }
  const outputs = rows.map((row) => info.outputPath(`burned-original-${row.codec}.${row.format}`));
  const { app, page } = await launchApp(info.outputPath('isolated-web-codec-user-data'), sources, outputs);
  const observed: unknown[] = [];
  try {
    for (const [index, row] of rows.entries()) {
      await page.getByRole('button', { name: '＋ 导入视频', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(`anonymous-${row.codec}.${row.format}`);
      await page.evaluate(async () => {
        const listed = await window.api.jobs.list(); if (!listed.success || !listed.data[0]) throw new Error('Fixture absent'); const job = listed.data[0];
        const added = await window.api.jobs.addSegment({ jobId: job.id, revision: job.revision, segment: { startMs: 100, endMs: 900, sourceText: 'Anonymous caption', translatedText: '原编码字幕' } });
        if (!added.success) throw new Error(added.error);
        // The tiny codec fixture uses a readable supported font size so pixel
        // evidence tests glyph burn-in instead of subpixel text at 180p.
        const styled = await window.api.jobs.setStyle({ jobId: job.id, style: { ...added.data.style, fontSizeRatio: .08 } });
        if (!styled.success) throw new Error(styled.error);
      });
      await expect(page.getByTestId('segment-0')).toContainText('原编码字幕');
      await page.getByRole('button', { name: '导出作品 ↗', exact: true }).click();
      await expect(page.getByLabel('视频编码', { exact: true })).toHaveValue('original');
      await expect(page.getByLabel('导出分辨率', { exact: true })).toHaveValue('1080p');
      if (row.format === 'mp4') await expect(page.getByLabel('导出格式', { exact: true })).toHaveValue('mp4');
      else await page.getByLabel('导出格式', { exact: true }).selectOption(row.format);
      await page.getByRole('button', { name: '选择保存位置并导出', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '导出作品', exact: true })).not.toBeVisible({ timeout: 90000 });
      const output = outputs[index]; const input = sources[index]; if (!output || !input) throw new Error('Fixture paths absent');
      const probe = await execute(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { windowsHide: true });
      const inspected = z.object({ streams: z.array(z.object({ codec_type: z.string(), codec_name: z.string(), width: z.number().optional(), height: z.number().optional() }).passthrough()), format: z.object({ format_name: z.string() }).passthrough() }).parse(JSON.parse(probe.stdout) as unknown);
      expect(inspected.streams.find((stream) => stream.codec_type === 'video')).toMatchObject({ codec_name: row.codec, width: 320, height: 180 });
      expect(inspected.streams.filter((stream) => stream.codec_type === 'subtitle')).toHaveLength(0);
      expect(inspected.format.format_name).toContain(row.format === 'mp4' ? 'mp4' : 'matroska');
      const frame = await execute(FFMPEG, ['-v', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', '-vf', 'crop=iw:ih/2:0:ih/2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', windowsHide: true, maxBuffer: 2_000_000 });
      let pixels = 0; for (let position = 0; position < frame.stdout.length; position += 3) if ((frame.stdout[position] ?? 0) > 180 && (frame.stdout[position + 1] ?? 0) > 180 && (frame.stdout[position + 2] ?? 0) > 180) pixels++;
      expect(pixels, 'Preserving original codec still burns visible subtitle pixels').toBeGreaterThan(20);
      expect(createHash('sha256').update(await readFile(input)).digest('hex')).toBe(hashes[index]);
      const jobs = await page.evaluate(() => window.api.jobs.list()); if (!jobs.success) throw new Error(jobs.error);
      expect(jobs.data.every((job) => !job.actualBackend && !job.options.translationProfileId && job.stages.translate.state === 'idle')).toBe(true);
      observed.push({ codec: row.codec, format: row.format, width: 320, height: 180, subtitlePixels: pixels, sourceHashUnchanged: true });
    }
    const directory = resolve('.trellis/tasks/10-07-video-translation-subtitles/evidence'); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'export-original-web-codecs.json'), JSON.stringify({ generatedAnonymousMedia: true, isolatedUserData: true, realFFmpeg: true, noAI: true, observed }, null, 2));
  } finally { await app.close(); }
});
