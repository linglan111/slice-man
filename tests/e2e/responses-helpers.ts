import { expect, type Page } from '@playwright/test';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import type { Job } from '../../src/shared/contracts';
import type { ProviderDiagnostic } from '../../src/shared/provider-diagnostics-contracts';
import { parseJson } from '../../src/main/services/providers/lib/text-provider';
import { startMockServer } from './helpers';

export const REASONING_MARKER = 'PRIVATE_RESPONSES_REASONING_NEVER_PERSIST';
type Operation = 'chapters' | 'review' | 'names';
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid fixture JSON object');
  return value as JsonObject;
}
async function body(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 100000) throw new Error('Synthetic request exceeds fixture limit');
    chunks.push(bytes);
  }
  return object(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
}
function operationOf(payload: JsonObject): Operation {
  const prompt = typeof payload.input === 'string' ? payload.input : '';
  if (prompt.startsWith('Divide the video into content chapters')) return 'chapters';
  if (prompt.startsWith('Analyze recurring PERSON names')) return 'names';
  if (prompt.startsWith('Review subtitle')) return 'review';
  throw new Error('Only the three authorized synthetic text operations are allowed');
}
async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Responses fixture failed to bind');
  return `http://127.0.0.1:${address.port}/v1`;
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
function failure(response: ServerResponse): void {
  if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' });
  response.end('{"error":{"message":"Synthetic Responses harness failed"}}');
}

/** Real loopback HTTP, official reasoning-first item order and two text content parts. */
export async function startReasoningResponses(): Promise<{url: string; counts: Record<Operation, number>; close(): Promise<void>}> {
  const upstream = await startMockServer();
  upstream.behavior.review = 'empty';
  const counts: Record<Operation, number> = {chapters: 0, review: 0, names: 0};
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/v1/responses') throw new Error('Unexpected Responses path');
      const payload = await body(request);
      counts[operationOf(payload)]++;
      const result = await fetch(`${upstream.url}/responses`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
      if (!result.ok) throw new Error('Local fixture rejected synthetic request');
      const raw = object(await result.json() as unknown);
      const output = raw.output;
      if (!Array.isArray(output)) throw new Error('Fixture output absent');
      const content = object(output[0]).content;
      if (!Array.isArray(content)) throw new Error('Fixture content absent');
      const answer = object(content[0]).text;
      if (typeof answer !== 'string') throw new Error('Fixture answer absent');
      response.writeHead(200, {'Content-Type': 'text/event-stream'});
      const event = async (value: JsonObject): Promise<void> => {
        const bytes = Buffer.from(`event: ${String(value.type)}\ndata: ${JSON.stringify(value)}\n\n`);
        // Split inside every frame, including UTF-8 payloads, rather than bypassing the transport.
        for (let at = 0; at < bytes.length; at += 31) {
          if (response.destroyed) return;
          response.write(bytes.subarray(at, at + 31));
          await new Promise<void>(resolve => setTimeout(resolve, 1));
        }
      };
      const reasoning = {id: 'rs_fixture', type: 'reasoning', summary: [], content: []};
      const reasoningIdentity = {output_index: 0, item_id: 'rs_fixture', content_index: 0};
      const reasoningPart = {type: 'reasoning_text', text: REASONING_MARKER};
      const completedReasoning = {...reasoning, status: 'completed', content: [reasoningPart]};
      await event({type: 'response.created', response: {id: 'resp_fixture', status: 'in_progress', output: []}});
      await event({type: 'response.output_item.added', output_index: 0, item: reasoning});
      await event({type: 'response.content_part.added', ...reasoningIdentity, part: {type: 'reasoning_text', text: ''}});
      await event({type: 'response.reasoning_text.delta', ...reasoningIdentity, delta: REASONING_MARKER});
      await event({type: 'response.reasoning_text.done', ...reasoningIdentity, text: REASONING_MARKER});
      await event({type: 'response.content_part.done', ...reasoningIdentity, part: reasoningPart});
      await event({type: 'response.output_item.done', output_index: 0, item: completedReasoning});
      await event({type: 'response.output_item.added', output_index: 1, item: {id: 'msg_fixture', type: 'message', role: 'assistant', status: 'in_progress', content: []}});
      const characters = Array.from(answer);
      const middle = Math.floor(characters.length / 2);
      const pieces = [characters.slice(0, middle).join(''), characters.slice(middle).join('')];
      for (const [contentIndex, text] of pieces.entries()) {
        const identity = {output_index: 1, item_id: 'msg_fixture', content_index: contentIndex};
        await event({type: 'response.content_part.added', ...identity, part: {type: 'output_text', text: '', annotations: []}});
        for (let at = 0; at < text.length; at += 48) await event({type: 'response.output_text.delta', ...identity, delta: text.slice(at, at + 48)});
        await event({type: 'response.output_text.done', ...identity, text});
        await event({type: 'response.content_part.done', ...identity, part: {type: 'output_text', text, annotations: []}});
      }
      const message = {id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: pieces.map(text => ({type: 'output_text', text, annotations: []}))};
      await event({type: 'response.output_item.done', output_index: 1, item: message});
      await event({type: 'response.completed', response: {id: 'resp_fixture', status: 'completed', output: [completedReasoning, message], usage: {input_tokens: 80, output_tokens: 40, total_tokens: 120}}});
      response.end();
    })().catch(() => failure(response));
  });
  return {url: await listen(server), counts, close: async () => {await close(server); await upstream.close();}};
}

export async function currentResponsesJob(page: Page): Promise<Job> {
  return page.evaluate(async () => {
    const listed = await window.api.jobs.list();
    if (!listed.success || !listed.data[0]) throw new Error('Synthetic Responses job missing');
    return listed.data[0];
  });
}
export async function responsesDiagnostics(page: Page): Promise<ProviderDiagnostic[]> {
  return page.evaluate(async () => {
    const result = await window.api.diagnostics.list();
    if (!result.success) throw new Error('Synthetic diagnostic list unavailable');
    return result.data;
  });
}
export async function seedResponses(page: Page, profile: {baseUrl: string; model: string; apiKey: string}): Promise<void> {
  await page.evaluate(async profile => {
    const saved = await window.api.profiles.save({name: 'Synthetic Responses verification', protocol: 'openai', mode: 'responses', ...profile, sessionOnly: true, streaming: 'auto', timeoutMs: 120000, textTimeoutMs: 300000});
    if (!saved.success) throw new Error('Cannot create isolated session-only Responses profile');
    const listed = await window.api.jobs.list();
    if (!listed.success || !listed.data[0]) throw new Error('Synthetic job absent');
    let job = listed.data[0];
    const configured = await window.api.jobs.updateOptions({jobId: job.id, options: {...job.options, sourceLanguage: 'en', targetLanguage: 'zh-CN', reviewProfileId: saved.data.id, chapterProfileId: saved.data.id, translationProfileId: saved.data.id}});
    if (!configured.success) throw new Error('Cannot configure synthetic Responses job');
    job = configured.data;
    for (const cue of [
      {startMs: 100, endMs: 1800, sourceText: 'Ann arrives at the station.', translatedText: '安娜到达车站。'},
      {startMs: 2000, endMs: 3800, sourceText: 'Hello Ann, welcome home.', translatedText: '你好安娜，欢迎回家。'},
    ]) {
      const added = await window.api.jobs.addSegment({jobId: job.id, revision: job.revision, segment: cue});
      if (!added.success) throw new Error('Cannot seed synthetic subtitles');
      job = added.data;
    }
  }, profile);
  await page.reload();
  await expect(page.getByTestId('segment-1')).toBeVisible();
}
export async function runResponsesOperation(page: Page, operation: Operation): Promise<ProviderDiagnostic> {
  const previous = (await responsesDiagnostics(page)).length;
  if (operation === 'chapters') {
    await page.getByRole('toolbar', {name: '视频操作'}).getByRole('button', {name: '章节', exact: true}).click();
    await page.getByRole('button', {name: 'AI 切分章节', exact: true}).click();
  } else if (operation === 'review') {
    await page.getByRole('button', {name: 'AI 检查字幕', exact: true}).click();
  } else {
    await page.getByRole('toolbar', {name: '视频操作'}).getByRole('button', {name: '人名检查', exact: true}).click();
    await page.getByRole('button', {name: 'AI 检查人名', exact: true}).click();
  }
  await expect.poll(async () => {
    const records = await responsesDiagnostics(page);
    return records.length > previous && records.some(record => record.operation === operation && ['published', 'failed', 'cancelled'].includes(record.state));
  }, {timeout: 330000, intervals: [100, 500, 1000]}).toBe(true);
  // A failed validation record can precede the one visible correction attempt.
  // Wait for App's awaited operation to settle before taking its final outcome.
  await expect(page.getByRole('button', {name: 'AI 检查字幕', exact: true})).toBeEnabled({timeout: 330000});
  const record = (await responsesDiagnostics(page)).find(record => record.operation === operation);
  if (!record) throw new Error('Operation diagnostic absent');
  return record;
}
export async function assertResponsesArtifacts(page: Page, userData: string, records: ProviderDiagnostic[]): Promise<void> {
  for (const record of records) {
    expect(record.state, `${record.operation}: ${record.errorCode ?? 'no error'}`).toBe('published');
    expect(record).toMatchObject({mode: 'responses', protocol: 'openai', httpStatus: 200, streamActual: true});
    expect(record.textBytes).toBeGreaterThan(0);
    const preview = await page.evaluate(id => window.api.diagnostics.readAnswer(id), record.id);
    if (!preview.success) throw new Error('Normalized answer preview unavailable');
    expect(() => parseJson(preview.data.text)).not.toThrow();
    expect(preview.data.text).not.toContain(REASONING_MARKER);
    const directory = join(userData, 'ai-responses', record.id);
    const files = await readdir(directory);
    expect(files).toEqual(['answer.complete.txt']);
    const persisted = await readFile(join(directory, 'answer.complete.txt'), 'utf8');
    expect(persisted).toBe(preview.data.text);
    expect(persisted).not.toContain(REASONING_MARKER);
  }
}

export type LiveCall = {
  number: number; operation: Operation; startedAt: string; httpStatus?: number;
  protocol: 'openai'; mode: 'responses'; model: string;
  eventTypes: Record<string, number>; outputIndexes: Record<string, number>;
  contentIndexes: Record<string, number>; itemTypes: Record<string, number>;
  partTypes: Record<string, number>; partMetadataKinds: Record<string, number>;
  state?: string; errorCode?: string; streamActual?: boolean; textBytes?: number;
};
type Ledger = {version: 1; limit: 3; calls: LiveCall[]};

/** Counts only sanitized SSE metadata; never keeps data, reasoning or final text. */
function observer(call: LiveCall): (bytes: Uint8Array, final?: boolean) => void {
  const decoder = new TextDecoder();
  let pending = '';
  return (bytes, final = false) => {
    pending += decoder.decode(bytes, {stream: !final});
    for (;;) {
      const newline = pending.indexOf('\n');
      if (newline < 0) break;
      const line = pending.slice(0, newline).trimEnd(); pending = pending.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      try {
        const value = object(JSON.parse(line.slice(5).trim()) as unknown);
        const increment = (map: Record<string, number>, key: string): void => {map[key] = (map[key] ?? 0) + 1;};
        if (typeof value.type === 'string' && /^[a-z_.]{1,100}$/.test(value.type)) increment(call.eventTypes, value.type);
        if (Number.isSafeInteger(value.output_index) && Number(value.output_index) >= 0) increment(call.outputIndexes, String(value.output_index));
        if (Number.isSafeInteger(value.content_index) && Number(value.content_index) >= 0) increment(call.contentIndexes, String(value.content_index));
        if (value.item && typeof value.item === 'object') {
          const item = object(value.item);
          if (typeof item.type === 'string' && /^[a-z_]{1,40}$/.test(item.type)) increment(call.itemTypes, item.type);
        }
        if (value.part && typeof value.part === 'object') {
          const part = object(value.part);
          if (typeof part.type === 'string' && /^[a-z_]{1,40}$/.test(part.type)) increment(call.partTypes, part.type);
          // Record only the shape of known metadata. Values (especially reasoning
          // text) must never enter the durable observer ledger.
          for (const key of ['type', 'text', 'annotations', 'summary', 'reasoning_text']) {
            if (key in part) increment(call.partMetadataKinds, `${key}:${part[key] === null ? 'null' : Array.isArray(part[key]) ? 'array' : typeof part[key]}`);
          }
        }
      } catch { /* Invalid/non-JSON metadata is left for the production parser to reject. */ }
    }
    if (pending.length > 262144) pending = '';
  };
}

export async function startLiveResponsesProxy(input: {baseUrl: string; apiKey: string; ledgerPath: string}): Promise<{url: string; finish(records: ProviderDiagnostic[]): void; close(): Promise<void>}> {
  if (!isAbsolute(input.ledgerPath)) throw new Error('Live ledger must be an explicit absolute path');
  await mkdir(dirname(input.ledgerPath), {recursive: true});
  // An interrupted process deliberately leaves this lock behind. A human must
  // inspect it; never auto-reset the cumulative authorization count on restart.
  const lockPath = `${input.ledgerPath}.lock`;
  let lock: number;
  try {lock = openSync(lockPath, 'wx', 0o600);} catch {throw new Error('Live ledger is already owned or has an interrupted owner; refusing concurrent requests');}
  const releaseLock = (): void => {closeSync(lock); unlinkSync(lockPath);};
  let ledger: Ledger;
  try {
    const existing: unknown = existsSync(input.ledgerPath) ? JSON.parse(readFileSync(input.ledgerPath, 'utf8')) as unknown : {version: 1, limit: 3, calls: []};
    const raw = object(existing);
    if (raw.version !== 1 || raw.limit !== 3 || !Array.isArray(raw.calls) || raw.calls.length > 3) throw new Error('Invalid live ledger; refusing to reset authorization count');
    ledger = raw as Ledger;
  } catch (error) {releaseLock(); throw error;}
  const persist = (): void => {
    const temporary = `${input.ledgerPath}.pending-${process.pid}`;
    const fd = openSync(temporary, 'w', 0o600);
    try {writeFileSync(fd, JSON.stringify(ledger, null, 2)); fsyncSync(fd);} finally {closeSync(fd);}
    renameSync(temporary, input.ledgerPath);
  };
  try {persist();} catch (error) {releaseLock(); throw error;}
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/v1/responses') throw new Error('Only Responses text endpoint authorized');
      const payload = await body(request);
      const operation = operationOf(payload);
      if (ledger.calls.length >= 3) {
        response.writeHead(429, {'Content-Type': 'application/json'});
        response.end('{"error":{"message":"Authorized live request budget exhausted"}}');
        return;
      }
      if (typeof payload.model !== 'string' || payload.model.length > 200) throw new Error('Synthetic model identifier absent');
      const call: LiveCall = {number: ledger.calls.length + 1, operation, startedAt: new Date().toISOString(), protocol: 'openai', mode: 'responses', model: payload.model, eventTypes: {}, outputIndexes: {}, contentIndexes: {}, itemTypes: {}, partTypes: {}, partMetadataKinds: {}};
      ledger.calls.push(call); persist(); // Durable reservation BEFORE the first network byte.
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 310000);
      response.on('close', () => {if (!response.writableFinished) controller.abort();});
      try {
        const upstream = await fetch(`${input.baseUrl.replace(/\/$/, '')}/responses`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}`}, body: JSON.stringify({...payload, max_output_tokens: 8192}), signal: controller.signal});
        call.httpStatus = upstream.status; persist();
        response.writeHead(upstream.status, {'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream'});
        if (!upstream.body) throw new Error('Live stream body absent');
        const observe = observer(call);
        const reader = upstream.body.getReader();
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          observe(result.value);
          if (!response.destroyed) response.write(result.value); // Unchanged bytes, no buffering/conversion.
        }
        observe(new Uint8Array(), true); persist(); response.end();
      } catch {
        call.errorCode ??= 'HARNESS_UPSTREAM_INTERRUPTED'; persist(); failure(response);
      } finally {clearTimeout(deadline);}
    })().catch(() => failure(response));
  });
  let url: string;
  try {url = await listen(server);} catch (error) {releaseLock(); throw error;}
  return {
    url,
    finish: records => {
      for (const record of records) {
        const call = ledger.calls.find(item => item.operation === record.operation && item.state === undefined);
        if (call) Object.assign(call, {state: record.state, errorCode: record.errorCode ?? call.errorCode, streamActual: record.streamActual, textBytes: record.textBytes});
      }
      persist();
    },
    close: async () => {try {await close(server); persist();} finally {releaseLock();}},
  };
}
