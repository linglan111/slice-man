import { expect, test } from '@playwright/test';
import { importVideo, launchApp, makeVideo } from './helpers';
import { currentResponsesJob, seedResponses, startReasoningResponses } from './responses-helpers';

test('native IPC retains an explicit normal-plan provider while dependent style requests are active', async ({playwright: _}, info) => {
  test.setTimeout(120000);
  let hold = false;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const fixture = await startReasoningResponses({afterThinking: () => hold ? gate : Promise.resolve()});
  const input = info.outputPath('provider-dependency.mp4');
  await makeVideo(input);
  const {app, page} = await launchApp(info.outputPath('provider-dependency-data'), [input], []);
  try {
    await importVideo(page);
    await seedResponses(page, {baseUrl: fixture.url, model: 'dependency-fixture', apiKey: 'nonsecret-loopback'});
    const planProfileId = await page.evaluate(async baseUrl => {
      const saved = await window.api.profiles.save({name: 'Explicit plan provider', protocol: 'openai', mode: 'responses', baseUrl, model: 'plan-model', apiKey: 'nonsecret-loopback', sessionOnly: true});
      if (!saved.success) throw new Error(saved.code);
      const listed = await window.api.jobs.list();
      const profiles = await window.api.profiles.list();
      if (!listed.success || !listed.data[0] || !profiles.success) throw new Error('Fixture missing');
      const job = listed.data[0];
      const textProfile = profiles.data.find(profile => profile.id !== saved.data.id);
      if (!textProfile) throw new Error('Style provider missing');
      const configured = await window.api.jobs.updateOptions({jobId: job.id, options: {...job.options, chapterProfileId: undefined, styleProfileId: textProfile.id}});
      if (!configured.success) throw new Error(configured.code);
      const planned = await window.api.jobs.planChapters({jobId: job.id, revision: configured.data.revision, kind: 'normal', profileId: saved.data.id});
      if (!planned.success) throw new Error(planned.code);
      return saved.data.id;
    }, fixture.url);
    const before = await currentResponsesJob(page);
    expect(before.options.chapterProfileId).toBeUndefined();
    expect(before.chapterPlan?.profileId).toBe(planProfileId);
    hold = true;
    const styling = page.evaluate(async () => {
      const listed = await window.api.jobs.list();
      if (!listed.success || !listed.data[0]) throw new Error('Style fixture missing');
      const result = await window.api.jobs.designStyle({jobId: listed.data[0].id, prompt: 'Readable clean style'});
      return result.success ? {success: true} : {success: false, code: result.code};
    });
    await expect.poll(() => fixture.counts.style).toBeGreaterThan(0);
    const blocked = await page.evaluate(async ({id, baseUrl}) => ({
      save: await window.api.profiles.save({id, name: 'Should remain unchanged', protocol: 'openai', mode: 'responses', baseUrl, model: 'changed-model', sessionOnly: true}),
      remove: await window.api.profiles.remove(id),
    }), {id: planProfileId, baseUrl: fixture.url});
    expect(blocked.save).toMatchObject({success: false, code: 'JOB_BUSY'});
    expect(blocked.remove).toMatchObject({success: false, code: 'JOB_BUSY'});
    release?.(); hold = false;
    expect(await styling).toEqual({success: true});
    const after = await currentResponsesJob(page);
    expect(after.chapterPlan).toEqual(before.chapterPlan);
    expect(after.stages.style.state).toBe('succeeded');
    const profiles = await page.evaluate(() => window.api.profiles.list());
    expect(profiles.success && profiles.data.find(profile => profile.id === planProfileId)).toMatchObject({name: 'Explicit plan provider', model: 'plan-model'});
  } finally {release?.(); await app.close(); await fixture.close();}
});
