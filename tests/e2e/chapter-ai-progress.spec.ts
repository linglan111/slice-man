import { expect, test } from '@playwright/test';
import { importVideo, launchApp, makeVideo, startSubtitleReview } from './helpers';
import { currentResponsesJob, seedResponses, startReasoningResponses } from './responses-helpers';
import { writeFile } from 'node:fs/promises';

test('native chapter help, persisted service concurrency and every queued or streaming chapter stay visible', async ({playwright: _}, info) => {
  test.setTimeout(180000);
  let hold = false;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const fixture = await startReasoningResponses({afterThinking: () => hold ? gate : Promise.resolve()});
  const source = info.outputPath('progress.mp4');
  const userData = info.outputPath('progress-user-data');
  await makeVideo(source);
  let {app, page} = await launchApp(userData, [source], []);
  try {
    await importVideo(page);
    await seedResponses(page, {baseUrl: fixture.url, model: 'progress-fixture', apiKey: 'nonsecret-loopback'});
    await page.getByRole('button', {name: 'API 服务', exact: true}).click();
    await page.getByRole('button', {name: '编辑', exact: true}).click();
    const editor = page.getByRole('dialog', {name: '编辑 API 服务', exact: true});
    await editor.getByLabel('文字请求并发上限', {exact: true}).fill('2');
    await editor.getByRole('button', {name: '保存配置', exact: true}).click();
    await page.getByLabel('关闭对话框', {exact: true}).click();
    await startSubtitleReview(page);
    await expect.poll(async () => (await currentResponsesJob(page)).reviewRun?.state).toBe('complete');
    await page.evaluate(async () => {
      const listed = await window.api.jobs.list();
      if (!listed.success || !listed.data[0]?.chapterPlan) throw new Error('Plan absent');
      let job = listed.data[0];
      const added = await window.api.jobs.addSegment({jobId: job.id, revision: job.revision, segment: {startMs: 1900, endMs: 1950, sourceText: 'Middle dialogue.', translatedText: '中间对话。'}});
      if (!added.success) throw new Error(added.error);
      job = added.data;
      const planned = await window.api.jobs.reviewSubtitles({jobId: job.id, revision: job.revision});
      if (!planned.success || !planned.data.chapterPlan) throw new Error('Reused plan absent');
      job = planned.data;
      const plan = planned.data.chapterPlan;
      const updated = await window.api.jobs.updateChapters({jobId: job.id, revision: job.revision, planId: plan.id, planRevision: plan.revision, chapters: [
        {id: 'first', startMs: 0, endMs: 1850, title: '第一章', summary: ''},
        {id: 'middle', startMs: 1850, endMs: 2000, title: '第二章', summary: ''},
        {id: 'last', startMs: 2000, endMs: job.media.durationMs, title: '第三章', summary: ''},
      ]});
      if (!updated.success) throw new Error(updated.error);
    });
    await page.reload();
    await page.getByRole('toolbar', {name: '视频操作'}).getByRole('button', {name: '章节', exact: true}).click();
    await expect(page.getByLabel('章节类型', {exact: true})).toHaveValue('normal');
    await expect(page.getByLabel('章节类型', {exact: true}).locator('option:checked')).toHaveText('全文章节切分');
    const help = page.getByRole('button', {name: '了解全文章节切分', exact: true});
    await help.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {name: '全文章节切分说明', exact: true});
    await expect(dialog).toContainText('语音识别与人名检查不使用');
    await page.keyboard.press('Escape'); await expect(help).toBeFocused();
    await page.getByRole('button', {name: '返回工作区', exact: true}).click();
    const before = fixture.counts.review; hold = true;
    await startSubtitleReview(page);
    const progress = page.getByRole('region', {name: '当前处理进度', exact: true});
    await expect.poll(() => fixture.counts.review).toBe(before + 2);
    const rows = page.getByRole('list', {name: '并发请求进度', exact: true});
    await expect(rows.getByRole('listitem')).toHaveCount(3);
    await expect(progress).toContainText('批量检查字幕');
    await expect(progress).toContainText('处理中 2 · 排队 1');
    await expect(progress).toContainText('模型思考中 2');
    await expect(page.getByRole('button', {name: '查看流式信息', exact: true})).toHaveCount(1);
    await expect(page.getByRole('button', {name: '流式信息', exact: true})).toHaveCount(0);
    const geometry: unknown[] = [];
    for (const [width, height] of [[1440, 960], [1050, 700]] as const) {
      await app.evaluate(({BrowserWindow}, size) => BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height), {width, height});
      await expect(rows).toBeVisible();
      for (const name of ['查看流式信息', '取消当前处理']) {
        const action = page.getByRole('button', {name, exact: true});
        const measurement = await action.evaluate(node => {
          const bounds = node.getBoundingClientRect();
          const target = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
          return {bounds: bounds.toJSON(), viewport: innerHeight, clickable: bounds.top >= 0 && bounds.bottom <= innerHeight && Boolean(target && node.contains(target))};
        });
        geometry.push({width, name, ...measurement});
        expect(measurement.clickable, `${name} remains directly clickable at ${width} without scrolling`).toBe(true);
      }
      await page.screenshot({path: info.outputPath(`concurrent-progress-${width}.png`)});
      await rows.focus(); await expect(rows).toBeFocused();
      await page.keyboard.press('End');
      for (const row of await rows.getByRole('listitem').all()) {
        await row.scrollIntoViewIfNeeded();
        const measurement = await row.evaluate(node => {
          const bounds = node.getBoundingClientRect();
          const target = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
          return {bounds: bounds.toJSON(), viewport: innerHeight, readable: bounds.top >= 0 && bounds.bottom <= innerHeight && Boolean(target && node.contains(target))};
        });
        geometry.push({width, requestRow: await row.textContent(), ...measurement});
        expect(measurement.readable, `Every request row can be read after scrolling at ${width}`).toBe(true);
      }
      await page.screenshot({path: info.outputPath(`concurrent-requests-scrolled-${width}.png`)});
      await page.locator('.workspace-results').evaluate(node => {node.scrollTop = 0;});
    }
    await writeFile(info.outputPath('progress-hit-testing.json'), JSON.stringify(geometry, null, 2));
    release?.(); hold = false;
    await expect.poll(async () => (await currentResponsesJob(page)).reviewRun?.state).toBe('complete');
    expect(fixture.counts.review).toBe(before + 3);
    await expect(page.getByRole('button', {name: '查看流式信息', exact: true})).toHaveCount(1);
    await app.close(); ({app, page} = await launchApp(userData, [], []));
    const profiles = await page.evaluate(() => window.api.profiles.list());
    expect(profiles.success && profiles.data[0]?.textConcurrency).toBe(2);
    expect((await currentResponsesJob(page)).reviewReport?.assessments?.filter(a => a.status === 'current')).toHaveLength(3);
  } finally {release?.(); await app.close(); await fixture.close();}
});
