import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { CPU_ARTIFACT, GPU_ARTIFACT, MODELS, ENGINE_VERSION } from '../../src/main/services/runtime/manifest';

const execute = promisify(execFile);
const cache = resolve('.runtime-cache/whisper');
type Device = { name: string; driver: string };
type Availability = { available: true; device: Device } | { available: false; reason: string };

export async function gpuAvailability(): Promise<Availability> {
  if (process.platform !== 'win32' || process.arch !== 'x64') return { available: false, reason: 'Actual CUDA desktop E2E requires Windows x64.' };
  for (const name of ['cpu.zip', 'cuda.zip', 'ggml-base.bin', 'jfk.wav']) {
    try { await access(join(cache, name)); }
    catch { return { available: false, reason: `Pinned native E2E asset is absent: ${name}; run test:whisper to prepare actual resources.` }; }
  }
  try {
    const result = await execute('nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader'], { windowsHide: true, timeout: 10000 });
    const [name, driver] = (result.stdout.trim().split(/\r?\n/)[0] ?? '').split(',').map((item) => item.trim());
    if (!name || !driver || !name.includes('NVIDIA')) return { available: false, reason: 'nvidia-smi did not report an actual NVIDIA device and driver.' };
    return { available: true, device: { name, driver } };
  } catch { return { available: false, reason: 'Actual NVIDIA driver/device is unavailable (nvidia-smi failed).' }; }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function seedVerifiedGpu(userData: string, device: Device): Promise<{ cpu: string; gpu: string; model: string }> {
  const hashes = { cpu: '', gpu: '', model: '' };
  for (const [key, name, artifact] of [
    ['cpu', 'cpu.zip', CPU_ARTIFACT], ['gpu', 'cuda.zip', GPU_ARTIFACT], ['model', 'ggml-base.bin', MODELS.base],
  ] as const) {
    const path = join(cache, name);
    hashes[key] = await sha256(path);
    if (hashes[key] !== artifact.sha256 || (await stat(path)).size !== artifact.sizeBytes) throw new Error(`Pinned ${name} integrity check failed; refusing native GPU seed.`);
  }
  const root = resolve(userData);
  await mkdir(root, { recursive: true });
  const cpuDirectory = join(root, 'seed-cpu');
  const gpuDirectory = join(root, 'seed-gpu');
  // Extract the hashed official archives, rather than trusting a previously extracted tree.
  // Every executable/DLL/model lives physically inside this isolated normal installation root.
  for (const [archive, destination] of [[join(cache, 'cpu.zip'), cpuDirectory], [join(cache, 'cuda.zip'), gpuDirectory]]) {
    await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:GPU_E2E_ARCHIVE -DestinationPath $env:GPU_E2E_DESTINATION -Force'], {
      windowsHide: true, timeout: 120000, env: { ...process.env, GPU_E2E_ARCHIVE: archive, GPU_E2E_DESTINATION: destination },
    });
  }
  const modelPath = join(root, 'ggml-base.bin');
  await copyFile(join(cache, 'ggml-base.bin'), modelPath);
  if (await sha256(modelPath) !== MODELS.base.sha256) throw new Error('Copied model integrity check failed.');
  await writeFile(join(root, 'runtime-state.json'), JSON.stringify({
    version: 1, engineVersion: ENGINE_VERSION, cpuDirectory, gpuDirectory, gpuReady: true, gpuName: device.name,
    message: 'E2E 已校验的实际 CPU/CUDA 安装资源；每次识别须独立验证实际后端。',
    models: { base: { path: modelPath, size: MODELS.base.sizeBytes } },
  }));
  return hashes;
}

const receiptSchema = z.object({ backend: z.enum(['cpu', 'gpu']), gpuExecutionVerified: z.boolean(), stderrProof: z.string().max(4000) }).strict();
export async function readBackendReceipt(userData: string, jobId: string): Promise<z.infer<typeof receiptSchema>> {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) throw new Error('Unsafe job ID in test receipt path.');
  return receiptSchema.parse(JSON.parse(await readFile(join(userData, 'jobs', jobId, 'recognition-backend.json'), 'utf8')) as unknown);
}
