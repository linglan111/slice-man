import { vi } from 'vitest';
import { DEFAULT_STYLE, optionsSchema, type AppApi, type Job, type ProgressEvent } from '../../../src/shared/contracts';
import { downloadSettingsSchema } from '../../../src/shared/download-contracts';
import type { ExportSettings } from '../../../src/shared/export-contracts';

export const SAVED_EXPORT_SETTINGS: ExportSettings = { directory: 'F:/anonymous-exports', videoFormat: 'mp4', videoCodec: 'original', resolution: '1080p', quality: 'balanced', subtitleFormat: 'srt' };

export function savedJob(): Job {
  const succeeded = { state: 'succeeded' as const, progress: 1, message: '' };
  return {
    id: 'saved-job', name: 'Anonymous video', inputPath: 'anonymous.mp4', revision: 7, createdAt: 1, updatedAt: 7,
    media: { durationMs: 4000, width: 640, height: 360, hasAudio: true, audioOffsetMs: 0, rotation: 0, sampleAspectRatio: '1:1' },
    options: optionsSchema.parse({ translationProfileId: 'text-profile' }),
    segments: [{ id: 'old-cue', startMs: 100, endMs: 1800, sourceText: 'Corrected original.', translatedText: '人工校对译文。', translationStale: false }],
    style: { ...structuredClone(DEFAULT_STYLE), emphasisBySegment: [{ segmentId: 'old-cue', keywords: ['人工'] }] },
    stages: { recognize: { ...succeeded }, translate: { ...succeeded }, style: { ...succeeded }, preview: { ...succeeded }, export: { ...succeeded } }, outputs: ['previous-export.srt'],
  };
}

export function stubApi(job: Job): { api: AppApi; progress: (next: Job) => void } {
  if (typeof ResizeObserver === 'undefined') vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
  let handler: ((event: ProgressEvent) => void) | undefined;
  const api: AppApi = {
    exportSettings: { status: vi.fn().mockResolvedValue({ success: true, data: { ...SAVED_EXPORT_SETTINGS } }), saveSettings: vi.fn(), chooseDirectory: vi.fn().mockResolvedValue({ success: true, data: null }) },
    profiles: { list: vi.fn().mockResolvedValue({ success: true, data: [] }), save: vi.fn(), remove: vi.fn(), test: vi.fn() },
    runtime: { status: vi.fn().mockResolvedValue({ success: true, data: { installed: true, cpuReady: true, gpuReady: false, actualBackend: 'cpu', message: 'CPU ready', installedModels: ['base'], totalMemoryGb: 16, catalog: [] } }), install: vi.fn(), cancel: vi.fn() },
    download: { status: vi.fn().mockResolvedValue({ success: true, data: { ready: false, version: '2026.08.19', denoVersion: '2.9.7', sizeBytes: 60470620, settings: downloadSettingsSchema.parse({ proxy: '' }), defaultDirectory: 'anonymous-downloads', state: 'idle', progress: 0, message: '' } }), saveSettings: vi.fn(), chooseDirectory: vi.fn().mockResolvedValue({ success: true, data: null }), install: vi.fn(), importUrl: vi.fn(), cancel: vi.fn() },
    onDownloadStatus: vi.fn(() => vi.fn()),
    jobs: {
      list: vi.fn().mockResolvedValue({ success: true, data: [job] }), get: vi.fn(), importVideo: vi.fn(), updateOptions: vi.fn(), recognize: vi.fn(), recognizeAgain: vi.fn(), translate: vi.fn(),
      planReprocess: vi.fn(), recognizePartial: vi.fn(), translatePartial: vi.fn(), reviewSubtitles: vi.fn(), acknowledgeFinding: vi.fn(),
      editSegment: vi.fn(), addSegment: vi.fn(), removeSegment: vi.fn(), setStyle: vi.fn(), designStyle: vi.fn(), preview: vi.fn(), playback: vi.fn().mockResolvedValue({ success: true, data: { url: '' } }), export: vi.fn(), cancel: vi.fn(),
    },
    onProgress: vi.fn((nextHandler) => { handler = nextHandler; return vi.fn(); }),
  };
  vi.stubGlobal('api', api);
  return { api, progress: (next) => handler?.({ stage: 'recognize', progress: 1, message: '', job: next }) };
}
