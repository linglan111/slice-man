import { test, expect, type Page } from '@playwright/test';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { addProfile, FFMPEG, FFPROBE, importVideo, launchApp, makeVideo, startMockServer } from './helpers';
import type { ProviderDiagnostic } from '../../src/shared/provider-diagnostics-contracts';
import type { ChapterReviewRun } from '../../src/shared/chapter-contracts';

async function seed(page: Page, long = false): Promise<void> {
  await page.evaluate(async (long) => {
    const jobs = await window.api.jobs.list(); const profiles = await window.api.profiles.list();
    if (!jobs.success || !jobs.data[0] || !profiles.success || !profiles.data[0]) throw new Error('Fixture missing');
    let job = jobs.data[0]; const id = profiles.data[0].id;
    const configured = await window.api.jobs.updateOptions({jobId: job.id, options: {...job.options, reviewProfileId: id, chapterProfileId: id, translationProfileId: id}});
    if (!configured.success) throw new Error(configured.error); job = configured.data;
    const starts = long ? [100, 901000, 1700000] : [100, 2000];
    for (const [i, startMs] of starts.entries()) {
      const added = await window.api.jobs.addSegment({jobId: job.id, revision: job.revision, segment: {startMs, endMs: startMs + (long ? 4000 : 1700), sourceText: i === 0 ? 'Ann arrives.' : 'Hello Ann.', translatedText: i === 0 ? '安娜来了。' : '你好安娜。'}});
      if (!added.success) throw new Error(added.error); job = added.data;
    }
  }, long);
  await page.reload(); await expect(page.getByTestId('segment-1')).toBeVisible();
}
async function diagnostics(page: Page): Promise<ProviderDiagnostic[]> {
  return page.evaluate(async () => {const result = await window.api.diagnostics.list(); if (!result.success) throw new Error(result.error); return result.data;});
}

test('streamed chapter planning, title exports, standards and diagnostics survive real Electron restart', async ({playwright: _}, info) => {
  test.setTimeout(150000);
  const mock = await startMockServer(); mock.behavior.textStream = 'sse';
  const input = info.outputPath('chapter-source.mp4'); await makeVideo(input);
  const directory = info.outputPath('chapter-exports'); await mkdir(directory, {recursive: true});
  await writeFile(join(directory, '相同章节.srt'), 'keep-existing');
  const userData = info.outputPath('chapter-user-data');
  let {app, page} = await launchApp(userData, [input], [], {APP_E2E_EXPORT_DIRECTORIES: JSON.stringify([directory, directory])});
  try {
    await importVideo(page); await addProfile(page, 'Streaming fixture', 'openai', mock.url); await seed(page);
    await page.getByRole('toolbar', {name: '视频操作'}).getByRole('button', {name: '章节', exact: true}).click();
    await page.getByRole('button', {name: 'AI 切分章节', exact: true}).click();
    await expect(page.getByLabel('章节 2 标题', {exact: true})).toBeVisible();
    expect(mock.counters.chapters).toBe(1);
    for (const [width, height] of [[1920,1080],[1440,960],[1050,700]] as const) {
      await app.evaluate(({BrowserWindow}, size) => BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height), {width, height});
      await page.getByRole('button', {name: '重置布局', exact: true}).click();
      for (const label of ['章节类型', '章节分析服务']) await expect(page.getByLabel(label, {exact: true})).toBeVisible();
      const action = page.getByRole('button', {name: '导出所选章节（0）', exact: true});
      expect(await action.evaluate(node => {const r=node.getBoundingClientRect();return r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth;})).toBe(true);
      await page.screenshot({path: info.outputPath(`chapters-${width}.png`)});
    }
    await page.getByRole('button', {name: '全选章节', exact: true}).click();
    await page.getByRole('button', {name: '导出所选章节（2）', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: '按章节标题导出', exact: true});
    await dialog.getByRole('button', {name: '独立字幕文件', exact: true}).click();
    await dialog.getByLabel('导出格式', {exact: true}).selectOption('srt');
    await dialog.getByRole('button', {name: '选择保存位置并导出', exact: true}).click();
    await expect(dialog).not.toBeVisible();
    const files = (await readdir(directory)).filter(name => name.endsWith('.srt'));
    expect(files).toHaveLength(3); expect(await readFile(join(directory, '相同章节.srt'), 'utf8')).toBe('keep-existing');
    const outputs = await Promise.all(files.filter(name => name !== '相同章节.srt').map(name => readFile(join(directory,name),'utf8')));
    expect(outputs.some(text => text.includes('00:00:00,000 --> 00:00:01,700'))).toBe(true);
    await page.locator('.chapter-row').nth(1).getByRole('button', {name: /^定位 /}).click();
    await expect.poll(() => page.locator('video').first().evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(2, 2);
    await page.getByLabel('章节 2 标题', {exact: true}).fill('第二章编辑标题');
    await page.getByLabel('章节 2 摘要', {exact: true}).fill('由用户确认的第二章摘要。');
    await page.getByRole('button', {name: '保存章节修改', exact: true}).click();
    await expect(page.getByRole('button', {name: '保存章节修改', exact: true})).toHaveCount(0);
    const savedPlan = await page.evaluate(async () => {const result = await window.api.jobs.list(); if (!result.success) throw new Error(result.error); return result.data[0]?.chapterPlan;});
    expect(savedPlan?.revision).toBe(1);
    expect(savedPlan?.chapters[1]).toMatchObject({title: '第二章编辑标题', summary: '由用户确认的第二章摘要。', startMs: 2000, endMs: 4000});
    await page.getByLabel('选择章节 1', {exact: true}).uncheck();
    await expect(page.getByLabel('选择章节 2', {exact: true})).toBeChecked();
    await page.getByRole('button', {name: '导出所选章节（1）', exact: true}).click();
    await dialog.getByLabel('导出格式', {exact: true}).selectOption('mp4');
    await dialog.getByLabel('视频编码', {exact: true}).selectOption('h264');
    await dialog.getByRole('button', {name: '选择保存位置并导出', exact: true}).click();
    await expect(dialog).not.toBeVisible();
    const videos = (await readdir(directory)).filter(name => name.endsWith('.mp4'));
    expect(videos).toEqual(['第二章编辑标题.mp4']);
    const probe = await promisify(execFile)(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(directory, videos[0] ?? '')], {windowsHide: true});
    const videoInfo = JSON.parse(probe.stdout) as {format: {duration: string}; streams: {codec_type: string}[]};
    expect(Math.abs(Number(videoInfo.format.duration) - 2)).toBeLessThan(.1);
    expect(videoInfo.streams.some(stream => stream.codec_type === 'video')).toBe(true);
    expect(videoInfo.streams.some(stream => stream.codec_type === 'audio')).toBe(true);
    await page.getByLabel('章节类型', {exact: true}).selectOption('custom');
    await page.getByRole('button', {name: '管理切分标准', exact: true}).click();
    const criteria = page.getByRole('dialog', {name: '管理自定义切分标准', exact: true});
    await criteria.getByLabel('标准名称', {exact: true}).fill('Native criteria');
    await criteria.getByLabel('切分要求', {exact: true}).fill('保留内容核心观点。');
    await criteria.getByRole('button', {name: '保存标准', exact: true}).click();
    await criteria.getByRole('button', {name: '复制 Native criteria', exact: true}).click();
    await criteria.getByRole('button', {name: '删除 Native criteria 副本', exact: true}).click();
    await expect(criteria.getByRole('button', {name: '删除 Native criteria 副本', exact: true})).toHaveCount(0);
    await expect(criteria.getByRole('button', {name: 'Native criteria', exact: true})).toBeVisible();
    await criteria.getByRole('button', {name: '返回章节', exact: true}).click();
    await page.getByLabel('切分标准', {exact: true}).selectOption({label: 'Native criteria'});
    await page.getByRole('button', {name: 'AI 切分章节', exact: true}).click();
    await expect(page.getByLabel('章节 1 标题', {exact: true})).toBeVisible();
    expect(mock.counters.chapters).toBe(2);
    const records = await diagnostics(page); expect(records).toHaveLength(2);
    expect(records.every(r => r.state === 'published' && r.streamActual)).toBe(true);
    for (const record of records) {
      const answer = await page.evaluate(id => window.api.diagnostics.readAnswer(id), record.id);
      if (!answer.success) throw new Error(answer.error);
      expect(answer.data.text).toContain('chapters'); expect(answer.data.text).not.toContain('PRIVATE_REASONING_NOT_SAVED');
    }
    await page.getByRole('button', {name: 'AI 请求日志', exact: true}).click();
    const logs=page.getByRole('dialog', {name:'AI 请求日志',exact:true});
    await logs.locator('.diagnostics-item').first().click();
    await expect(logs.getByLabel('已接收的 AI 回答')).toContainText('chapters');
    await page.screenshot({path:info.outputPath('diagnostics.png')});
    await app.close(); ({app,page}=await launchApp(userData,[],[]));
    expect(await diagnostics(page)).toHaveLength(2);
    const library=await page.evaluate(()=>window.api.chapterCriteria.list());
    expect(library.success && library.data.items.some(item=>item.name==='Native criteria')).toBe(true);
  } finally {await app.close(); await mock.close();}
});

test('cancelled partial AI answer stays on disk without publishing names or replaying the request', async ({playwright:_},info)=>{
  const mock=await startMockServer(); mock.behavior.textStream='partial';
  const input=info.outputPath('partial.mp4');await makeVideo(input);
  const userData=info.outputPath('partial-user-data');let {app,page}=await launchApp(userData,[input],[]);
  try {
    await importVideo(page);await addProfile(page,'Partial fixture','openai',mock.url);await seed(page);
    await page.getByRole('toolbar',{name:'视频操作'}).getByRole('button',{name:'人名检查',exact:true}).click();
    await page.getByRole('button',{name:'AI 检查人名',exact:true}).click();
    await expect.poll(async()=> page.evaluate(async()=>{const logs=await window.api.diagnostics.list();if(!logs.success||!logs.data[0])return 0;const answer=await window.api.diagnostics.readAnswer(logs.data[0].id);return answer.success?answer.data.text.length:0;})).toBeGreaterThan(0);
    await expect.poll(async()=> (await diagnostics(page))[0]?.textBytes ?? 0).toBeGreaterThan(0);
    await page.getByRole('button',{name:'取消当前处理',exact:true}).click();
    await expect.poll(async()=> (await diagnostics(page))[0]?.state).toBe('cancelled');
    const record=(await diagnostics(page))[0]; if(!record)throw new Error('No diagnostic');
    const before=await page.evaluate(id=>window.api.diagnostics.readAnswer(id),record.id);
    expect(before.success&&before.data.text.length>0).toBe(true);expect(mock.counters.names).toBe(1);
    const jobs=await page.evaluate(()=>window.api.jobs.list());expect(jobs.success&&jobs.data[0]?.nameReport).toBeFalsy();
    await app.close();({app,page}=await launchApp(userData,[],[]));
    const after=await page.evaluate(id=>window.api.diagnostics.readAnswer(id),record.id);expect(after).toEqual(before);
    expect(mock.counters.names).toBe(1);
  }finally{await app.close();await mock.close();}
});

test('long video review retains completed chapters and resumes only remaining targets',async({playwright:_},info)=>{
  test.setTimeout(180000);
  const mock=await startMockServer();mock.behavior.textStream='sse';mock.behavior.review='empty';mock.behavior.reviewErrorAt=2;
  const input=info.outputPath('long.mp4');
  await promisify(execFile)(FFMPEG,['-y','-f','lavfi','-i','color=c=black:s=320x180:r=1','-f','lavfi','-i','sine=frequency=400:sample_rate=16000','-t','1801','-c:v','libx264','-preset','ultrafast','-c:a','aac','-b:a','8k',input],{windowsHide:true});
  const {app,page}=await launchApp(info.outputPath('long-user-data'),[input],[]);
  try{
    await importVideo(page);await addProfile(page,'Long fixture','openai',mock.url);await seed(page,true);
    await page.getByRole('button',{name:'AI 检查字幕',exact:true}).click();
    const run=async(): Promise<ChapterReviewRun | undefined>=>page.evaluate(async()=>{const r=await window.api.jobs.list();if(!r.success)throw new Error(r.error);return r.data[0]?.reviewRun;});
    await expect.poll(async()=>(await run())?.state).toBe('failed');
    expect((await run())?.chapters.filter(c=>c.state==='completed')).toHaveLength(1);
    expect(mock.counters.review).toBe(2);
    mock.behavior.reviewErrorAt=undefined;
    await page.getByRole('button',{name:'继续检查剩余章节',exact:true}).click();
    await expect.poll(async()=>(await run())?.state).toBe('complete');
    expect(mock.counters.review).toBe(3);expect(mock.counters.chapters).toBe(1);
    await page.screenshot({path:info.outputPath('chapter-review-complete.png')});
  }finally{await app.close();await mock.close();}
});
