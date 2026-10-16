import { startSubtitleReview } from './helpers';
import { selectReviewFilters, reviewFilterChoice } from './helpers';
import {
  test,
  expect,
  type Page,
  type ElectronApplication,
} from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { Job } from "../../src/shared/contracts";
import type SqliteDatabase from "better-sqlite3";
import {
  REVIEW_RUBRIC_VERSION,
  REVIEW_RULE_IDS,
} from "../../src/shared/review-rubric";
import {
  addProfile,
  importVideo,
  launchApp,
  makeVideo,
  startMockServer,
  jobSetting,
  closeWorkspaceSettings,
} from "./helpers";

const evidence = resolve(
  ".trellis/tasks/10-11-subtitle-workspace-layout/evidence",
);
const promptSchema = z
  .object({
    cues: z.array(
      z.object({ n: z.number().int(), sourceText: z.string() }).passthrough(),
    ),
    groups: z.array(
      z.object({
        targets: z.array(z.number().int()),
        context: z.array(z.number().int()),
      }),
    ),
    rubric: z
      .object({
        version: z.string(),
        rules: z.array(
          z
            .object({
              ruleId: z.string(),
              example: z.string(),
              counterexample: z.string(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
    translationEnabled: z.boolean(),
  })
  .passthrough();
function readPrompt(prompt: string): z.infer<typeof promptSchema> {
  const line = prompt
    .split("\n")
    .find((candidate) => candidate.startsWith('{"cues"'));
  return promptSchema.parse(JSON.parse(line ?? "{}") as unknown);
}

async function currentJob(page: Page): Promise<Job> {
  return page.evaluate(async () => {
    const result = await window.api.jobs.list();
    if (!result.success || !result.data[0])
      throw new Error("Isolated contextual fixture absent");
    return result.data[0];
  });
}

async function gradeWorkspace(page: Page, phase: string): Promise<unknown> {
  const dimensions = await page.evaluate(() => {
    const rect = (
      selector: string,
    ):
      | {
          height: number;
          bottom: number;
          top: number;
          clientHeight: number;
          scrollHeight: number;
        }
      | undefined => {
      const node = document.querySelector(selector);
      if (!node) return undefined;
      const bounds = node.getBoundingClientRect();
      return {
        height: bounds.height,
        bottom: bounds.bottom,
        top: bounds.top,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
      };
    };
    return {
      viewport: innerHeight,
      body: document.body.scrollHeight,
      scrollY,
      player: rect("video"),
      list: rect(".subtitle-list"),
      panel: rect(".reprocessing-panel"),
      previewPanel: rect(".preview-panel"),
      subtitlePanel: rect(".subtitle-panel"),
      content: rect(".work-grid__content"),
    };
  });
  await writeFile(
    join(evidence, `contextual-layout-${phase}.json`),
    JSON.stringify(dimensions, null, 2),
  );
  await page.screenshot({
    path: join(evidence, `contextual-layout-${phase}.png`),
  });
  expect(dimensions.player?.height ?? 0).toBeGreaterThan(100);
  expect(dimensions.list?.height ?? 0).toBeGreaterThan(70);
  expect(dimensions.list?.bottom ?? Infinity).toBeLessThanOrEqual(
    dimensions.viewport + 1,
  );
  expect(dimensions.list?.bottom ?? Infinity).toBeLessThanOrEqual(
    dimensions.subtitlePanel?.bottom ?? 0,
  );
  expect(dimensions.subtitlePanel?.bottom ?? Infinity).toBeLessThanOrEqual(
    dimensions.content?.bottom ?? 0,
  );
  if (dimensions.panel) {
    expect(dimensions.panel.height).toBeGreaterThanOrEqual(60);
    expect(dimensions.panel.clientHeight).toBeGreaterThanOrEqual(60);
  }
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.scrollY).toBe(0);
  return dimensions;
}

test("all cues receive four fixed context grades across batch boundaries; grade repair and neighbour changes retain honest stale/legacy states", async ({
  playwright: _p,
}, info) => {
  test.setTimeout(180_000);
  const mock = await startMockServer();
  mock.behavior.review = "graded";
  const source = info.outputPath("anonymous-contextual.mp4");
  await makeVideo(source);
  const userData = info.outputPath("contextual-user-data");
  let app: ElectronApplication | undefined;
  try {
    const launched = await launchApp(userData, [source], []);
    app = launched.app;
    const page = launched.page;
    await importVideo(page, false);
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    // Real IPC creates the anonymous chronological dialogue; no alternate renderer API.
    await page.evaluate(async () => {
      const result = await window.api.jobs.list();
      if (!result.success || !result.data[0])
        throw new Error("Fixture job missing");
      let job = result.data[0];
      for (let index = 0; index < 34; index++) {
        const sourceText =
          index === 1
            ? "LOW: The train leaves at station platform."
            : index === 2
              ? "MEDIUM: The previous train sentence has an unclear phrase."
              : index === 3
                ? "HIGH: This very long subtitle has too much text for its one hundred millisecond appearance."
                : index === 29
                  ? "BOUNDARY: The letter was posted yesterday."
                  : index === 30
                    ? "MEDIUM: Therefore the letter arrived before it was posted."
                    : `NONE: Stable chronological dialogue cue ${index + 1}.`;
        const added = await window.api.jobs.addSegment({
          jobId: job.id,
          revision: job.revision,
          segment: {
            startMs: index * 110,
            endMs: index * 110 + 100,
            sourceText,
          },
        });
        if (!added.success) throw new Error(added.error);
        job = added.data;
      }
    });
    await expect(page.locator(".subtitle-row")).toHaveCount(34);
    await expect(
      page.getByTestId("segment-0").getByLabel("未检查", { exact: true }),
    ).toBeVisible();
    expect((await currentJob(page)).reviewReport).toBeUndefined();
    await addProfile(page, "Contextual fixture", "openai", mock.url);
    await (await jobSetting(page, "识别方式")).selectOption("cloud");
    await (
      await jobSetting(page, "语音识别服务")
    ).selectOption({ label: "Contextual fixture" });
    await (
      await jobSetting(page, "AI 检查服务（可选）")
    ).selectOption({ label: "Contextual fixture" });
    await closeWorkspaceSettings(page);
    await startSubtitleReview(page);
    await expect
      .poll(
        async () => (await currentJob(page)).reviewReport?.assessments?.length,
      )
      .toBe(34);
    await expect(
      page.getByRole("button", { name: "AI 检查字幕", exact: true }),
    ).toBeEnabled();
    const reviewed = await currentJob(page);
    const report = reviewed.reviewReport;
    if (!report?.assessments || !report.rubric)
      throw new Error("Explicit graded report missing");
    expect(
      new Set(report.assessments.map((assessment) => assessment.segmentId))
        .size,
    ).toBe(34);
    expect(
      report.assessments.every((assessment) => assessment.status === "current"),
    ).toBe(true);
    expect(report.rubric.version).toBe(REVIEW_RUBRIC_VERSION);
    expect(
      report.assessments.filter(
        (assessment) => assessment.riskLevel === "none",
      ),
    ).toHaveLength(30);
    expect(
      report.assessments.filter((assessment) => assessment.riskLevel === "low"),
    ).toHaveLength(1);
    expect(
      report.assessments.filter(
        (assessment) => assessment.riskLevel === "medium",
      ),
    ).toHaveLength(2);
    expect(
      report.assessments.filter(
        (assessment) => assessment.riskLevel === "high",
      ),
    ).toHaveLength(1);
    const prompts = mock.reviewPrompts.map(readPrompt);
    expect(prompts).toHaveLength(1);
    expect(mock.counters.review).toBe(1);
    const aggregate = prompts[0];
    const first = aggregate?.groups[0];
    const second = aggregate?.groups[1];
    if (!aggregate || !first || !second)
      throw new Error("Cross-boundary fixture missing");
    expect(first.targets).toHaveLength(30);
    expect(second.targets).toHaveLength(4);
    expect(first.context).toContain(30);
    expect(second.context).toContain(29);
    expect(aggregate.cues.find((cue) => cue.n === 29)?.sourceText).toContain(
      "posted yesterday",
    );
    for (const prompt of prompts) {
      expect(prompt.rubric.version).toBe(REVIEW_RUBRIC_VERSION);
      expect(prompt.rubric.rules.map((rule) => rule.ruleId)).toEqual([
        ...REVIEW_RULE_IDS,
      ]);
      expect(
        prompt.rubric.rules.every(
          (rule) => rule.example && rule.counterexample,
        ),
      ).toBe(true);
      expect(prompt.translationEnabled).toBe(false);
    }
    expect(mock.counters.recognition).toBe(0);
    expect(mock.counters.translation).toBe(0);
    // Returning from API settings remounts the player; wait for a decoded frame.
    await page.locator("video").evaluate(async (video: HTMLVideoElement) => {
      await video.play();
      await new Promise<void>((done) => {
        video.requestVideoFrameCallback(() => done());
      });
      video.pause();
    });
    await mkdir(evidence, { recursive: true });
    await page.screenshot({
      path: join(evidence, "contextual-four-grade-overview.png"),
    });
    for (const [level, count] of [
      ["none", 30],
      ["low", 1],
      ["medium", 2],
      ["high", 1],
    ] as const) {
      await expect(await reviewFilterChoice(page, level)).toHaveAccessibleName(new RegExp(
        `（${count}）`),
      );
      await selectReviewFilters(page, level);
      await expect(page.locator(".subtitle-row")).toHaveCount(count);
      await page.screenshot({
        path: join(evidence, `contextual-grade-${level}.png`),
      });
    }
    await expect(
      page.getByTestId("segment-3").getByLabel("可疑度：高", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "全选", exact: true })
      .click();
    await expect(page.getByLabel("选择字幕 4", { exact: true })).toBeChecked();
    await page
      .getByRole("button", { name: "重新识别片段", exact: true })
      .click();
    await expect(page.locator(".reprocessing-panel__scope")).toContainText(
      "1 条已有字幕",
    );
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1050, 700);
    });
    const selectedMinimumLayout = await gradeWorkspace(
      page,
      "selected-minimum",
    );
    const minimumExecute = page.getByRole("button", {
      name: "识别并替换片段",
      exact: true,
    });
    await minimumExecute.scrollIntoViewIfNeeded();
    const executeBounds = await minimumExecute.boundingBox();
    const processingBounds = await page
      .locator(".reprocessing-panel")
      .boundingBox();
    if (!executeBounds || !processingBounds)
      throw new Error("Scoped repair controls absent");
    expect(executeBounds.y).toBeGreaterThanOrEqual(processingBounds.y);
    expect(executeBounds.y + executeBounds.height).toBeLessThanOrEqual(
      processingBounds.y + processingBounds.height,
    );
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.screenshot({
      path: join(evidence, "contextual-high-grade-repair.png"),
    });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 960);
    });
    mock.behavior.recognition = "partial";
    await page
      .getByRole("button", { name: "识别并替换片段", exact: true })
      .click();
    await expect.poll(() => mock.counters.recognition).toBe(1);
    await expect(
      page.getByRole("button", { name: "重新识别片段", exact: true }),
    ).toBeEnabled();
    const repaired = await currentJob(page);
    const replaced = reviewed.segments[3];
    const fresh = repaired.segments[3];
    if (!replaced || !fresh) throw new Error("Scoped replacement missing");
    expect(fresh.id).not.toBe(replaced.id);
    expect(fresh.sourceText).toBe("Repaired source passage.");
    expect(fresh.startMs).toBe(330);
    expect(fresh.endMs).toBe(430);
    for (const cue of reviewed.segments.filter((cue) => cue.id !== replaced.id))
      expect(
        repaired.segments.find((candidate) => candidate.id === cue.id),
      ).toEqual(cue);
    expect(
      repaired.reviewReport?.assessments?.some(
        (assessment) =>
          assessment.segmentId === fresh.id && assessment.status === "current",
      ),
    ).toBe(false);
    await selectReviewFilters(page, "all");
    await expect(
      page.getByTestId("segment-3").getByLabel("未检查", { exact: true }),
    ).toBeVisible();
    await startSubtitleReview(page);
    await expect.poll(() => mock.counters.review).toBe(2);
    await expect(
      page.getByTestId("segment-0").getByLabel("可疑度：无", { exact: true }),
    ).toBeVisible();
    // Changing a supplied neighbour invalidates even the formerly clear cue.
    await page.getByLabel("编辑字幕 2", { exact: true }).click();
    await page
      .getByLabel("原文", { exact: true })
      .fill("LOW: Updated train platform wording.");
    await page.getByRole("button", { name: "保存字幕", exact: true }).click();
    await expect(page.locator(".segment-editor")).toHaveCount(0);
    const changed = await currentJob(page);
    const clear = changed.segments[0];
    const flagged = changed.segments[2];
    const distant = changed.segments[33];
    if (!clear || !flagged || !distant)
      throw new Error("Context dependency fixtures missing");
    expect(
      changed.reviewReport?.assessments?.find(
        (assessment) => assessment.segmentId === clear.id,
      ),
    ).toMatchObject({ riskLevel: "none", status: "recheck" });
    expect(
      changed.reviewReport?.assessments?.find(
        (assessment) => assessment.segmentId === flagged.id,
      ),
    ).toMatchObject({ riskLevel: "medium", status: "recheck" });
    expect(
      changed.reviewReport?.assessments?.find(
        (assessment) => assessment.segmentId === distant.id,
      ),
    ).toMatchObject({ riskLevel: "none", status: "current" });
    await expect(
      page
        .getByTestId("segment-0")
        .getByLabel("上次可疑度：无，需复查", { exact: true }),
    ).toBeVisible();
    await expect(await reviewFilterChoice(page, 'none')).toHaveAccessibleName("无（3）");
    await page.screenshot({
      path: join(evidence, "contextual-neighbour-change-stale.png"),
    });
    await selectReviewFilters(page, "unchecked");
    await page.getByRole("button", { name: "全选", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1050, 700);
    });
    const pendingMinimumLayout = await gradeWorkspace(page, "pending-minimum");
    const previousListScroll = await page
      .locator(".subtitle-list")
      .evaluate((node) => {
        node.scrollTop = node.scrollHeight;
        return node.scrollTop;
      });
    await page
      .getByRole("button", { name: "可疑度判断标准", exact: true })
      .click();
    const help = page.getByRole("region", {
      name: "可疑度判断标准",
      exact: true,
    });
    await expect(
      page.getByRole("dialog", { name: "可疑度判断标准", exact: true }),
    ).toBeVisible();
    await expect(help).toContainText("v1");
    await expect(help).toContainText("未发现明显疑点");
    await expect(help).toContainText("需排除");
    await help.scrollIntoViewIfNeeded();
    const helpMinimumLayout = await gradeWorkspace(page, "help-minimum");
    await page.screenshot({
      path: join(evidence, "contextual-minimum-pending-standards.png"),
    });
    await help.locator("li").last().scrollIntoViewIfNeeded();
    expect(
      await page.locator(".subtitle-list").evaluate((node) => node.scrollTop),
    ).toBe(previousListScroll);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.getByRole('dialog', { name: '可疑度判断标准', exact: true }).getByRole('button', { name: '关闭对话框', exact: true }).click();
    await selectReviewFilters(page, "all");
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 960);
    });
    expect(mock.counters.translation).toBe(0);
    // An isolated SQLite fixture emulates a saved pre-grading report on restart.
    // Use the already-running Electron ABI; do not rebuild SQLite for ordinary Node.
    const old = changed.reviewReport;
    if (!old) throw new Error("Report missing before legacy fixture");
    const legacy = {
      ...changed,
      reviewReport: {
        id: old.id,
        profileId: old.profileId,
        providerFingerprint: old.providerFingerprint,
        completedAt: old.completedAt,
        state: old.state,
        reviewedSegmentIds: old.reviewedSegmentIds,
        fingerprints: old.fingerprints,
        findings: old.findings.map((finding) => ({
          id: finding.id,
          segmentId: finding.segmentId,
          category: finding.category,
          reason: finding.reason,
          status: finding.status,
          startMs: finding.startMs,
          endMs: finding.endMs,
        })),
      },
    };
    await app.evaluate(
      (_electron, fixture) => {
        const loadModule = process
          .getBuiltinModule("module")
          .createRequire(fixture.modulePath);
        const Database = loadModule("better-sqlite3") as typeof SqliteDatabase;
        const database = new Database(fixture.databasePath);
        try {
          database
            .prepare("UPDATE jobs SET payload = ? WHERE id = ?")
            .run(JSON.stringify(fixture.job), fixture.job.id);
        } finally {
          database.close();
        }
      },
      {
        databasePath: join(userData, "app.db"),
        modulePath: resolve("package.json"),
        job: legacy,
      },
    );
    await app.close();
    app = undefined;
    const next = await launchApp(userData, [], []);
    app = next.app;
    await expect(
      next.page
        .getByTestId("segment-0")
        .getByLabel("待重新检查", { exact: true }),
    ).toBeVisible();
    await expect(
      next.page.getByLabel("可疑度：无", { exact: true }),
    ).toHaveCount(0);
    expect(
      (await currentJob(next.page)).reviewReport?.assessments,
    ).toBeUndefined();
    await next.page.screenshot({
      path: join(evidence, "contextual-legacy-ungraded.png"),
    });
    await writeFile(
      join(evidence, "contextual-four-grade-workflow.json"),
      JSON.stringify(
        {
          model:
            "Deterministic loopback HTTP assessments; actual Electron preload/IPC/SQLite/FFmpeg crop, no paid API",
          rubricVersion: report.rubric.version,
          cueCount: 34,
          initialGrades: { none: 30, low: 1, medium: 2, high: 1 },
          suppliedContexts: prompts.map((prompt) => ({
            selectedAliases: prompt.groups.flatMap((group) => group.targets),
            contextAliases: prompt.groups.map((group) => group.context),
          })),
          crossBatchNeighbourText: true,
          currentGradeFilterCounts: true,
          selectedHighOnlyRepair: true,
          otherCuesPreserved: true,
          neighbourEditStalesPreviouslyClearAndFlagged: true,
          unrelatedContextStaysCurrent: true,
          legacyNeverMeansNone: true,
          minimumLayout: {
            selectedMinimumLayout,
            pendingMinimumLayout,
            helpMinimumLayout,
          },
          counters: mock.counters,
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(evidence, "contextual-review-prompts.json"),
      JSON.stringify(mock.reviewPrompts.map(readPrompt), null, 2),
    );
  } finally {
    await app?.close();
    await mock.close();
  }
});
