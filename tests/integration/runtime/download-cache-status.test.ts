import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipFile } from 'yazl';
import type { DownloadStatus } from '../../../src/shared/contracts';
const mocks = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock('../../../src/main/lib/process', () => ({ runProcess: mocks.process }));
import { DownloadService } from '../../../src/main/services/download/lib/download-service';

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {server.closeAllConnections(); server.close(() => resolve());})));
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});
async function fixture(slow = false): Promise<{root: string; service: DownloadService; events: DownloadStatus[]; requests: string[]; setPause: (value: boolean) => void}> {
  const root = await mkdtemp(join(tmpdir(), 'slice-tool-cache-result-')); roots.push(root);
  const tool = Buffer.alloc(131072, 37);
  const zip = new ZipFile(); zip.addBuffer(Buffer.from('fixture-deno'), 'deno.exe');
  const buffers: Buffer[] = []; zip.outputStream.on('data', (chunk: Buffer) => buffers.push(chunk));
  const complete = new Promise<void>((resolve) => zip.outputStream.on('end', () => resolve())); zip.end(); await complete;
  const deno = Buffer.concat(buffers); const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? ''); const content = request.url === '/deno' ? deno : tool;
    response.writeHead(200, {'Content-Length': content.length});
    if (slow && request.url === '/tool') response.write(content.subarray(0, 8192)); else response.end(content);
  }); servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
  const artifact = (path: string, content: Buffer): {url: string; sizeBytes: number; sha256: string} => ({url: `http://127.0.0.1:${address.port}/${path}`, sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex')});
  mocks.process.mockImplementation(async (exe: string) => ({stdout: exe.endsWith('deno.exe') ? 'deno fixture (stable)' : 'fixture\n', stderr: ''}));
  const events: DownloadStatus[] = []; let pause = false;
  const service = new DownloadService({root, ffmpeg: 'unused', ffprobe: 'unused', importVideo: vi.fn(), probe: vi.fn(), artifacts: {version: 'fixture', denoVersion: 'fixture', ytdlp: artifact('tool', tool), deno: artifact('deno', deno)}, emit: (value) => {events.push(structuredClone(value)); if (pause && value.state === 'installing' && value.progress > 0) service.cancel();}});
  return {root, service, events, requests, setPause: (value) => {pause = value;}};
}
describe('managed tool final cache status contract', () => {
  it('returns the latest cache-bearing success snapshot rather than overwriting its final status event', async () => {
    const f = await fixture(); const result = await f.service.install();
    expect(result.state).toBe('succeeded'); expect(result.ready).toBe(true);
    expect(result.downloadCache?.assets.map((asset) => [asset.id, asset.state])).toEqual([['yt-dlp', 'verified'], ['deno', 'verified']]);
    expect(result).toEqual(f.events.at(-1));
    const requestCount = f.requests.length; const second = await f.service.install();
    expect(second.downloadCache).toEqual(result.downloadCache); expect(f.requests).toHaveLength(requestCount);
  });
  it('emits retained cache bytes as the final cancellation event before releasing its operation lease', async () => {
    const f = await fixture(true); f.setPause(true);
    await expect(f.service.install()).rejects.toMatchObject({code: 'CANCELLED'});
    expect(f.events.at(-1)).toMatchObject({state: 'cancelled', downloadCache: {totalBytes: 8192, assets: [{id: 'yt-dlp', state: 'partial', downloadedBytes: 8192}]}});
    expect(() => f.service.assertIdle()).not.toThrow();
  });
  it('emits complete reusable cache on failed replacement and preserves the previously activated tools', async () => {
    const f = await fixture(); await f.service.install();
    const pointer = join(f.root, 'download-tools', 'active.json'); const before = await readFile(pointer, 'utf8');
    mocks.process.mockResolvedValue({stdout: 'wrong version', stderr: ''});
    await expect(f.service.install()).rejects.toMatchObject({code: 'INSTALL_VERSION'});
    expect(f.events.at(-1)?.downloadCache?.assets.every((asset) => asset.state === 'verified')).toBe(true);
    expect(f.events.at(-1)?.downloadCache?.assets).toHaveLength(2); expect(await readFile(pointer, 'utf8')).toBe(before);
    expect(() => f.service.assertIdle()).not.toThrow();
  });
});
