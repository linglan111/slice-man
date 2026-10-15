import { primarySubtitleText } from "../../../../shared/subtitle-content";
import {
  chapterSourceFingerprint,
  chapterReviewFingerprint,
  refreshChapters,
  validateChapterPlan,
  newCoveragePlan,
  createChapterRequest,
  groundChapterResponse,
  chapterTargets,
} from "./chapters";
import { boundedChapterPieces, orderedChapterWorkers } from "./chapter-work";
import {
  planChaptersInputSchema,
  updateChaptersInputSchema,
  MAX_CHAPTER_MS,
  CHAPTER_REVIEW_THRESHOLD_MS,
  type PlanChaptersInput,
  type UpdateChaptersInput,
  type ChapterCriterionSnapshot,
  type ChapterPlan,
  type ChapterReviewRun,
  type Chapter,
} from "../../../../shared/chapter-contracts";
import type { ProviderDiagnosticsRepository } from "../../../db/provider-diagnostics";
import type { TextRequestContext } from "../../providers/lib/text-request";
import type { TextOperation, ProviderDiagnostic } from "../../../../shared/provider-diagnostics-contracts";
import {
  resolveReprocess,
  resolveReviewInput,
  refreshReview,
  cueFingerprint,
  providerFingerprint,
  neighboringContext,
  staleReview,
} from "./reprocessing";
import {
  createReviewRequest,
  validateReviewResponse,
  reviewCorrectionPrompt,
} from "./review-request";
import { assertReviewPromptBudget, MAX_REVIEW_TARGETS } from "./review-request";
import {
  groundNames,
  nameTimelineFingerprint,
  draftNameApply,
  draftNameUndo,
} from "./person-names";
import { createPersonNameRequest } from "./person-name-request";
import {
  analyzeNamesInputSchema,
  applyNamesInputSchema,
  undoNamesInputSchema,
  type AnalyzeNamesInput,
  type ApplyNamesInput,
  type UndoNamesInput,
} from "../../../../shared/person-name-contracts";
import {
  reprocessInputSchema,
  recognizePartialInputSchema,
  reviewSubtitlesInputSchema,
  acknowledgeFindingInputSchema,
  repairLoopInputSchema,
  type RepairLoopInput,
  type RepairRun,
  type ImportOptions,
  type ReprocessInput,
  type RecognizePartialInput,
  type ReprocessPlan,
  type PlanReprocessInput,
  type ReviewSubtitlesInput,
  type AcknowledgeFindingInput,
  type ReviewFinding,
  type ReviewAssessment,
  type ReviewContextGroup,
  REVIEW_RUBRIC,
  REVIEW_RUBRIC_VERSION,
} from "../../../../shared/contracts";
import { createHash, randomUUID } from "node:crypto";
import {
  exportVideoOptionsSchema,
  type ExportVideoOptions,
} from "../../../../shared/export-contracts";
import { join, basename, dirname, resolve, sep } from "node:path";
import { mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import type {
  Job,
  JobOptions,
  ProgressEvent,
  Segment,
  NewSegment,
  StageName,
  SubtitleStyle,
} from "../../../../shared/contracts";
import {
  DEFAULT_STYLE,
  optionsSchema,
  styleSchema,
  segmentSchema,
  newSegmentSchema,
  idSchema,
  importOptionsSchema,
} from "../../../../shared/contracts";
import type { Store } from "../../../db/store";
import { publish } from "../../media/lib/media-service";
import type { MediaService } from "../../media/lib/media-service";
import type { RuntimeAccess } from "../types";
import { AppError, checkAbort } from "../../../lib/errors";
import { runProcess } from "../../../lib/process";
import {
  scopedCues,
  missingAssessments,
  repairCandidates,
  planRepairRound,
} from "./repair-loop";
import { hasGpuExecution } from "../../runtime/artifacts";
import {
  normalizeCloud,
  normalizeWhisper,
  mergeChunkSegments,
  validateTimeline,
} from "../../subtitles/lib/timeline";
import { compileSubtitles } from "../../subtitles/lib/compiler";
import {
  generateText,
  parseJson,
  transcribe,
  translateBatch,
  translationPrompt,
} from "../../providers/lib/text-provider";
function initialStages(): Job["stages"] {
  return Object.fromEntries(
    ["recognize", "translate", "style", "preview", "export"].map((name) => [
      name,
      { state: "idle", progress: 0, message: "" },
    ]),
  ) as Job["stages"];
}
export class JobService {
  private active:
    | { id: string; controller: AbortController; profileIds?: string[] }
    | undefined;
  constructor(
    private readonly store: Store,
    private readonly media: MediaService,
    private readonly runtime: RuntimeAccess,
    private readonly root: string,
    private readonly emit: (event: ProgressEvent) => void,
    private readonly url: (path: string) => string,
    private readonly diagnostics?: ProviderDiagnosticsRepository,
  ) {}
  private textContext(
    operation: TextOperation,
    jobId: string,
    ids: string[],
    progress?: (value: number, message: string) => void,
    runId?: string,
    chapterId?: string,
    targetCount?: number,
  ): TextRequestContext | undefined {
    if (!this.diagnostics) return undefined;
    return {
      diagnostics: this.diagnostics,
      operation,
      jobId,
      runId,
      chapterId,
      targetCount,
      onRequestComplete: (id) => ids.push(id),
      onProgress: (record) => {
        const live = this.diagnostics?.live({ requestId: record.id })[0];
        const status = live?.phase === "thinking" ? "模型思考中" : live?.phase === "answer" ? "正在输出结果"
          : ({ waiting: "等待 AI 响应", receiving: "等待模型输出", transport_complete: "正在校验 AI 输出", validated: "AI 输出已校验", published: "AI 结果已保存", failed: "AI 请求失败", cancelled: "AI 请求已取消", interrupted: "AI 请求已中断" } satisfies Record<ProviderDiagnostic["state"], string>)[record.state];
        const bytes = live?.phase === "answer" ? `结果 ${record.textBytes} 字节` : `已接收 ${record.wireBytes} 字节`;
        progress?.(0, `${status} · ${Math.floor(record.elapsedMs / 1000)} 秒 · ${bytes}`);
      },
    };
  }
  private validatedRequest(ids: string[]): string[] {
    const id = ids.at(-1);
    if (id) this.diagnostics?.markValidated(id);
    return id ? [id] : [];
  }
  private saveWithRequests(job: Job, ids: string[] = []): Job {
    if (!this.diagnostics || !ids.length) return this.store.saveJob(job);
    // Jobs and diagnostics share the same SQLite connection. A failed log write
    // rolls back publication too, so a saved chapter is never reported as lost.
    return this.store.sqlite.transaction(() => {
      this.store.saveJob(job);
      for (const id of ids) this.diagnostics?.markPublished(id);
      return job;
    })();
  }
  private validationFailed(ids: string[], error: unknown): void {
    const id = ids.at(-1);
    if (id && this.diagnostics?.detail(id).state === "transport_complete")
      this.diagnostics.markValidationFailed(
        id,
        error instanceof AppError ? error.code : "INVALID_JSON",
      );
  }
  assertIdle(): void {
    if (this.active)
      throw new AppError("JOB_BUSY", "已有任务运行，请等待或取消");
  }
  async waitForIdle(): Promise<void> {
    while (this.active)
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  async runChapterExport<T>(
    jobId: string,
    revision: number,
    executor: (
      snapshot: Job,
      signal: AbortSignal,
      assertFresh: () => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    const snapshot = this.editableTimeline(jobId, revision);
    const lease = { id: jobId, controller: new AbortController() };
    this.active = lease;
    const assertFresh = async (): Promise<void> => {
      await this.identity(snapshot);
      checkAbort(lease.controller.signal);
      const current = this.store.getJob(jobId);
      if (
        current.revision !== revision ||
        chapterSourceFingerprint(current) !==
          chapterSourceFingerprint(snapshot) ||
        JSON.stringify(current.options) !== JSON.stringify(snapshot.options) ||
        JSON.stringify([current.chapterPlan, current.customChapterPlan]) !==
          JSON.stringify([snapshot.chapterPlan, snapshot.customChapterPlan])
      )
        throw new AppError(
          "STALE_REVISION",
          "导出期间源字幕、章节或设置已改变",
        );
    };
    try {
      await assertFresh();
      return await executor(snapshot, lease.controller.signal, assertFresh);
    } finally {
      if (this.active === lease) this.active = undefined;
    }
  }
  async planChapters(
    raw: PlanChaptersInput,
    trustedCriterion?: ChapterCriterionSnapshot,
  ): Promise<Job> {
    const input = planChaptersInputSchema.parse(raw);
    const snapshot = this.editableTimeline(input.jobId, input.revision);
    if (
      (input.kind === "custom" &&
        (!trustedCriterion || trustedCriterion.id !== input.criterionId)) ||
      (input.kind === "normal" && (trustedCriterion || input.criterionId))
    )
      throw new AppError("CHAPTER_CRITERION", "请选择有效的章节切分标准");
    const profileId = input.profileId ?? snapshot.options.chapterProfileId;
    if (!profileId) throw new AppError("PROFILE_MISSING", "请选择章节分析服务");
    const lease = {
      id: input.jobId,
      controller: new AbortController(),
      profileIds: [profileId],
    };
    this.active = lease;
    try {
      const plan = await this.draftChapterPlan(
        snapshot,
        profileId,
        input.kind,
        lease.controller.signal,
        trustedCriterion,
      );
      checkAbort(lease.controller.signal);
      const current = this.store.getJob(input.jobId);
      if (
        current.revision !== snapshot.revision ||
        chapterSourceFingerprint(current) !== chapterSourceFingerprint(snapshot)
      )
        throw new AppError("STALE_REVISION", "分析期间字幕已改变，请重新分析");
      if (input.kind === "normal") {
        current.chapterPlan = plan;
        if (current.reviewRun) current.reviewRun.state = "stale";
      } else current.customChapterPlan = plan;
      this.update(current, this.planRequestIds.get(plan) ?? []);
      this.planRequestIds.delete(plan);
      return current;
    } finally {
      if (this.active === lease) this.active = undefined;
    }
  }
  updateChapters(raw: UpdateChaptersInput): Job {
    const input = updateChaptersInputSchema.parse(raw);
    const job = this.editableTimeline(input.jobId, input.revision);
    const key =
      job.chapterPlan?.id === input.planId
        ? "chapterPlan"
        : "customChapterPlan";
    const plan = job[key];
    if (
      !plan ||
      plan.id !== input.planId ||
      plan.revision !== input.planRevision ||
      plan.state !== "current"
    )
      throw new AppError("STALE_CHAPTERS", "章节已改变或过期，请刷新");
    job[key] = validateChapterPlan(
      { ...plan, revision: plan.revision + 1, chapters: input.chapters },
      job.media.durationMs,
    );
    if (key === "chapterPlan" && job.reviewRun) job.reviewRun.state = "stale";
    return this.update(job);
  }
  private readonly planRequestIds = new WeakMap<ChapterPlan, string[]>();
  private async draftChapterPlan(
    snapshot: Job,
    profileId: string,
    kind: ChapterPlan["kind"],
    signal: AbortSignal,
    criterion?: ChapterCriterionSnapshot,
  ): Promise<ChapterPlan> {
    if (!snapshot.segments.length)
      throw new AppError("NO_SEGMENTS", "请先生成字幕再分析章节");
    const profile = this.store.getProfile(profileId);
    const fingerprint = providerFingerprint(profile);
    const key = this.store.key(profileId);
    const request = createChapterRequest(snapshot, kind, criterion);
    const ids: string[] = [];
    const progress = (value: number, message: string): void =>
      this.emit({
        jobId: snapshot.id,
        stage: "chapters",
        progress: value,
        message,
        job: this.store.getJob(snapshot.id),
      });
    progress(0, "正在依据全片字幕分析章节");
    let plan: ChapterPlan;
    try {
      const raw = parseJson(
        await generateText(
          profile,
          key,
          request.prompt,
          signal,
          this.textContext(
            "chapters",
            snapshot.id,
            ids,
            progress,
            undefined,
            undefined,
            snapshot.segments.length,
          ),
        ),
      );
      checkAbort(signal);
      plan = groundChapterResponse(
        raw,
        snapshot,
        kind,
        request.anchors,
        profileId,
        fingerprint,
        criterion,
      );
    } catch (error) {
      this.validationFailed(ids, error);
      throw error;
    }
    if (
      providerFingerprint(this.store.getProfile(profileId)) !== fingerprint ||
      this.store.key(profileId) !== key
    )
      throw new AppError("STALE_REVISION", "章节分析服务已改变");
    this.planRequestIds.set(plan, this.validatedRequest(ids));
    return plan;
  }
  private async normalPlan(
    snapshot: Job,
    fallbackProfile: string,
    signal: AbortSignal,
  ): Promise<Job> {
    refreshChapters(snapshot);
    if (snapshot.chapterPlan?.state === "current") return snapshot;
    const revision = snapshot.revision;
    const plan =
      snapshot.media.durationMs <= MAX_CHAPTER_MS
        ? newCoveragePlan(snapshot)
        : await this.draftChapterPlan(
            snapshot,
            snapshot.options.chapterProfileId ?? fallbackProfile,
            "normal",
            signal,
          );
    checkAbort(signal);
    const current = this.store.getJob(snapshot.id);
    if (
      current.revision !== revision ||
      chapterSourceFingerprint(current) !==
        chapterSourceFingerprint(snapshot) ||
      JSON.stringify(current.options) !== JSON.stringify(snapshot.options)
    )
      throw new AppError("STALE_REVISION", "规划期间字幕或设置已改变");
    current.chapterPlan = plan;
    this.update(current, this.planRequestIds.get(plan) ?? []);
    this.planRequestIds.delete(plan);
    return current;
  }
  async importVideo(
    path: string,
    signal?: AbortSignal,
    rawOptions?: ImportOptions,
  ): Promise<Job> {
    const initialOptions = importOptionsSchema.parse(rawOptions ?? {});
    checkAbort(signal);
    const media = await this.media.probe(path, signal);
    checkAbort(signal);
    const now = Date.now();
    const job: Job = {
      id: randomUUID(),
      name: basename(path),
      inputPath: path,
      media,
      options: optionsSchema.parse(initialOptions),
      segments: [],
      style: structuredClone(DEFAULT_STYLE),
      revision: 0,
      createdAt: now,
      updatedAt: now,
      stages: initialStages(),
      outputs: [],
    };
    const workspace = this.workspace(job.id);
    try {
      await mkdir(workspace, { recursive: true });
      const info = await stat(path);
      await writeFile(
        join(workspace, "input-identity.json"),
        JSON.stringify({ size: info.size, mtimeMs: info.mtimeMs }),
      );
      checkAbort(signal);
      return this.store.saveJob(job);
    } catch (error) {
      if (!resolve(workspace).startsWith(resolve(this.root, "jobs") + sep))
        throw error;
      await rm(workspace, { recursive: true, force: true });
      throw error;
    }
  }
  private workspace(id: string): string {
    return join(this.root, "jobs", id);
  }
  private update(job: Job, requestIds: string[] = []): Job {
    refreshReview(job);
    this.saveWithRequests(job, requestIds);
    this.emit({
      jobId: job.id,
      stage: "preview",
      progress: 0,
      message: "任务已更新",
      job,
    });
    return job;
  }
  private invalidate(job: Job): void {
    delete job.previewUrl;
    job.stages.preview = {
      state: "idle",
      progress: 0,
      message: "字幕已修改，需重新预览",
    };
    job.stages.export = { state: "idle", progress: 0, message: "" };
  }
  updateOptions(id: string, raw: JobOptions): Job {
    const options = optionsSchema.parse(raw);
    if (this.active)
      throw new AppError("JOB_BUSY", "已有任务运行，请等待或取消");
    const job = this.store.getJob(id);
    const previous = job.options;
    if (JSON.stringify(previous) === JSON.stringify(options)) return job;
    const {
      reviewProfileId: previousReview,
      chapterProfileId: previousChapter,
      chapterConcurrency: _previousConcurrency,
      ...previousContent
    } = previous;
    const {
      reviewProfileId: nextReview,
      chapterProfileId: nextChapter,
      chapterConcurrency: _nextConcurrency,
      ...nextContent
    } = options;
    if (previousReview !== nextReview) staleReview(job);
    if (previousChapter !== nextChapter) {
      for (const plan of [job.chapterPlan, job.customChapterPlan])
        if (plan) plan.state = "stale";
      if (job.reviewRun) job.reviewRun.state = "stale";
    }
    if (JSON.stringify(previousContent) === JSON.stringify(nextContent)) {
      job.options = options;
      return this.update(job);
    }
    const recognitionChanged = [
      "sourceLanguage",
      "recognition",
      "recognitionProfileId",
      "modelId",
    ].some(
      (key) =>
        previous[key as keyof JobOptions] !== options[key as keyof JobOptions],
    );
    const translationChanged =
      recognitionChanged ||
      previous.targetLanguage !== options.targetLanguage ||
      previous.translationProfileId !== options.translationProfileId;
    if (recognitionChanged)
      job.stages.recognize = {
        state: "idle",
        progress: 0,
        message: "识别设置已改变，需重新识别",
      };
    if (translationChanged) {
      job.segments = job.segments.map((s) => ({
        ...s,
        translationStale: true,
      }));
      job.stages.translate = {
        state: "idle",
        progress: 0,
        message: "翻译设置已改变，需重新翻译",
      };
    }
    if (
      previous.reviewProfileId !== options.reviewProfileId &&
      job.reviewReport
    )
      job.reviewReport.state = "stale";
    job.options = options;
    job.revision++;
    this.invalidate(job);
    return this.update(job);
  }
  editSegment(id: string, raw: Segment, revision: number): Job {
    const job = this.editableTimeline(id, revision);
    const segment = segmentSchema.parse(raw);
    const previous = job.segments.find((s) => s.id === segment.id);
    if (!previous) throw new AppError("NOT_FOUND", "字幕不存在");
    if (segment.sourceText !== previous.sourceText)
      segment.translationStale = true;
    else if (segment.translatedText !== previous.translatedText)
      segment.translationStale = false;
    job.segments = validateTimeline(
      job.segments.map((s) => (s.id === segment.id ? segment : s)),
      job.media.durationMs,
    );
    job.revision++;
    this.invalidate(job);
    return this.update(job);
  }
  private editableTimeline(id: string, revision: number): Job {
    if (this.active)
      throw new AppError("JOB_BUSY", "已有任务运行，请等待或取消");
    const job = this.store.getJob(id);
    if (job.revision !== revision)
      throw new AppError("STALE_REVISION", "字幕已更新，请刷新后再保存");
    return job;
  }
  addSegment(id: string, raw: NewSegment, revision: number): Job {
    const job = this.editableTimeline(id, revision);
    const input = newSegmentSchema.parse(raw);
    if (job.segments.length >= 10000)
      throw new AppError("SEGMENT_LIMIT", "字幕数量已达上限（10000 条）");
    const wasEmpty = job.segments.length === 0;
    const segment: Segment = {
      ...input,
      id: randomUUID(),
      translatedText: input.translatedText ?? "",
      translationStale: !input.translatedText?.trim(),
    };
    job.segments = validateTimeline(
      [...job.segments, segment],
      job.media.durationMs,
    );
    if (wasEmpty && job.stages.recognize.state !== "succeeded")
      job.stages.recognize = {
        state: "succeeded",
        progress: 1,
        message: "手工字幕已保存，可直接翻译或导出",
      };
    if (segment.translationStale)
      job.stages.translate = {
        state: "idle",
        progress: 0,
        message: "新增字幕尚未翻译，可翻译现有字幕",
      };
    job.revision++;
    this.invalidate(job);
    return this.update(job);
  }
  removeSegment(id: string, segmentId: string, revision: number): Job {
    const job = this.editableTimeline(id, revision);
    idSchema.parse(segmentId);
    if (!job.segments.some((segment) => segment.id === segmentId))
      throw new AppError("NOT_FOUND", "字幕不存在");
    job.segments = validateTimeline(
      job.segments.filter((segment) => segment.id !== segmentId),
      job.media.durationMs,
    );
    job.style = {
      ...job.style,
      emphasisBySegment: job.style.emphasisBySegment.filter(
        (emphasis) => emphasis.segmentId !== segmentId,
      ),
    };
    job.revision++;
    this.invalidate(job);
    return this.update(job);
  }
  setStyle(id: string, raw: SubtitleStyle): Job {
    if (this.active)
      throw new AppError("JOB_BUSY", "已有任务运行，请等待或取消");
    const style = styleSchema.parse(raw);
    const job = this.store.getJob(id);
    this.validateStyleReferences(style, job);
    job.style = style;
    job.revision++;
    this.invalidate(job);
    return this.update(job);
  }
  private validateStyleReferences(style: SubtitleStyle, job: Job): void {
    for (const emphasis of style.emphasisBySegment) {
      const segment = job.segments.find((s) => s.id === emphasis.segmentId);
      if (
        !segment ||
        emphasis.keywords.some(
          (k) =>
            !primarySubtitleText(
              segment,
              job.options.translationEnabled,
            ).includes(k),
        )
      )
        throw new AppError(
          "STYLE_REFERENCE",
          "强调关键词不在当前字幕中，请重新生成样式",
        );
    }
  }
  cancel(id: string): void {
    if (this.active?.id === id) this.active.controller.abort();
  }
  cancelAll(): void {
    this.active?.controller.abort();
  }
  async analyzeNames(raw: AnalyzeNamesInput): Promise<Job> {
    const input = analyzeNamesInputSchema.parse(raw);
    const snapshot = this.editableTimeline(input.jobId, input.revision);
    if (!snapshot.segments.length)
      throw new AppError("NO_SEGMENTS", "没有可检查的字幕");
    if (snapshot.segments.length > MAX_REVIEW_TARGETS)
      throw new AppError(
        "TEXT_LIMIT",
        "人名整批检查最多 2000 条字幕，不会自动拆分请求",
      );
    if (!snapshot.options.reviewProfileId)
      throw new AppError("PROFILE_MISSING", "请选择 AI 字幕检查服务");
    const profile = this.store.getProfile(snapshot.options.reviewProfileId);
    const fingerprint = providerFingerprint(profile);
    const key = this.store.key(profile.id);
    const prompt = createPersonNameRequest(snapshot);
    assertReviewPromptBudget(prompt, 0);
    const controller = new AbortController();
    this.active = { id: input.jobId, controller };
    const progress = (
      value: number,
      message: string,
      job = this.store.getJob(input.jobId),
    ): void =>
      this.emit({
        jobId: input.jobId,
        stage: "names",
        progress: value,
        message,
        job,
      });
    try {
      progress(
        0,
        `等待 AI 整批分析 ${snapshot.segments.length} 条字幕中的人名`,
      );
      const requestIds: string[] = [];
      let candidates: ReturnType<typeof groundNames>;
      try {
        const rawResult = parseJson(
          await generateText(
            profile,
            key,
            prompt,
            controller.signal,
            this.textContext(
              "names",
              snapshot.id,
              requestIds,
              progress,
              undefined,
              undefined,
              snapshot.segments.length,
            ),
          ),
        );
        checkAbort(controller.signal);
        progress(0, "正在核对人名的实际出现位置与次数");
        candidates = groundNames(snapshot, rawResult);
      } catch (error) {
        this.validationFailed(requestIds, error);
        throw error;
      }
      const validatedIds = this.validatedRequest(requestIds);
      checkAbort(controller.signal);
      const current = this.store.getJob(input.jobId);
      if (
        current.revision !== input.revision ||
        nameTimelineFingerprint(current) !==
          nameTimelineFingerprint(snapshot) ||
        current.options.reviewProfileId !== profile.id ||
        providerFingerprint(this.store.getProfile(profile.id)) !==
          fingerprint ||
        this.store.key(profile.id) !== key
      )
        throw new AppError(
          "STALE_REVISION",
          "分析期间字幕或检查服务已改变，请重新分析",
        );
      checkAbort(controller.signal);
      current.nameReport = {
        version: 1,
        id: randomUUID(),
        profileId: profile.id,
        providerFingerprint: fingerprint,
        revision: input.revision,
        createdAt: Date.now(),
        translationEnabled: snapshot.options.translationEnabled,
        timelineFingerprint: nameTimelineFingerprint(snapshot),
        state: "current",
        candidates,
      };
      this.saveWithRequests(current, validatedIds);
      progress(
        1,
        `人名检查完成：${candidates.length} 个重复出现的人名`,
        current,
      );
      return current;
    } catch (error) {
      progress(
        1,
        controller.signal.aborted
          ? "人名检查已取消，保留上次结果"
          : "人名检查未完成，保留上次结果",
      );
      throw error;
    } finally {
      this.active = undefined;
    }
  }
  applyNames(raw: ApplyNamesInput): Job {
    const input = applyNamesInputSchema.parse(raw);
    const job = this.editableTimeline(input.jobId, input.revision);
    const report = job.nameReport;
    if (
      !report ||
      report.id !== input.reportId ||
      report.state !== "current" ||
      report.timelineFingerprint !== nameTimelineFingerprint(job) ||
      report.profileId !== job.options.reviewProfileId ||
      providerFingerprint(this.store.getProfile(report.profileId)) !==
        report.providerFingerprint
    )
      throw new AppError("STALE_NAMES", "人名检查结果已过期，请重新分析");
    const draft = draftNameApply(job, report, input.mappings);
    if (!draft.changed) return job;
    job.segments = validateTimeline(draft.segments, job.media.durationMs);
    styleSchema.parse(draft.style);
    job.style = draft.style;
    job.nameBatch = draft.batch;
    job.revision++;
    this.invalidate(job);
    return this.update(job);
  }
  undoNames(raw: UndoNamesInput): Job {
    const input = undoNamesInputSchema.parse(raw);
    const job = this.editableTimeline(input.jobId, input.revision);
    if (!job.nameBatch || job.nameBatch.id !== input.batchId)
      throw new AppError("NOT_FOUND", "这次人名修改已被更新的批次替代");
    const draft = draftNameUndo(job, job.nameBatch);
    job.segments = validateTimeline(draft.segments, job.media.durationMs);
    styleSchema.parse(draft.style);
    job.style = draft.style;
    job.nameBatch = draft.batch;
    if (draft.changed) {
      job.revision++;
      this.invalidate(job);
    }
    return this.update(job);
  }
  assertProfileWritable(id?: string): void {
    if (!this.active) return;
    const options = this.store.getJob(this.active.id).options;
    if (
      id &&
      (this.active.profileIds?.includes(id) ||
        [
          options.recognitionProfileId,
          options.translationProfileId,
          options.reviewProfileId,
          options.styleProfileId,
          options.chapterProfileId,
        ].includes(id))
    )
      throw new AppError(
        "JOB_BUSY",
        "此服务正在任务中使用，请等待或取消后修改",
      );
  }
  private async identity(job: Job): Promise<void> {
    try {
      const raw = JSON.parse(
        await readFile(
          join(this.workspace(job.id), "input-identity.json"),
          "utf8",
        ),
      ) as { size: number; mtimeMs: number };
      const actual = await stat(job.inputPath);
      if (
        raw.size !== actual.size ||
        Math.abs(raw.mtimeMs - actual.mtimeMs) > 1
      )
        throw new AppError("INPUT_CHANGED", "原视频已改变，请重新导入");
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("INPUT_MISSING", "原视频不存在或无法访问，请重新导入");
    }
  }
  private async stage<T>(
    id: string,
    name: StageName,
    operation: (
      signal: AbortSignal,
      progress: (value: number, message: string) => void,
    ) => Promise<T>,
    completion?: () => { message: string; state: "idle" | "succeeded" },
  ): Promise<T> {
    if (this.active)
      throw new AppError("JOB_BUSY", "已有任务运行，请等待或取消");
    const controller = new AbortController();
    this.active = { id, controller };
    const progress = (value: number, message: string): void => {
      const job = this.store.getJob(id);
      job.stages[name] = { state: "running", progress: value, message };
      this.store.saveJob(job);
      this.emit({ jobId: id, stage: name, progress: value, message, job });
    };
    try {
      progress(0, "处理中");
      const result = await operation(controller.signal, progress);
      // Partial operations publish their final stage and content in one transaction.
      // After that commit cancellation cannot turn a successful publication into failure.
      if (completion) return result;
      checkAbort(controller.signal);
      const job = this.store.getJob(id);
      const completed = {
        state: "succeeded" as const,
        message: "完成",
      };
      job.stages[name] = { ...completed, progress: 1 };
      this.update(job);
      this.emit({
        jobId: id,
        stage: name,
        progress: 1,
        message: completed.message,
        job,
      });
      return result;
    } catch (error) {
      const job = this.store.getJob(id);
      const cancelled = controller.signal.aborted;
      const code = error instanceof AppError ? error.code : "OPERATION_FAILED";
      job.stages[name] = {
        state: cancelled ? "cancelled" : "failed",
        progress: job.stages[name].progress,
        message: cancelled
          ? "已取消"
          : error instanceof AppError
            ? error.message
            : "处理失败，请检查配置和文件后重试",
        code,
      };
      this.update(job);
      throw error;
    } finally {
      this.active = undefined;
    }
  }
  recognize(id: string): Promise<Job> {
    return this.runRecognition(id);
  }
  recognizeAgain(id: string, revision: number): Promise<Job> {
    return this.runRecognition(id, revision);
  }
  private async runRecognition(
    id: string,
    expectedRevision?: number,
  ): Promise<Job> {
    if (expectedRevision !== undefined && this.active)
      throw new AppError("JOB_BUSY", "已有任务运行，请等待或取消");
    const cached = this.store.getJob(id);
    if (expectedRevision !== undefined && cached.revision !== expectedRevision)
      throw new AppError("STALE_REVISION", "字幕已更新，请刷新后重新确认识别");
    if (
      expectedRevision === undefined &&
      cached.stages.recognize.state === "succeeded"
    ) {
      await this.identity(cached);
      return cached;
    }
    await this.stage(id, "recognize", async (signal, progress) => {
      const snapshot = this.store.getJob(id);
      const revision = snapshot.revision;
      await this.identity(snapshot);
      if (!snapshot.media.hasAudio)
        throw new AppError("NO_AUDIO", "视频没有音轨");
      const { segments, actualBackend } = await this.recognizeAudio(
        snapshot,
        0,
        snapshot.media.durationMs,
        signal,
        progress,
      );
      checkAbort(signal);
      const current = this.store.getJob(id);
      if (current.revision !== revision)
        throw new AppError(
          "STALE_REVISION",
          "处理期间字幕或配置已改变，请重试",
        );
      current.segments = validateTimeline(segments, snapshot.media.durationMs);
      current.actualBackend = actualBackend;
      // New recognition can recycle cue IDs for unrelated speech. Preserve the
      // selected global design, but never carry old cue-bound emphasis forward.
      current.style = { ...current.style, emphasisBySegment: [] };
      current.revision++;
      current.stages.translate = { state: "idle", progress: 0, message: "" };
      current.stages.style = {
        state: "idle",
        progress: 0,
        message: "字幕已重新识别，保留全局样式；可按新字幕重新设计。",
      };
      this.invalidate(current);
      this.update(current);
    });
    return this.store.getJob(id);
  }
  private async recognizeAudio(
    snapshot: Job,
    startMs: number,
    endMs: number,
    signal: AbortSignal,
    progress: (value: number, message: string) => void,
    prefix = "",
  ): Promise<{ segments: Segment[]; actualBackend: Job["actualBackend"] }> {
    const id = snapshot.id;
    const options = snapshot.options;
    let segments: Segment[] = [];
    let actualBackend: Job["actualBackend"];
    if (options.recognition === "cloud") {
      if (!options.recognitionProfileId)
        throw new AppError("PROFILE_MISSING", "请选择云端识别配置");
      const profile = this.store.getProfile(options.recognitionProfileId);
      const key = this.store.key(profile.id);
      const chunkMs = Math.min(
        600000,
        Math.floor((profile.maxUploadBytes - 1000) / 32),
      );
      if (chunkMs < 1000)
        throw new AppError("UPLOAD_LIMIT", "配置的上传限制过小");
      for (
        let start = Math.max(startMs, snapshot.media.audioOffsetMs), index = 0;
        start < endMs;
        start += chunkMs, index++
      ) {
        checkAbort(signal);
        const length = Math.min(chunkMs, endMs - start);
        const audio = join(this.workspace(id), `${prefix}audio-${index}.wav`);
        await this.media.extract(
          snapshot.inputPath,
          audio,
          start,
          length,
          signal,
        );
        const recognized = normalizeCloud(
          await transcribe(
            profile,
            key,
            await readFile(audio),
            signal,
            options.sourceLanguage,
          ),
          start + Math.max(0, snapshot.media.audioOffsetMs - start),
          start + length,
          `cloud-${index}`,
        );
        segments = mergeChunkSegments(segments, recognized);
        progress(
          Math.min(0.95, (start + length - startMs) / (endMs - startMs)),
          "云端识别",
        );
      }
      actualBackend = "cloud";
    } else {
      const audio = join(this.workspace(id), `${prefix}audio.wav`);
      await this.media.extract(
        snapshot.inputPath,
        audio,
        startMs,
        endMs - startMs,
        signal,
      );
      const model = this.runtime.modelPath(options.modelId);
      let runtime = this.runtime.executable(options.preferGpu);
      const output = join(
        this.workspace(id),
        `${prefix}whisper-${randomUUID()}`,
      );
      const backendReceipt = join(
        this.workspace(id),
        `${prefix}recognition-backend.json`,
      );
      await rm(backendReceipt, { force: true });
      const invoke = async (): Promise<void> => {
        const result = await runProcess(
          runtime.path,
          [
            "-m",
            model,
            "-f",
            audio,
            // Do not condition later audio windows on earlier decoded text:
            // an incorrect phrase can otherwise reinforce a long-video loop.
            "-mc",
            "0",
            "-oj",
            "-of",
            output,
            "-l",
            options.sourceLanguage === "auto"
              ? "auto"
              : (options.sourceLanguage.toLowerCase().split("-")[0] ?? "auto"),
            ...(runtime.backend === "cpu" ? ["-ng"] : []),
          ],
          {
            signal,
            onStderr: (text) => {
              const match = /progress\s*=\s*(\d+)/i.exec(text);
              if (match?.[1]) progress(Number(match[1]) / 100, "本地识别");
            },
          },
        );
        const gpuExecutionVerified = hasGpuExecution(result.stderr);
        const stderrProof = result.stderr
          .split(/\r?\n/)
          .filter((line) =>
            /CUDA\d+.*(?:total size|compute buffer|model buffer)|using CUDA\d+ backend/i.test(
              line,
            ),
          )
          .slice(0, 8)
          .map((line) => line.trim())
          .join("\n")
          .slice(0, 4000);
        await writeFile(
          backendReceipt,
          JSON.stringify({
            backend: runtime.backend,
            gpuExecutionVerified,
            stderrProof,
          }),
          "utf8",
        );
        if (runtime.backend === "gpu" && !gpuExecutionVerified)
          throw new AppError(
            "GPU_UNAVAILABLE",
            "GPU 未完成实际识别，使用 CPU 重试。",
          );
      };
      try {
        await invoke();
      } catch (error) {
        if (signal.aborted || runtime.backend === "cpu") throw error;
        runtime = this.runtime.executable(false);
        progress(0.1, "GPU 运行失败，使用 CPU 重试");
        await invoke();
      }
      segments = normalizeWhisper(
        JSON.parse(await readFile(`${output}.json`, "utf8")),
        Math.max(startMs, snapshot.media.audioOffsetMs),
        endMs,
      );
      actualBackend = runtime.backend;
    }
    return { segments, actualBackend };
  }
  async translate(id: string, selectedIds?: string[]): Promise<Job> {
    this.requireTranslation(this.store.getJob(id));
    await this.stage(id, "translate", async (signal, progress) => {
      let snapshot = this.store.getJob(id);
      this.preflightTranslation(snapshot);
      if (snapshot.stages.recognize.state !== "succeeded")
        throw new AppError("RECOGNITION_REQUIRED", "请先完成当前设置的识别");
      const profileId = snapshot.options.translationProfileId;
      if (!profileId) throw new AppError("PROFILE_MISSING", "请选择翻译配置");
      const profile = this.store.getProfile(profileId);
      const fingerprint = providerFingerprint(profile);
      const key = this.store.key(profile.id);
      const selectedSet = selectedIds ? new Set(selectedIds) : undefined;
      if (
        selectedSet &&
        (selectedSet.size !== selectedIds?.length ||
          [...selectedSet].some(
            (cueId) => !snapshot.segments.some((cue) => cue.id === cueId),
          ))
      )
        throw new AppError("NOT_FOUND", "所选字幕不存在或重复");
      if (!snapshot.segments.length)
        throw new AppError("NO_SEGMENTS", "没有可翻译的字幕");
      const selected = snapshot.segments.filter((cue) =>
        selectedSet
          ? selectedSet.has(cue.id)
          : !cue.translatedText || cue.translationStale,
      );
      if (!selected.length) return;
      snapshot = await this.normalPlan(snapshot, profileId, signal);
      const plan = snapshot.chapterPlan;
      if (!plan) throw new AppError("CHAPTER_INVALID", "缺少完整章节");
      const source = chapterSourceFingerprint(snapshot);
      const options = JSON.stringify(snapshot.options);
      let revision = snapshot.revision;
      const groups = chapterTargets(plan, selected);
      const runId = randomUUID();
      const prepare = async (
        group: { chapter: Chapter; targets: Segment[] },
        index: number,
        workerSignal: AbortSignal,
      ): Promise<{ segments: Segment[]; ids: string[] }> => {
        const ids: string[] = [];
        const segments = await this.chapterTranslation(
          snapshot,
          group.targets,
          snapshot.segments,
          group.chapter,
          workerSignal,
          (value, message) =>
            progress(value, `章节 ${index + 1}/${groups.length} · ${message}`),
          ids,
          runId,
        );
        return { segments, ids };
      };
      if (selectedSet) {
        // Selected retranslation still publishes all selected chapters atomically.
        const results: { segments: Segment[]; ids: string[] }[] = [];
        await orderedChapterWorkers(
          groups,
          snapshot.options.chapterConcurrency ?? 2,
          signal,
          prepare,
          (result) => results.push(result),
        );
        checkAbort(signal);
        const current = this.translationCurrent(
          snapshot,
          revision,
          source,
          options,
          profile.id,
          fingerprint,
          key,
          plan,
        );
        this.applyTranslations(
          current,
          results.flatMap((result) => result.segments),
          results.flatMap((result) => result.ids),
        );
      } else {
        let completed = 0;
        await orderedChapterWorkers(
          groups,
          snapshot.options.chapterConcurrency ?? 2,
          signal,
          prepare,
          (result) => {
            checkAbort(signal);
            const current = this.translationCurrent(
              snapshot,
              revision,
              source,
              options,
              profile.id,
              fingerprint,
              key,
              plan,
            );
            this.applyTranslations(current, result.segments, result.ids);
            revision = current.revision;
            completed++;
            progress(
              completed / groups.length,
              `已保存完整章节 ${completed}/${groups.length}`,
            );
          },
          'ready',
        );
      }
    });
    return this.store.getJob(id);
  }
  private translationCurrent(
    snapshot: Job,
    revision: number,
    source: string,
    options: string,
    profileId: string,
    fingerprint: string,
    key: string,
    plan?: ChapterPlan,
  ): Job {
    const current = this.store.getJob(snapshot.id);
    if (
      current.revision !== revision ||
      chapterSourceFingerprint(current) !== source ||
      JSON.stringify(current.options) !== options ||
      providerFingerprint(this.store.getProfile(profileId)) !== fingerprint ||
      this.store.key(profileId) !== key ||
      (plan &&
        (current.chapterPlan?.id !== plan.id ||
          current.chapterPlan.revision !== plan.revision ||
          current.chapterPlan.state !== "current"))
    )
      throw new AppError(
        "STALE_REVISION",
        "翻译期间字幕、章节或服务已改变，未覆盖当前内容",
      );
    return current;
  }
  private applyTranslations(
    job: Job,
    translated: Segment[],
    requestIds: string[],
  ): void {
    const replacements = new Map(translated.map((cue) => [cue.id, cue]));
    job.segments = validateTimeline(
      job.segments.map((cue) => replacements.get(cue.id) ?? cue),
      job.media.durationMs,
    );
    job.revision++;
    this.invalidate(job);
    this.update(job, requestIds);
  }
  private async chapterTranslation(
    snapshot: Job,
    selected: Segment[],
    all: Segment[],
    chapter: Chapter | undefined,
    signal: AbortSignal,
    progress: (value: number, message: string) => void,
    published: string[],
    runId = randomUUID(),
  ): Promise<Segment[]> {
    const profileId = snapshot.options.translationProfileId;
    if (!profileId) throw new AppError("PROFILE_MISSING", "请选择翻译配置");
    const profile = this.store.getProfile(profileId);
    const fingerprint = providerFingerprint(profile);
    const key = this.store.key(profile.id);
    const translated = new Map<string, string>();
    const pieces = boundedChapterPieces(selected);
    for (const [index, targets] of pieces.entries()) {
      checkAbort(signal);
      const selectedIds = new Set(targets.map((cue) => cue.id));
      const context = neighboringContext(all, targets).filter(
        (cue) => !selectedIds.has(cue.id),
      );
      const prompt = translationPrompt(
        targets,
        context,
        snapshot.options.sourceLanguage,
        snapshot.options.targetLanguage,
        chapter,
      );
      if (Buffer.byteLength(prompt, "utf8") + 8192 > 512 * 1024)
        throw new AppError(
          "TEXT_LIMIT",
          "章节翻译工作单元超过 512 KiB，请缩短字幕",
        );
      const ids: string[] = [];
      progress(
        0,
        `工作单元 ${index + 1}/${pieces.length} · ${targets.length} 条字幕`,
      );
      const result = await translateBatch(
        profile,
        key,
        targets,
        context,
        snapshot.options.sourceLanguage,
        snapshot.options.targetLanguage,
        signal,
        this.textContext(
          "translate",
          snapshot.id,
          ids,
          progress,
          runId,
          chapter?.id,
          targets.length,
        ),
        chapter,
      );
      checkAbort(signal);
      if (
        providerFingerprint(this.store.getProfile(profileId)) !== fingerprint ||
        this.store.key(profileId) !== key
      )
        throw new AppError("STALE_REVISION", "翻译服务已改变");
      published.push(...this.validatedRequest(ids));
      for (const item of result) translated.set(item.id, item.text);
    }
    if (translated.size !== selected.length)
      throw new AppError("TRANSLATION_INCOMPLETE", "章节翻译未覆盖所有目标");
    return selected.map((cue) => ({
      ...cue,
      translatedText: translated.get(cue.id) ?? cue.translatedText,
      translationStale: false,
    }));
  }
  private requireTranslation(job: Job): void {
    if (!job.options.translationEnabled)
      throw new AppError(
        "TRANSLATION_DISABLED",
        "当前项目为原语言字幕，请先启用翻译",
      );
  }
  planReprocess(input: PlanReprocessInput): ReprocessPlan {
    const job = this.editableTimeline(input.jobId, input.revision);
    if (input.operation === "translate") this.requireTranslation(job);
    return resolveReprocess(job, input);
  }
  private async draftTranslations(
    snapshot: Job,
    selected: Segment[],
    all: Segment[],
    signal: AbortSignal,
    progress: (value: number, message: string) => void,
  ): Promise<Segment[]> {
    this.requireTranslation(snapshot);
    if (!snapshot.options.translationProfileId)
      throw new AppError("PROFILE_MISSING", "请选择翻译配置");
    const ids: string[] = [];
    // Re-recognition drafts may have new source IDs, so derive coverage locally without
    // publishing a plan for the not-yet-committed source timeline.
    const draft = { ...snapshot, segments: all };
    const plan =
      draft.chapterPlan?.state === "current" &&
      draft.chapterPlan.sourceFingerprint === chapterSourceFingerprint(draft)
        ? draft.chapterPlan
        : newCoveragePlan(draft);
    const result: Segment[] = [];
    const runId = randomUUID();
    for (const group of chapterTargets(plan, selected))
      result.push(
        ...(await this.chapterTranslation(
          snapshot,
          group.targets,
          all,
          group.chapter,
          signal,
          progress,
          ids,
          runId,
        )),
      );
    // The caller owns the atomic content publication; these requests remain validated
    // until that owner has committed the complete operation.
    this.draftRequestIds.set(result, ids);
    return result;
  }
  private readonly draftRequestIds = new WeakMap<Segment[], string[]>();

  async translatePartial(raw: ReprocessInput): Promise<Job> {
    const input = reprocessInputSchema.parse(raw);
    const plan = this.planReprocess({ ...input, operation: "translate" });
    const before = this.store.getJob(input.jobId);
    const services = this.serviceIdentity([
      before.options.translationProfileId,
    ]);
    const completion = (): {
      state: "succeeded" | "idle";
      message: string;
    } => ({
      state:
        before.stages.translate.state === "succeeded" ? "succeeded" : "idle",
      message: `已重新翻译 ${plan.affectedCount} 条指定字幕`,
    });
    return this.stage(
      input.jobId,
      "translate",
      async (signal, progress) => {
        const selected = before.segments.filter((s) =>
          plan.segmentIds.includes(s.id),
        );
        const drafted = await this.draftTranslations(
          before,
          selected,
          before.segments,
          signal,
          progress,
        );
        checkAbort(signal);
        const current = this.store.getJob(input.jobId);
        resolveReprocess(current, { ...input, operation: "translate" });
        if (
          this.serviceIdentity([current.options.translationProfileId]) !==
          services
        )
          throw new AppError("STALE_REVISION", "翻译服务已改变");
        const replacements = new Map(drafted.map((s) => [s.id, s]));
        current.segments = current.segments.map(
          (s) => replacements.get(s.id) ?? s,
        );
        current.revision++;
        this.invalidate(current);
        current.stages.translate = { ...completion(), progress: 1 };
        return this.saveWithRequests(
          current,
          this.draftRequestIds.get(drafted),
        );
      },
      completion,
    );
  }
  private async draftRecognition(
    before: Job,
    plan: ReprocessPlan,
    translate: boolean,
    signal: AbortSignal,
    progress: (value: number, message: string) => void,
  ): Promise<{
    drafted: Segment[];
    retained: Segment[];
    actualBackend: Job["actualBackend"];
  }> {
    await this.identity(before);
    let drafted: Segment[] = [];
    let actualBackend = before.actualBackend;
    const prefix = `partial-${randomUUID()}-`;
    const retained = before.segments.filter(
      (s) => !plan.segmentIds.includes(s.id),
    );
    try {
      for (const [index, interval] of plan.intervals.entries()) {
        checkAbort(signal);
        if (interval.endMs <= Math.max(0, before.media.audioOffsetMs)) continue;
        const recognized = await this.recognizeAudio(
          before,
          interval.startMs,
          interval.endMs,
          signal,
          (value, message) =>
            progress(
              ((index + value) / plan.intervals.length) *
                (translate ? 0.7 : 0.95),
              message,
            ),
          `${prefix}${index}-`,
        );
        actualBackend = recognized.actualBackend;
        drafted.push(
          ...recognized.segments.map((s) => ({ ...s, id: randomUUID() })),
        );
      }
      const combined = validateTimeline(
        [...retained, ...drafted],
        before.media.durationMs,
      );
      if (combined.length > 10000)
        throw new AppError("SEGMENT_LIMIT", "字幕数量已达上限（10000 条）");
      if (translate && drafted.length)
        drafted = await this.draftTranslations(
          before,
          drafted,
          combined,
          signal,
          (value, message) => progress(0.7 + value * 0.29, message),
        );
    } finally {
      // Only operation-owned temporary files, never source or historical exports.
      const { readdir } = await import("node:fs/promises");
      for (const file of await readdir(this.workspace(before.id))) {
        if (file.startsWith(prefix))
          await rm(join(this.workspace(before.id), file), {
            force: true,
          });
      }
    }
    return { drafted, retained, actualBackend };
  }
  private applyRecognitionDraft(
    current: Job,
    before: Job,
    plan: ReprocessPlan,
    drafted: Segment[],
    retained: Segment[],
    actualBackend: Job["actualBackend"],
  ): void {
    current.segments = validateTimeline(
      [...retained, ...drafted],
      before.media.durationMs,
    );
    if (current.reviewReport) {
      current.reviewReport.findings = current.reviewReport.findings.flatMap(
        (finding) => {
          if (!plan.segmentIds.includes(finding.segmentId)) return [finding];
          const previous = before.segments.find(
            (s) => s.id === finding.segmentId,
          );
          const replacements = previous
            ? drafted.filter(
                (s) => s.startMs < previous.endMs && s.endMs > previous.startMs,
              )
            : [];
          return replacements.length
            ? replacements.map((s) => ({
                ...finding,
                id: randomUUID(),
                segmentId: s.id,
                startMs: s.startMs,
                endMs: s.endMs,
                status: "recheck" as const,
                riskLevel: undefined,
                ruleId: undefined,
                evidenceIds: undefined,
                contextGroupId: undefined,
              }))
            : [{ ...finding, status: "recheck" as const }];
        },
      );
    }
    current.style = {
      ...current.style,
      emphasisBySegment: current.style.emphasisBySegment.filter(
        (e) => !plan.segmentIds.includes(e.segmentId),
      ),
    };
    current.actualBackend = actualBackend;
  }
  async recognizePartial(raw: RecognizePartialInput): Promise<Job> {
    const input = recognizePartialInputSchema.parse(raw);
    const plan = this.planReprocess({
      jobId: input.jobId,
      revision: input.revision,
      target: input.target,
      operation: "recognize",
    });
    const before = this.store.getJob(input.jobId);
    if (input.translate) this.requireTranslation(before);
    if (!before.media.hasAudio) throw new AppError("NO_AUDIO", "视频没有音轨");
    const providerIds = [
      before.options.recognition === "cloud"
        ? before.options.recognitionProfileId
        : undefined,
      input.translate ? before.options.translationProfileId : undefined,
    ];
    const services = this.serviceIdentity(providerIds);
    let cueCount = 0;
    const completion = (): {
      state: "succeeded" | "idle";
      message: string;
    } => ({
      state:
        before.stages.recognize.state === "succeeded" ? "succeeded" : "idle",
      message: cueCount
        ? `指定的 ${plan.intervals.length} 个区间识别完成，生成 ${cueCount} 条字幕${input.translate ? "并完成翻译" : ""}`
        : "指定范围未识别到语音，已移除该范围的旧字幕",
    });
    return this.stage(
      input.jobId,
      "recognize",
      async (signal, progress) => {
        const { drafted, retained, actualBackend } =
          await this.draftRecognition(
            before,
            plan,
            input.translate,
            signal,
            progress,
          );
        await this.identity(before);
        checkAbort(signal);
        const current = this.store.getJob(input.jobId);
        resolveReprocess(current, {
          jobId: input.jobId,
          revision: input.revision,
          target: input.target,
          operation: "recognize",
        });
        if (this.serviceIdentity(providerIds) !== services)
          throw new AppError("STALE_REVISION", "识别或翻译服务已改变");
        this.applyRecognitionDraft(
          current,
          before,
          plan,
          drafted,
          retained,
          actualBackend,
        );
        current.revision++;
        cueCount = drafted.length;
        if (
          current.options.translationEnabled &&
          !input.translate &&
          drafted.length
        ) {
          current.stages.translate = {
            state: "idle",
            progress: 0,
            message: "重新识别的指定字幕尚未翻译",
          };
        }
        this.invalidate(current);
        current.stages.recognize = { ...completion(), progress: 1 };
        return this.saveWithRequests(
          current,
          this.draftRequestIds.get(drafted),
        );
      },
      completion,
    );
  }
  async reviewSubtitles(raw: ReviewSubtitlesInput): Promise<Job> {
    const parsed = reviewSubtitlesInputSchema.parse(raw);
    const snapshot = this.editableTimeline(parsed.jobId, parsed.revision);
    const input = resolveReviewInput(snapshot, parsed);
    const controller = new AbortController();
    this.active = { id: input.jobId, controller };
    const progress = (value: number, message: string): void => {
      this.emit({
        jobId: input.jobId,
        stage: "review",
        progress: value,
        message,
        job: this.store.getJob(input.jobId),
      });
    };
    try {
      return await this.reviewDraft(
        input,
        snapshot,
        controller.signal,
        progress,
      );
    } catch (error) {
      progress(
        1,
        controller.signal.aborted
          ? "检查已取消，保留上次报告"
          : "检查未完成，保留上次报告",
      );
      throw error;
    } finally {
      this.active = undefined;
    }
  }
  private async reviewDraft(
    input: ReviewSubtitlesInput,
    initial: Job,
    signal: AbortSignal,
    progress: (value: number, message: string) => void,
  ): Promise<Job> {
    if (initial.media.durationMs <= CHAPTER_REVIEW_THRESHOLD_MS)
      return this.reviewSingle(input, initial, signal, progress);
    const requested = input.segmentIds
      ? new Set(input.segmentIds)
      : new Set(initial.segments.map((cue) => cue.id));
    if (
      requested.size !==
        (input.segmentIds?.length ?? initial.segments.length) ||
      [...requested].some(
        (id) => !initial.segments.some((cue) => cue.id === id),
      )
    )
      throw new AppError("REVIEW_IDS", "所选检查字幕不存在或重复");
    if (!requested.size) throw new AppError("NO_SEGMENTS", "没有可检查的字幕");
    const profileId = initial.options.reviewProfileId;
    if (!profileId)
      throw new AppError("PROFILE_MISSING", "请选择 AI 字幕检查配置");
    const profile = this.store.getProfile(profileId);
    const fingerprint = providerFingerprint(profile);
    const key = this.store.key(profileId);
    const snapshot = await this.normalPlan(initial, profileId, signal);
    const plan = snapshot.chapterPlan;
    if (!plan) throw new AppError("CHAPTER_INVALID", "缺少检查章节");
    const targets = snapshot.segments.filter((cue) => requested.has(cue.id));
    const source = chapterSourceFingerprint(snapshot);
    const timeline = chapterReviewFingerprint(snapshot);
    const previous = snapshot.reviewRun;
    const compatible =
      previous &&
      ["failed", "cancelled", "interrupted"].includes(previous.state) &&
      previous.planId === plan.id &&
      previous.planRevision === plan.revision &&
      previous.sourceFingerprint === source &&
      previous.timelineFingerprint === timeline &&
      previous.profileId === profileId &&
      previous.providerFingerprint === fingerprint &&
      previous.rubricVersion === REVIEW_RUBRIC_VERSION &&
      previous.translationEnabled === snapshot.options.translationEnabled &&
      previous.targetIds.length === requested.size &&
      previous.targetIds.every((id) => requested.has(id));
    const groups = chapterTargets(plan, targets);
    let run: ChapterReviewRun = compatible
      ? { ...previous, state: "running", completedAt: undefined }
      : {
          version: 1,
          id: randomUUID(),
          planId: plan.id,
          planRevision: plan.revision,
          sourceFingerprint: source,
          timelineFingerprint: timeline,
          profileId,
          providerFingerprint: fingerprint,
          rubricVersion: REVIEW_RUBRIC_VERSION,
          translationEnabled: snapshot.options.translationEnabled,
          targetIds: targets.map((cue) => cue.id),
          chapters: groups.map(({ chapter, targets }) => ({
            chapterId: chapter.id,
            targetIds: targets.map((cue) => cue.id),
            state: "pending",
          })),
          state: "running",
          startedAt: Date.now(),
        };
    const verify = (): Job => {
      checkAbort(signal);
      const current = this.store.getJob(input.jobId);
      if (
        current.revision !== input.revision ||
        chapterSourceFingerprint(current) !== source ||
        chapterReviewFingerprint(current) !== timeline ||
        current.options.reviewProfileId !== profileId ||
        providerFingerprint(this.store.getProfile(profileId)) !== fingerprint ||
        this.store.key(profileId) !== key ||
        current.chapterPlan?.id !== plan.id ||
        current.chapterPlan.revision !== plan.revision ||
        current.chapterPlan.state !== "current"
      )
        throw new AppError(
          "STALE_REVISION",
          "检查期间字幕、章节或服务已改变，已保留完成结果",
        );
      return current;
    };
    const saveRun = (): Job => {
      const current = verify();
      current.reviewRun = structuredClone(run);
      this.store.saveJob(current);
      return current;
    };
    saveRun();
    try {
      for (const [index, group] of groups.entries()) {
        const state = run.chapters[index];
        if (!state) throw new AppError("CHAPTER_INVALID", "检查章节状态缺失");
        if (state.state === "completed") continue;
        state.state = "running";
        delete state.code;
        let draft = saveRun();
        const requestIds: string[] = [];
        const bounded: Segment[][] = [];
        const admit = (piece: Segment[]): void => {
          try {
            createReviewRequest(
              snapshot.segments,
              piece,
              snapshot.options.translationEnabled,
            );
            bounded.push(piece);
          } catch (error) {
            if (
              !(error instanceof AppError) ||
              error.code !== "TEXT_LIMIT" ||
              piece.length < 2
            )
              throw error;
            const middle = Math.ceil(piece.length / 2);
            admit(piece.slice(0, middle));
            admit(piece.slice(middle));
          }
        };
        boundedChapterPieces(group.targets).forEach(admit);
        for (const [pieceIndex, piece] of bounded.entries()) {
          progress(
            index / groups.length,
            `检查章节 ${index + 1}/${groups.length} · 工作单元 ${pieceIndex + 1}/${bounded.length}`,
          );
          draft = await this.reviewSingle(
            { ...input, segmentIds: piece.map((cue) => cue.id) },
            snapshot,
            signal,
            (_value, message) =>
              progress(
                index / groups.length,
                `章节 ${index + 1}/${groups.length} · ${message}`,
              ),
            {
              base: draft,
              requestIds,
              runId: run.id,
              chapterId: group.chapter.id,
            },
          );
        }
        verify();
        state.state = "completed";
        draft.reviewRun = structuredClone(run);
        checkAbort(signal);
        this.saveWithRequests(draft, requestIds);
        progress(
          (index + 1) / groups.length,
          `已保存检查章节 ${run.chapters.filter((chapter) => chapter.state === "completed").length}/${groups.length}`,
        );
      }
      run = { ...run, state: "complete", completedAt: Date.now() };
      return saveRun();
    } catch (error) {
      const current = this.store.getJob(input.jobId);
      const stale =
        chapterSourceFingerprint(current) !== source ||
        chapterReviewFingerprint(current) !== timeline ||
        current.revision !== input.revision ||
        current.options.reviewProfileId !== profileId ||
        providerFingerprint(this.store.getProfile(profileId)) !== fingerprint ||
        this.store.key(profileId) !== key ||
        current.chapterPlan?.id !== plan.id ||
        current.chapterPlan.revision !== plan.revision;
      run.state = stale ? "stale" : signal.aborted ? "cancelled" : "failed";
      run.completedAt = Date.now();
      for (const chapter of run.chapters)
        if (chapter.state === "running") {
          chapter.state = "failed";
          chapter.code =
            error instanceof AppError ? error.code : "OPERATION_FAILED";
        }
      current.reviewRun = run;
      this.store.saveJob(current);
      progress(
        1,
        `检查未完成；保留 ${run.chapters.filter((chapter) => chapter.state === "completed").length}/${run.chapters.length} 个完整章节，可重试剩余部分`,
      );
      throw error;
    }
  }
  private async reviewSingle(
    input: ReviewSubtitlesInput,
    snapshot: Job,
    signal: AbortSignal,
    progress: (value: number, message: string) => void,
    draft?: {
      base: Job;
      requestIds: string[];
      runId: string;
      chapterId: string;
    },
  ): Promise<Job> {
    const selectedIds = input.segmentIds
      ? new Set(input.segmentIds)
      : undefined;
    if (
      selectedIds &&
      (selectedIds.size !== input.segmentIds?.length ||
        [...selectedIds].some(
          (id) => !snapshot.segments.some((s) => s.id === id),
        ))
    )
      throw new AppError("REVIEW_IDS", "所选检查字幕不存在或重复");
    const selected = snapshot.segments.filter(
      (s) => !selectedIds || selectedIds.has(s.id),
    );
    if (!selected.length) throw new AppError("NO_SEGMENTS", "没有可检查的字幕");
    if (!snapshot.options.reviewProfileId)
      throw new AppError("PROFILE_MISSING", "请选择 AI 字幕检查配置");
    const profile = this.store.getProfile(snapshot.options.reviewProfileId);
    const fingerprint = providerFingerprint(profile);
    const key = this.store.key(profile.id);
    progress(0, `正在准备整批检查 ${selected.length} 条字幕`);
    const findings: ReviewFinding[] = [];
    const assessments: ReviewAssessment[] = [];
    const contextGroups: ReviewContextGroup[] = [];
    const request = createReviewRequest(
      snapshot.segments,
      selected,
      snapshot.options.translationEnabled,
    );
    const requestIds: string[] = [];
    const runId = draft?.runId ?? randomUUID();
    const generate = async (
      prompt: string,
    ): Promise<ReturnType<typeof validateReviewResponse>> => {
      checkAbort(signal);
      try {
        const context = this.textContext(
          "review",
          snapshot.id,
          requestIds,
          progress,
          runId,
          draft?.chapterId,
          selected.length,
        );
        const raw = parseJson(
          await generateText(
            profile,
            key,
            prompt,
            signal,
            context ? { ...context, attempt: requestIds.length } : undefined,
          ),
        );
        checkAbort(signal);
        progress(0, `正在校验整批 JSON：${selected.length} 条字幕`);
        return validateReviewResponse(
          raw,
          request,
          snapshot.options.translationEnabled,
        );
      } catch (error) {
        this.validationFailed(requestIds, error);
        throw error;
      }
    };
    progress(0, `等待 AI 返回完整 JSON：${selected.length} 条字幕`);
    let validatedGroups: Awaited<ReturnType<typeof generate>>;
    try {
      validatedGroups = await generate(request.prompt);
    } catch (error) {
      checkAbort(signal);
      const correction = reviewCorrectionPrompt(request, error);
      if (!correction) throw error;
      progress(0, `纠正返回格式或证据 1/1：整批 ${selected.length} 条字幕`);
      try {
        validatedGroups = await generate(correction);
      } catch (correctedError) {
        checkAbort(signal);
        if (
          correctedError instanceof AppError &&
          reviewCorrectionPrompt(request, correctedError)
        )
          throw new AppError(
            correctedError.code,
            `${correctedError.message}；一次纠正仍未通过，请减少选中字幕或更换检查模型`,
          );
        throw correctedError;
      }
    }
    checkAbort(signal);
    for (const { window, targets, assessments: validated } of validatedGroups) {
      contextGroups.push(window.group);
      for (const assessed of validated) {
        const cue = targets.find(
          (candidate) => candidate.id === assessed.segmentId,
        );
        if (!cue) throw new AppError("REVIEW_INCOMPLETE", "字幕评级缺失");
        const cueFindings = assessed.issues.map(
          (issue): ReviewFinding => ({
            ...issue,
            id: randomUUID(),
            segmentId: assessed.segmentId,
            startMs: cue?.startMs,
            endMs: cue?.endMs,
            contextGroupId: window.group.id,
            status:
              snapshot.reviewReport?.profileId === profile.id &&
              snapshot.reviewReport.providerFingerprint === fingerprint &&
              snapshot.reviewReport.rubric?.version === REVIEW_RUBRIC_VERSION &&
              snapshot.reviewReport.translationEnabled ===
                snapshot.options.translationEnabled &&
              snapshot.reviewReport.fingerprints[assessed.segmentId] ===
                cueFingerprint(cue, snapshot.options.translationEnabled) &&
              snapshot.reviewReport.findings.some(
                (previous) =>
                  previous.status === "ignored" &&
                  previous.segmentId === assessed.segmentId &&
                  previous.ruleId === issue.ruleId &&
                  previous.contextGroupId === window.group.id,
              )
                ? "ignored"
                : "pending",
          }),
        );
        findings.push(...cueFindings);
        assessments.push({
          segmentId: assessed.segmentId,
          riskLevel: assessed.riskLevel,
          status: "current",
          contextGroupId: window.group.id,
          findingIds: cueFindings.map((finding) => finding.id),
        });
      }
    }
    const validatedIds = this.validatedRequest(requestIds);
    progress(0.99, `已校验 ${selected.length} / ${selected.length} 条字幕`);
    checkAbort(signal);
    const latest = this.store.getJob(input.jobId);
    const current = draft ? structuredClone(draft.base) : latest;
    if (
      latest.revision !== input.revision ||
      chapterReviewFingerprint(latest) !== chapterReviewFingerprint(snapshot) ||
      latest.options.reviewProfileId !== profile.id ||
      latest.options.translationEnabled !==
        snapshot.options.translationEnabled ||
      providerFingerprint(this.store.getProfile(profile.id)) !== fingerprint ||
      this.store.key(profile.id) !== key
    )
      throw new AppError(
        "STALE_REVISION",
        "检查期间字幕或服务已改变，请重新检查",
      );
    const previous = current.reviewReport;
    const canMerge =
      selectedIds &&
      previous?.profileId === profile.id &&
      previous.providerFingerprint === fingerprint &&
      previous.rubric?.version === REVIEW_RUBRIC_VERSION &&
      previous.translationEnabled === snapshot.options.translationEnabled;
    const ids = new Set(selected.map((s) => s.id));
    const currentIds = new Set(current.segments.map((s) => s.id));
    const fingerprints: Record<string, string> = canMerge
      ? Object.fromEntries(
          Object.entries(previous.fingerprints).filter(([id]) =>
            currentIds.has(id),
          ),
        )
      : {};
    for (const cue of selected)
      fingerprints[cue.id] = cueFingerprint(
        cue,
        snapshot.options.translationEnabled,
      );
    const mergedAssessments = [
      ...(canMerge
        ? (previous.assessments?.filter(
            (a) => currentIds.has(a.segmentId) && !ids.has(a.segmentId),
          ) ?? [])
        : []),
      ...assessments,
    ];
    const usedGroups = new Set(mergedAssessments.map((a) => a.contextGroupId));
    const mergedGroups = new Map(
      [...(canMerge ? (previous.contextGroups ?? []) : []), ...contextGroups]
        .filter((group) => usedGroups.has(group.id))
        .map((group) => [group.id, group]),
    );
    current.reviewReport = {
      id: randomUUID(),
      profileId: profile.id,
      providerFingerprint: fingerprint,
      completedAt: Date.now(),
      state: "complete",
      reviewedSegmentIds: [
        ...new Set([
          ...(canMerge
            ? previous.reviewedSegmentIds.filter((id) => currentIds.has(id))
            : []),
          ...ids,
        ]),
      ],
      fingerprints,
      assessments: mergedAssessments,
      contextGroups: [...mergedGroups.values()],
      rubric: {
        version: REVIEW_RUBRIC_VERSION,
        rules: [...REVIEW_RUBRIC.rules],
      },
      translationEnabled: snapshot.options.translationEnabled,
      findings: [
        ...(canMerge
          ? previous.findings.filter(
              (f) =>
                !ids.has(f.segmentId) &&
                (currentIds.has(f.segmentId) ||
                  !selected.some(
                    (s) =>
                      f.startMs !== undefined &&
                      f.endMs !== undefined &&
                      s.startMs < f.endMs &&
                      s.endMs > f.startMs,
                  )),
            )
          : []),
        ...findings,
      ],
    };
    checkAbort(signal);
    if (draft) {
      draft.requestIds.push(...validatedIds);
      return current;
    }
    this.saveWithRequests(current, validatedIds);
    return current;
  }
  acknowledgeFinding(raw: AcknowledgeFindingInput): Job {
    const input = acknowledgeFindingInputSchema.parse(raw);
    if (this.active)
      throw new AppError("JOB_BUSY", "已有任务运行，请等待或取消");
    const job = this.store.getJob(input.jobId);
    refreshReview(job);
    const report = job.reviewReport;
    if (!report || report.id !== input.reportId)
      throw new AppError("STALE_REVIEW", "检查报告已更新，请刷新");
    const finding = report.findings.find((f) => f.id === input.findingId);
    if (!finding) throw new AppError("NOT_FOUND", "检查项不存在");
    if (
      finding.status === "recheck" ||
      job.options.reviewProfileId !== report.profileId ||
      providerFingerprint(this.store.getProfile(report.profileId)) !==
        report.providerFingerprint
    )
      throw new AppError("STALE_REVIEW", "内容或检查服务已改变，请重新检查");
    finding.status = input.status;
    return this.update(job);
  }
  private preflightTranslation(job: Job): void {
    this.requireTranslation(job);
    if (!job.options.translationProfileId)
      throw new AppError("PROFILE_MISSING", "请选择翻译配置");
    const profile = this.store.getProfile(job.options.translationProfileId);
    this.store.key(profile.id);
  }
  private async preflightRecognition(job: Job): Promise<void> {
    if (!job.media.hasAudio) throw new AppError("NO_AUDIO", "视频没有音轨");
    await this.identity(job);
    if (job.options.recognition === "cloud") {
      if (!job.options.recognitionProfileId)
        throw new AppError("PROFILE_MISSING", "请选择云端识别配置");
      const profile = this.store.getProfile(job.options.recognitionProfileId);
      this.store.key(profile.id);
      if (Math.floor((profile.maxUploadBytes - 1000) / 32) < 1000)
        throw new AppError("UPLOAD_LIMIT", "配置的上传限制过小");
    } else {
      this.runtime.modelPath(job.options.modelId);
      this.runtime.executable(job.options.preferGpu);
    }
  }
  private serviceIdentity(ids: (string | undefined)[]): string {
    return JSON.stringify(
      ids.map((id) =>
        id
          ? [
              id,
              providerFingerprint(this.store.getProfile(id)),
              createHash("sha256").update(this.store.key(id)).digest("hex"),
            ]
          : null,
      ),
    );
  }
  async repairLoop(raw: RepairLoopInput): Promise<Job> {
    const input = repairLoopInputSchema.parse(raw);
    const initial = this.editableTimeline(input.jobId, input.revision);
    scopedCues(initial, input.scope);
    if (!initial.options.reviewProfileId)
      throw new AppError("PROFILE_MISSING", "请选择 AI 字幕检查配置");
    const reviewProfile = this.store.getProfile(
      initial.options.reviewProfileId,
    );
    this.store.key(reviewProfile.id);
    const reviewIdentity = providerFingerprint(reviewProfile);
    const controller = new AbortController();
    const lease = { id: input.jobId, controller };
    this.active = lease;
    let run: RepairRun = {
      id: randomUUID(),
      scope: input.scope,
      threshold: input.threshold,
      maxRounds: input.maxRounds,
      state: "running",
      phase: "analysis",
      round: 0,
      committedRounds: 0,
      affectedCount: 0,
      effectiveIntervals: [],
      startedAt: Date.now(),
    };
    const progress = (value: number, message: string): void => {
      const job = this.store.getJob(input.jobId);
      job.repairRun = { ...run };
      this.store.saveJob(job);
      this.emit({
        jobId: input.jobId,
        stage: "repair",
        repairRunId: run.id,
        progress: value,
        message,
        job,
      });
    };
    const phase = (name: RepairRun["phase"], message: string): void => {
      run = { ...run, phase: name };
      progress(0, message);
    };
    const verify = (
      snapshot: Job,
      identity: string,
      providerIds: (string | undefined)[],
    ): Job => {
      checkAbort(controller.signal);
      const current = this.store.getJob(input.jobId);
      if (
        this.active !== lease ||
        current.revision !== snapshot.revision ||
        JSON.stringify(current.options) !== JSON.stringify(snapshot.options) ||
        this.serviceIdentity(providerIds) !== identity
      )
        throw new AppError(
          "STALE_REVISION",
          "自动修复期间字幕、样式或服务已改变，请刷新后重试",
        );
      return current;
    };
    const assess = async (
      afterCommit: boolean,
      newCueIds: string[] = [],
    ): Promise<Job> => {
      checkAbort(controller.signal);
      let snapshot = this.store.getJob(input.jobId);
      if (
        snapshot.options.reviewProfileId !== reviewProfile.id ||
        providerFingerprint(this.store.getProfile(reviewProfile.id)) !==
          reviewIdentity
      )
        throw new AppError(
          "STALE_REVIEW",
          "检查服务已改变，请重新启动自动修复",
        );
      const missing = missingAssessments(snapshot, input.scope, reviewIdentity);
      // Previously assessed neighbours invalidated by this round also need fresh grades.
      const dependents = afterCommit
        ? (snapshot.reviewReport?.assessments
            ?.filter(
              (a) =>
                a.status === "recheck" &&
                snapshot.segments.some((s) => s.id === a.segmentId),
            )
            .map((a) => a.segmentId) ?? [])
        : [];
      // Whole-cue expansion can create cues outside the requested range. They
      // still need a fresh grade, but do not widen the next round's eligibility.
      const ids = [...new Set([...missing, ...dependents, ...newCueIds])];
      if (ids.length) {
        run = { ...run, remainingCount: undefined };
        phase(
          afterCommit ? "reassessment" : "analysis",
          afterCommit
            ? "正在复查修复后的字幕与相关上下文"
            : "正在分析指定范围的字幕",
        );
        snapshot = await this.reviewDraft(
          { jobId: input.jobId, revision: snapshot.revision, segmentIds: ids },
          snapshot,
          controller.signal,
          progress,
        );
      }
      checkAbort(controller.signal);
      run = { ...run, remainingCount: repairCandidates(snapshot, input).count };
      progress(1, `本范围剩余 ${run.remainingCount} 条达到所选等级的疑点字幕`);
      return this.store.getJob(input.jobId);
    };
    try {
      progress(0, "自动修复已开始");
      let snapshot = await assess(false);
      while (true) {
        checkAbort(controller.signal);
        const count = repairCandidates(snapshot, input).count;
        if (!count || run.committedRounds >= input.maxRounds) {
          run = {
            ...run,
            state: "succeeded",
            phase: "done",
            completedAt: Date.now(),
            remainingCount: count,
            reason: count ? "max_rounds" : "no_eligible",
          };
          progress(
            1,
            count
              ? "已达到最大修复轮数，所选范围仍有疑点"
              : "所选范围无达到所选等级的未忽略疑点",
          );
          return this.store.getJob(input.jobId);
        }
        const plan = planRepairRound(snapshot, input);
        run = {
          ...run,
          round: run.committedRounds + 1,
          effectiveIntervals: plan.intervals,
        };
        const providerIds = [
          snapshot.options.reviewProfileId,
          ...(plan.recognition && snapshot.options.recognition === "cloud"
            ? [snapshot.options.recognitionProfileId]
            : []),
          ...(snapshot.options.translationEnabled
            ? [snapshot.options.translationProfileId]
            : []),
        ];
        const identity = this.serviceIdentity(providerIds);
        if (
          snapshot.options.translationEnabled &&
          (plan.recognition || plan.translateIds.length)
        )
          this.preflightTranslation(snapshot);
        if (plan.recognition) await this.preflightRecognition(snapshot);
        verify(snapshot, identity, providerIds);
        const draft = structuredClone(snapshot);
        const translationRequestIds: string[] = [];
        if (plan.recognition) {
          phase(
            "recognize",
            `第 ${run.round} 轮：重新识别 ${plan.recognition.affectedCount} 条字幕所在区间`,
          );
          const recognized = await this.draftRecognition(
            snapshot,
            plan.recognition,
            false,
            controller.signal,
            progress,
          );
          translationRequestIds.push(
            ...(this.draftRequestIds.get(recognized.drafted) ?? []),
          );
          this.applyRecognitionDraft(
            draft,
            snapshot,
            plan.recognition,
            recognized.drafted,
            recognized.retained,
            recognized.actualBackend,
          );
        }
        const retainedIds = new Set(snapshot.segments.map((s) => s.id));
        const toTranslate = draft.segments.filter(
          (s) => plan.translateIds.includes(s.id) || !retainedIds.has(s.id),
        );
        if (snapshot.options.translationEnabled && toTranslate.length) {
          phase(
            "translate",
            `第 ${run.round} 轮：翻译 ${toTranslate.length} 条字幕`,
          );
          const translations = await this.draftTranslations(
            snapshot,
            toTranslate,
            draft.segments,
            controller.signal,
            progress,
          );
          translationRequestIds.push(
            ...(this.draftRequestIds.get(translations) ?? []),
          );
          const replacements = new Map(translations.map((s) => [s.id, s]));
          draft.segments = draft.segments.map(
            (s) => replacements.get(s.id) ?? s,
          );
          draft.style.emphasisBySegment = draft.style.emphasisBySegment.flatMap(
            (e) => {
              const replacement = replacements.get(e.segmentId);
              if (!replacement) return [e];
              const text = primarySubtitleText(replacement, true);
              const keywords = e.keywords.filter((k) => text.includes(k));
              return keywords.length ? [{ ...e, keywords }] : [];
            },
          );
        }
        draft.segments = validateTimeline(
          draft.segments,
          snapshot.media.durationMs,
        );
        if (plan.recognition) await this.identity(snapshot);
        phase("commit", `第 ${run.round} 轮：保存完整修复结果`);
        const current = verify(snapshot, identity, providerIds);
        const committedRun: RepairRun = {
          ...run,
          committedRounds: run.committedRounds + 1,
          affectedCount: run.affectedCount + plan.affectedCount,
          remainingCount: undefined,
        };
        draft.repairRun = { ...committedRun };
        draft.updatedAt = current.updatedAt;
        draft.revision++;
        this.invalidate(draft);
        if (plan.recognition)
          draft.stages.recognize = {
            state: "succeeded",
            progress: 1,
            message: "自动修复指定区间识别完成",
          };
        if (snapshot.options.translationEnabled && toTranslate.length)
          draft.stages.translate = {
            ...snapshot.stages.translate,
            progress: 1,
            message: "自动修复指定字幕翻译完成",
          };
        // The last abort/identity check is synchronous with the single content transaction.
        checkAbort(controller.signal);
        this.saveWithRequests(draft, translationRequestIds);
        run = committedRun;
        progress(1, `已保存第 ${run.committedRounds} 轮完整结果`);
        snapshot = await assess(
          true,
          draft.segments
            .filter((cue) => !retainedIds.has(cue.id))
            .map((cue) => cue.id),
        );
      }
    } catch (error) {
      const cancelled = controller.signal.aborted;
      if (
        error instanceof AppError &&
        ["STALE_REVISION", "STALE_REVIEW"].includes(error.code)
      )
        run = { ...run, remainingCount: undefined };
      run = {
        ...run,
        state: cancelled ? "cancelled" : "failed",
        phase: "done",
        reason: cancelled ? "user_cancelled" : "error",
        completedAt: Date.now(),
        errorCode: cancelled
          ? "CANCELLED"
          : error instanceof AppError
            ? error.code
            : "OPERATION_FAILED",
        errorMessage: cancelled
          ? "自动修复已取消"
          : error instanceof AppError
            ? error.message
            : "自动修复失败，请检查配置后重试",
      };
      progress(
        1,
        `${run.errorMessage}；已保留 ${run.committedRounds} 轮完整结果`,
      );
      throw error;
    } finally {
      if (this.active === lease) this.active = undefined;
    }
  }
  async designStyle(id: string, prompt: string): Promise<Job> {
    await this.stage(id, "style", async (signal, progress) => {
      const snapshot = this.store.getJob(id);
      if (!snapshot.options.styleProfileId)
        throw new AppError("PROFILE_MISSING", "请选择样式设计配置");
      const profile = this.store.getProfile(snapshot.options.styleProfileId);
      const key = this.store.key(profile.id);
      const task = `Design subtitle style. Return only JSON matching this example and these constraints. version=1; templateId clean/cinematic/teaching/bold/soft; fontId managed-cjk/managed-cjk-bold; fontSizeRatio .015-.08; outlineWidthRatio 0-.005; shadow opacity 0-1, offsets -.01-.01; anchor top-center/center/bottom-center; margin .02-.25; maxWidth .5-.95; sourceScale .6-1; animation none/fade, integer 0-1000ms; colors #RRGGBB. Unknown fields forbidden. emphasisBySegment must refer only to literal keywords in provided text. Example ${JSON.stringify(DEFAULT_STYLE)}\n${JSON.stringify({ request: prompt, subtitles: snapshot.segments.map((s) => ({ id: s.id, text: primarySubtitleText(s, snapshot.options.translationEnabled) })) })}`;
      let style: SubtitleStyle | undefined;
      const requestIds: string[] = [];
      const runId = randomUUID();
      for (let attempt = 0; attempt < 2; attempt++) {
        checkAbort(signal);
        const generated = await generateText(
          profile,
          key,
          task +
            (attempt
              ? "\nReturn valid configuration respecting all numeric limits."
              : ""),
          signal,
          this.textContext(
            "style",
            id,
            requestIds,
            progress,
            runId,
            undefined,
            snapshot.segments.length,
          ),
        );
        let raw: unknown;
        try {
          raw = parseJson(generated);
        } catch (error) {
          this.validationFailed(requestIds, error);
          if (!attempt) continue;
          throw error;
        }
        const result = styleSchema.safeParse(raw);
        if (result.success) {
          try {
            this.validateStyleReferences(result.data, snapshot);
            style = result.data;
            break;
          } catch (error) {
            this.validationFailed(requestIds, error);
            if (attempt) throw error;
          }
        } else {
          const error = new AppError(
            "STYLE_INVALID",
            "AI 样式配置无效，已保留当前样式",
          );
          this.validationFailed(requestIds, error);
          if (attempt) throw error;
        }
      }
      if (!style) throw new AppError("STYLE_INVALID", "AI 样式配置无效");
      const validatedIds = this.validatedRequest(requestIds);
      checkAbort(signal);
      const current = this.store.getJob(id);
      if (
        current.revision !== snapshot.revision ||
        current.options.styleProfileId !== profile.id ||
        providerFingerprint(this.store.getProfile(profile.id)) !==
          providerFingerprint(profile) ||
        this.store.key(profile.id) !== key
      )
        throw new AppError("STALE_REVISION", "样式生成期间字幕已修改，请重试");
      current.style = style;
      current.revision++;
      this.invalidate(current);
      this.update(current, validatedIds);
    });
    return this.store.getJob(id);
  }
  private compile(job: Job, format: "ass" | "srt" | "vtt"): string {
    if (!job.segments.length) throw new AppError("NO_SEGMENTS", "请先生成字幕");
    return compileSubtitles(
      job.segments,
      job.style,
      job.media,
      job.options.bilingual,
      format,
      job.options.translationEnabled,
    );
  }
  async preview(id: string, atMs: number): Promise<{ url: string; job: Job }> {
    let url = "";
    await this.stage(id, "preview", async (signal) => {
      const snapshot = this.store.getJob(id);
      await this.identity(snapshot);
      if (atMs < 0 || atMs >= snapshot.media.durationMs)
        throw new AppError("TIMING_INVALID", "预览时间超出视频范围");
      const path = join(
        this.workspace(id),
        `preview-${snapshot.revision}-${randomUUID()}.png`,
      );
      await this.media.render(
        snapshot.inputPath,
        this.workspace(id),
        this.compile(snapshot, "ass"),
        snapshot.media,
        path,
        "balanced",
        signal,
        atMs,
      );
      const current = this.store.getJob(id);
      if (current.revision !== snapshot.revision) {
        await rm(path, { force: true });
        throw new AppError("STALE_REVISION", "字幕已修改，请重新预览");
      }
      url = this.url(path);
      current.previewUrl = url;
      this.update(current);
    });
    return { url, job: this.store.getJob(id) };
  }
  async playback(id: string): Promise<{ url: string }> {
    const job = this.store.getJob(id);
    await this.identity(job);
    return {
      url: this.url(
        await this.media.proxy(job.inputPath, this.workspace(id), job.media),
      ),
    };
  }
  async export(
    id: string,
    format: "mp4" | "mkv" | "srt" | "ass" | "vtt",
    quality: "balanced" | "high" | "small",
    destination: string,
    videoOptions?: ExportVideoOptions,
  ): Promise<{ path: string }> {
    await this.stage(id, "export", async (signal, progress) => {
      const snapshot = this.store.getJob(id);
      const renderOptions =
        format === "mp4" || format === "mkv"
          ? exportVideoOptionsSchema.parse(videoOptions ?? {})
          : undefined;
      if (
        resolve(destination).toLowerCase() ===
        resolve(snapshot.inputPath).toLowerCase()
      )
        throw new AppError("SOURCE_OVERWRITE", "不能覆盖原视频");
      const temporary = join(
        dirname(destination),
        `.slice-stage-${randomUUID()}.${format}`,
      );
      try {
        if (format === "mp4" || format === "mkv") {
          await this.identity(snapshot);
          await this.media.render(
            snapshot.inputPath,
            this.workspace(id),
            this.compile(snapshot, "ass"),
            snapshot.media,
            temporary,
            quality,
            signal,
            undefined,
            (v) => progress(v, "编码导出"),
            renderOptions,
          );
        } else {
          await writeFile(temporary, this.compile(snapshot, format), "utf8");
        }
        const current = this.store.getJob(id);
        if (current.revision !== snapshot.revision) {
          throw new AppError(
            "STALE_REVISION",
            "导出期间字幕已修改，未发布过期视频",
          );
        }
        checkAbort(signal);
        await publish(temporary, destination);
        current.outputs.push(destination);
        this.update(current);
      } finally {
        await rm(temporary, { force: true });
      }
    });
    return { path: destination };
  }
}
