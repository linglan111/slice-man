import { reviewFilterChoice } from './helpers';
import { test, expect } from "@playwright/test";
import {
  addProfile,
  importVideo,
  launchApp,
  makeVideo,
  startMockServer,
} from "./helpers";

test("anonymous 1027-cue review uses one HTTP request per complete selected set through real Electron IPC", async ({
  playwright: _playwright,
}, info) => {
  test.setTimeout(180_000);
  const mock = await startMockServer();
  mock.behavior.review = "empty";
  const source = info.outputPath("anonymous-one-shot.mp4");
  await makeVideo(source);
  const { app, page } = await launchApp(
    info.outputPath("one-shot-user-data"),
    [source],
    [],
  );
  try {
    await importVideo(page, false);
    await addProfile(page, "One-shot fixture", "openai", mock.url);
    await page.evaluate(async () => {
      const listed = await window.api.jobs.list();
      const profiles = await window.api.profiles.list();
      if (
        !listed.success ||
        !listed.data[0] ||
        !profiles.success ||
        !profiles.data[0]
      )
        throw new Error("Anonymous fixture absent");
      let job = listed.data[0];
      const configured = await window.api.jobs.updateOptions({
        jobId: job.id,
        options: { ...job.options, reviewProfileId: profiles.data[0].id },
      });
      if (!configured.success) throw new Error(configured.error);
      job = configured.data;
      for (let n = 0; n < 1027; n++) {
        const added = await window.api.jobs.addSegment({
          jobId: job.id,
          revision: job.revision,
          segment: {
            startMs: n * 3,
            endMs: n * 3 + 2,
            sourceText: `Anonymous cue ${n}`,
          },
        });
        if (!added.success) throw new Error(added.error);
        job = added.data;
      }
    });
    await expect(await reviewFilterChoice(page, 'unchecked')).toHaveAccessibleName(
      "未检查（1027）",
    );
    for (const length of [31, 65, 1027]) {
      // The full scan runs through App's action handler, which commits the returned Job.
      // Smaller selected sets deliberately exercise public IPC boundary requests below.
      if (length === 1027) {
        await page
          .getByRole("button", { name: "AI 检查字幕", exact: true })
          .click();
        await expect
          .poll(async () =>
            page.evaluate(async () => {
              const listed = await window.api.jobs.list();
              if (!listed.success || !listed.data[0])
                throw new Error("Fixture missing");
              return listed.data[0].reviewReport?.assessments?.filter(
                (a) => a.status === "current",
              ).length;
            }),
          )
          .toBe(1027);
      } else {
        const result = await page.evaluate(async (length) => {
          const listed = await window.api.jobs.list();
          if (!listed.success || !listed.data[0])
            throw new Error("Fixture missing");
          const job = listed.data[0];
          const ids = job.segments.slice(0, length).map((c) => c.id);
          const reviewed = await window.api.jobs.reviewSubtitles({
            jobId: job.id,
            revision: job.revision,
            segmentIds: ids,
          });
          if (!reviewed.success) throw new Error(reviewed.error);
          return {
            current: reviewed.data.reviewReport?.assessments?.filter(
              (a) => a.status === "current",
            ).length,
            groups: reviewed.data.reviewReport?.contextGroups?.length,
          };
        }, length);
        expect(result.current).toBe(length);
      }
      expect(mock.counters.review).toBe([31, 65, 1027].indexOf(length) + 1);
      const prompt = JSON.parse(
        mock.reviewPrompts.at(-1)?.split("\n")[1] ?? "{}",
      ) as { groups: { targets: number[] }[] };
      expect(prompt.groups.flatMap((g) => g.targets)).toHaveLength(length);
    }
    expect(mock.counters.recognition).toBe(0);
    expect(mock.counters.translation).toBe(0);
    await expect(await reviewFilterChoice(page, 'unchecked')).toHaveAccessibleName(
      "未检查（0）",
    );
    await page.screenshot({
      path: info.outputPath("one-shot-1027-complete.png"),
    });
  } finally {
    await app.close();
    await mock.close();
  }
});

test("review service entry and one visible evidence correction preserve the last report on repeated failure and cancellation", async ({
  playwright: _playwright,
}, info) => {
  const mock = await startMockServer();
  mock.behavior.review = "evidence-corrected";
  const source = info.outputPath("review-evidence.mp4");
  await makeVideo(source);
  const { app, page } = await launchApp(
    info.outputPath("evidence-user-data"),
    [source],
    [],
  );
  try {
    await importVideo(page, false);
    await addProfile(page, "Evidence fixture", "openai", mock.url);
    await page.evaluate(async () => {
      const listed = await window.api.jobs.list();
      if (!listed.success || !listed.data[0])
        throw new Error("Review fixture absent");
      let job = listed.data[0];
      for (let n = 0; n < 4; n++) {
        const result = await window.api.jobs.addSegment({
          jobId: job.id,
          revision: job.revision,
          segment: {
            startMs: n * 700,
            endMs: n * 700 + 500,
            sourceText: `Anonymous chronological dialogue ${n}`,
          },
        });
        if (!result.success) throw new Error(result.error);
        job = result.data;
      }
    });
    await expect(await reviewFilterChoice(page, 'unchecked')).toHaveAccessibleName(
      "未检查（4）",
    );
    await expect(await reviewFilterChoice(page, 'pending')).toHaveAccessibleName(
      "待检查（4）",
    );
    await page
      .getByRole("button", { name: "AI 检查字幕", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "选择 AI 检查服务",
      exact: true,
    });
    await expect(picker).toBeVisible();
    await expect(
      picker.getByRole("button", { name: "保存并检查", exact: true }),
    ).toBeDisabled();
    expect(mock.counters.review).toBe(0);
    await picker
      .getByLabel("AI 检查服务", { exact: true })
      .selectOption({ label: "Evidence fixture" });
    await picker
      .getByRole("button", { name: "保存并检查", exact: true })
      .click();
    await expect(await reviewFilterChoice(page, 'unchecked')).toHaveAccessibleName(
      "未检查（0）",
    );
    expect(mock.counters.review).toBe(2);
    expect(mock.reviewPrompts[1]).toContain("Correction 1/1");
    const before = await page.evaluate(async () => {
      const listed = await window.api.jobs.list();
      if (!listed.success || !listed.data[0])
        throw new Error("Review fixture absent");
      return listed.data[0].reviewReport;
    });
    expect(before?.assessments).toHaveLength(4);
    mock.behavior.review = "evidence-invalid";
    await page
      .getByRole("button", { name: "AI 检查字幕", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("REVIEW_EVIDENCE");
    expect(mock.counters.review).toBe(4);
    const retained = await page.evaluate(async () => {
      const listed = await window.api.jobs.list();
      if (!listed.success || !listed.data[0])
        throw new Error("Review fixture absent");
      return listed.data[0].reviewReport;
    });
    expect(retained).toEqual(before);
    mock.behavior.review = "slow";
    await page
      .getByRole("button", { name: "AI 检查字幕", exact: true })
      .click();
    await expect.poll(() => mock.counters.review).toBe(5);
    await page
      .getByRole("button", { name: "取消当前处理", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "AI 检查字幕", exact: true }),
    ).toBeEnabled();
    const cancelled = await page.evaluate(async () => {
      const listed = await window.api.jobs.list();
      if (!listed.success || !listed.data[0])
        throw new Error("Review fixture absent");
      return listed.data[0].reviewReport;
    });
    expect(cancelled).toEqual(before);
    expect(mock.counters.review).toBe(5);
    expect(mock.counters.translation).toBe(0);
    expect(mock.counters.recognition).toBe(0);
    await page.screenshot({
      path: info.outputPath("review-evidence-retained-after-cancel.png"),
    });
  } finally {
    await app.close();
    await mock.close();
  }
});
