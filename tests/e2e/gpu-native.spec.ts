import { jobSetting, workspaceButton } from './helpers';
import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { addProfile, launchApp, makeVideo, saveEvidence, startMockServer, importVideo } from './helpers';
import { gpuAvailability, readBackendReceipt, seedVerifiedGpu } from './gpu-helpers';
import { ENGINE_VERSION } from '../../src/main/services/runtime/manifest';
import type { Job } from '../../src/shared/contracts';

async function currentJobs(page: Page): Promise<Job[]> {
  const result = await page.evaluate(() => window.api.jobs.list());
  if (!result.success) throw new Error(`Ordinary jobs IPC failed: ${result.code}`);
  return result.data;
}

test('actual CUDA desktop recognition and explicit CPU selection report each real inference backend', async ({ playwright: _playwright }, testInfo) => {
  test.setTimeout(240000);
  const availability = await gpuAvailability();
  if (!availability.available) { test.skip(true, availability.reason); return; }
  const userData = testInfo.outputPath('gpu-user-data');
  const hashes = await seedVerifiedGpu(userData, availability.device);
  const input = testInfo.outputPath('public-jfk.mp4');
  await makeVideo(input, true);
  const mock = await startMockServer();
  const { app, page } = await launchApp(userData, [input, input], []);
  const results = [];
  try {
    await addProfile(page, 'Local mock translator', 'openai', mock.url);
    for (const backend of ['gpu', 'cpu'] as const) {
      const previousIds = new Set((await currentJobs(page)).map((job) => job.id));
      await importVideo(page);
      await expect((await jobSetting(page, '识别方式'))).toHaveValue('local');
      const preference = (await jobSetting(page, '优先使用 NVIDIA GPU'));
      await expect(preference).toBeChecked();
      if (backend === 'cpu') { await preference.click(); await expect(preference).not.toBeChecked(); }
      await (await jobSetting(page, '原语言')).selectOption('en');
      await (await jobSetting(page, '翻译服务')).selectOption({ label: 'Local mock translator' });
      await expect((await workspaceButton(page, '一键生成字幕'))).toBeEnabled();
      const startedAt = Date.now();
      await (await workspaceButton(page, '一键生成字幕')).click();
      await expect(page.getByTestId('segment-0')).toContainText(/country|fellow/i, { timeout: 90000 });
      await expect((await workspaceButton(page, '翻译全部字幕'))).toBeEnabled({ timeout: 90000 });
      await expect(page.getByRole('heading', { level: 1 }).locator('..')).toContainText(`识别后端 ${backend.toUpperCase()}`);
      const job = (await currentJobs(page)).find((item) => !previousIds.has(item.id));
      if (!job) throw new Error('Imported native inference job is missing from real IPC history.');
      expect(job.options.preferGpu).toBe(backend === 'gpu');
      expect(job.actualBackend).toBe(backend);
      expect(job.stages.recognize.state).toBe('succeeded');
      expect(job.stages.translate.state).toBe('succeeded');
      const receipt = await readBackendReceipt(userData, job.id);
      expect(receipt.backend).toBe(backend);
      expect(receipt.gpuExecutionVerified).toBe(backend === 'gpu');
      if (backend === 'gpu') expect(receipt.stderrProof).toMatch(/CUDA0\s+(?:total size|compute buffer|model buffer)/i);
      else expect(receipt.stderrProof).toBe('');
      results.push({ backend, wallTimeMs: Date.now() - startedAt, segments: job.segments.length, receipt });
      await saveEvidence(page, `desktop-real-${backend}-selected-recognition.png`);
    }
    expect(mock.counters.recognition).toBe(0);
    expect(mock.counters.translation).toBe(2);
    const evidence = { device: availability.device, engineVersion: ENGINE_VERSION, model: 'base', modelBytes: 147951465, pinnedSha256: hashes, seed: 'Physically extracted integrity-checked official archives and model inside normal isolated userData; installation readiness reused, every job runs actual native recognition.', ai: 'Loopback HTTP translation mock only; no cloud speech or paid requests.', results };
    const directory = resolve('.trellis/tasks/10-11-subtitle-workspace-layout/evidence');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'gpu-desktop-result.json'), JSON.stringify(evidence, null, 2));
    await testInfo.attach('actual-native-backend-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  } finally { await app.close(); await mock.close(); }
});
