import { randomUUID } from "node:crypto";
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
} from "../../../../shared/contracts";
import type { Store } from "../../../db/store";
import { publish } from "../../media/lib/media-service";
import type { MediaService } from "../../media/lib/media-service";
import type { RuntimeAccess } from "../types";
import { AppError, checkAbort } from "../../../lib/errors";
import { runProcess } from "../../../lib/process";
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
  private active: { id: string; controller: AbortController } | undefined;
  constructor(
    private readonly store: Store,
    private readonly media: MediaService,
    private readonly runtime: RuntimeAccess,
    private readonly root: string,
    private readonly emit: (event: ProgressEvent) => void,
    private readonly url: (path: string) => string,
  ) {}
  async importVideo(path: string, signal?: AbortSignal): Promise<Job> {
    checkAbort(signal);
    const media = await this.media.probe(path, signal);
    checkAbort(signal);
    const now = Date.now();
    const job: Job = {
      id: randomUUID(),
      name: basename(path),
      inputPath: path,
      media,
      options: optionsSchema.parse({}),
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
  private update(job: Job): Job {
    this.store.saveJob(job);
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
    const job = this.store.getJob(id);
    const previous = job.options;
    if (JSON.stringify(previous) === JSON.stringify(options)) return job;
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
          (k) => !(segment.translatedText || segment.sourceText).includes(k),
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
    progress(0, "处理中");
    try {
      const result = await operation(controller.signal, progress);
      checkAbort(controller.signal);
      const job = this.store.getJob(id);
      job.stages[name] = { state: "succeeded", progress: 1, message: "完成" };
      this.update(job);
      this.emit({ jobId: id, stage: name, progress: 1, message: "完成", job });
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
          let start = Math.max(0, snapshot.media.audioOffsetMs), index = 0;
          start < snapshot.media.durationMs;
          start += chunkMs, index++
        ) {
          checkAbort(signal);
          const length = Math.min(chunkMs, snapshot.media.durationMs - start);
          const audio = join(this.workspace(id), `audio-${index}.wav`);
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
            snapshot.media.durationMs,
            `cloud-${index}`,
          );
          segments = mergeChunkSegments(segments, recognized);
          progress(
            Math.min(0.95, (start + length) / snapshot.media.durationMs),
            "云端识别",
          );
        }
        actualBackend = "cloud";
      } else {
        const audio = join(this.workspace(id), "audio.wav");
        await this.media.extract(
          snapshot.inputPath,
          audio,
          0,
          snapshot.media.durationMs,
          signal,
        );
        const model = this.runtime.modelPath(options.modelId);
        let runtime = this.runtime.executable(options.preferGpu);
        const output = join(this.workspace(id), `whisper-${randomUUID()}`);
        const backendReceipt = join(
          this.workspace(id),
          "recognition-backend.json",
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
                : (options.sourceLanguage.toLowerCase().split("-")[0] ??
                  "auto"),
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
          Math.max(0, snapshot.media.audioOffsetMs),
          snapshot.media.durationMs,
        );
        actualBackend = runtime.backend;
      }
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
  async translate(id: string, selectedIds?: string[]): Promise<Job> {
    await this.stage(id, "translate", async (signal, progress) => {
      let snapshot = this.store.getJob(id);
      if (!snapshot.options.translationProfileId)
        throw new AppError("PROFILE_MISSING", "请选择翻译配置");
      if (snapshot.stages.recognize.state !== "succeeded")
        throw new AppError("RECOGNITION_REQUIRED", "请先完成当前设置的识别");
      const profile = this.store.getProfile(
        snapshot.options.translationProfileId,
      );
      const key = this.store.key(profile.id);
      const selectedSet = selectedIds ? new Set(selectedIds) : undefined;
      if (
        selectedSet &&
        [...selectedSet].some(
          (id) => !snapshot.segments.some((s) => s.id === id),
        )
      )
        throw new AppError("NOT_FOUND", "所选字幕不存在");
      const selected = snapshot.segments.filter((s) =>
        selectedSet
          ? selectedSet.has(s.id)
          : !s.translatedText || s.translationStale,
      );
      if (!snapshot.segments.length)
        throw new AppError("NO_SEGMENTS", "没有可翻译的字幕");
      for (let offset = 0; offset < selected.length; offset += 30) {
        const batch = selected.slice(offset, offset + 30);
        const revision = snapshot.revision;
        const result = await translateBatch(
          profile,
          key,
          batch,
          snapshot.segments.filter((s, index) =>
            batch.some(
              (b) =>
                Math.abs(
                  snapshot.segments.findIndex(
                    (candidate) => candidate.id === b.id,
                  ) - index,
                ) <= 2,
            ),
          ),
          snapshot.options.sourceLanguage,
          snapshot.options.targetLanguage,
          signal,
        );
        checkAbort(signal);
        const current = this.store.getJob(id);
        if (current.revision !== revision)
          throw new AppError(
            "STALE_REVISION",
            "翻译期间字幕已修改，未覆盖手工修改",
          );
        const translations = new Map(result.map((t) => [t.id, t.text]));
        current.segments = current.segments.map((s) =>
          translations.has(s.id)
            ? {
                ...s,
                translatedText: translations.get(s.id) ?? s.translatedText,
                translationStale: false,
              }
            : s,
        );
        current.revision++;
        this.invalidate(current);
        this.update(current);
        snapshot = current;
        progress(
          Math.min(1, (offset + batch.length) / selected.length),
          "翻译",
        );
      }
    });
    return this.store.getJob(id);
  }
  async designStyle(id: string, prompt: string): Promise<Job> {
    await this.stage(id, "style", async (signal) => {
      const snapshot = this.store.getJob(id);
      if (!snapshot.options.styleProfileId)
        throw new AppError("PROFILE_MISSING", "请选择样式设计配置");
      const profile = this.store.getProfile(snapshot.options.styleProfileId);
      const key = this.store.key(profile.id);
      const task = `Design subtitle style. Return only JSON matching this example and these constraints. version=1; templateId clean/cinematic/teaching/bold/soft; fontId managed-cjk/managed-cjk-bold; fontSizeRatio .015-.08; outlineWidthRatio 0-.005; shadow opacity 0-1, offsets -.01-.01; anchor top-center/center/bottom-center; margin .02-.25; maxWidth .5-.95; sourceScale .6-1; animation none/fade, integer 0-1000ms; colors #RRGGBB. Unknown fields forbidden. emphasisBySegment must refer only to literal keywords in provided text. Example ${JSON.stringify(DEFAULT_STYLE)}\n${JSON.stringify({ request: prompt, subtitles: snapshot.segments.map((s) => ({ id: s.id, text: s.translatedText || s.sourceText })) })}`;
      let style: SubtitleStyle | undefined;
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
        );
        let raw: unknown;
        try {
          raw = parseJson(generated);
        } catch (error) {
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
            if (attempt) throw error;
          }
        } else if (attempt)
          throw new AppError(
            "STYLE_INVALID",
            "AI 样式配置无效，已保留当前样式",
          );
      }
      if (!style) throw new AppError("STYLE_INVALID", "AI 样式配置无效");
      const current = this.store.getJob(id);
      if (current.revision !== snapshot.revision)
        throw new AppError("STALE_REVISION", "样式生成期间字幕已修改，请重试");
      current.style = style;
      current.revision++;
      this.invalidate(current);
      this.update(current);
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
