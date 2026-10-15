import { z } from "zod";
import type { ProviderDiagnostic, DiagnosticsListInput, DiagnosticsLiveInput, ProviderLiveSnapshot } from './provider-diagnostics-contracts';
import type { CriterionLibrary, SaveCriterionInput, CriterionIdentity, ChapterExportInput, ChapterExportRun } from './chapter-export-contracts';
import type { ArtifactCacheSummary } from "./artifact-cache-contracts";
import { chapterPlanSchema, chapterReviewRunSchema } from './chapter-contracts';
import type { ChapterPlan, ChapterReviewRun, PlanChaptersInput, UpdateChaptersInput } from './chapter-contracts';
export * from './chapter-contracts';
import { nameReportSchema, nameBatchSchema } from './person-name-contracts';
import type { NameReport, NameBatch, AnalyzeNamesInput, ApplyNamesInput, UndoNamesInput } from './person-name-contracts';
export * from './person-name-contracts';
import { reviewReportSchema, repairRunSchema } from "./reprocessing-contracts";
import type {
  ImportOptions,
  ReprocessPlan,
  PlanReprocessInput,
  ReprocessInput,
  RecognizePartialInput,
  ReviewReport,
  ReviewSubtitlesInput,
  AcknowledgeFindingInput,
  RepairLoopInput,
  RepairRun,
} from "./reprocessing-contracts";
export * from "./reprocessing-contracts";
import type {
  ExportSettings,
  ExportSettingsInput,
  ExportVideoOptions,
} from "./export-contracts";
export type {
  ExportSettings,
  ExportSettingsInput,
  ExportVideoOptions,
} from "./export-contracts";
import type {
  DownloadSettingsInput,
  DownloadStatus,
} from "./download-contracts";
export type {
  DownloadSettings,
  DownloadSettingsInput,
  DownloadStatus,
} from "./download-contracts";

export const idSchema = z.string().min(1).max(100);
const ms = z.number().int().nonnegative();
export const segmentSchema = z
  .object({
    id: idSchema,
    startMs: ms,
    endMs: ms,
    sourceText: z.string().max(20000),
    translatedText: z.string().max(20000),
    translationStale: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.endMs > v.startMs, "结束时间必须大于开始时间");
export type Segment = z.infer<typeof segmentSchema>;
export const newSegmentSchema = z
  .object({
    startMs: segmentSchema.shape.startMs,
    endMs: segmentSchema.shape.endMs,
    sourceText: segmentSchema.shape.sourceText.refine(
      (text) => text.trim().length > 0,
      "请输入原文字幕",
    ),
    translatedText: segmentSchema.shape.translatedText.optional(),
  })
  .strict()
  .refine(
    (segment) => segment.endMs > segment.startMs,
    "结束时间必须大于开始时间",
  );
export type NewSegment = z.infer<typeof newSegmentSchema>;
export const profileInputSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().min(1).max(100),
    protocol: z.enum(["openai", "anthropic", "gemini"]),
    mode: z.enum(["chat", "responses"]).default("chat"),
    baseUrl: z.string().url(),
    model: z.string().min(1).max(200),
    apiKey: z.string().max(10000).optional(),
    sessionOnly: z.boolean().default(false),
    timeoutMs: z.number().int().min(1000).max(300000).default(120000),
    streaming: z.enum(["auto", "disabled"]).optional(),
    textTimeoutMs: z.number().int().min(60000).max(3600000).optional(),
    maxUploadBytes: z
      .number()
      .int()
      .min(100000)
      .max(100000000)
      .default(24000000),
    structuredOutput: z.boolean().default(false),
  })
  .strict();
export type ProfileInput = z.input<typeof profileInputSchema>;
export type Profile = Omit<
  z.output<typeof profileInputSchema>,
  "apiKey" | "id"
> & { id: string; hasKey: boolean };
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const styleSchema = z
  .object({
    version: z.literal(1),
    templateId: z.enum(["clean", "cinematic", "teaching", "bold", "soft"]),
    fontId: z.enum(["managed-cjk", "managed-cjk-bold"]),
    fontSizeRatio: z.number().min(0.015).max(0.08),
    textColor: color,
    outlineColor: color,
    outlineWidthRatio: z.number().min(0).max(0.005),
    shadow: z
      .object({
        color,
        opacity: z.number().min(0).max(1),
        offsetXRatio: z.number().min(-0.01).max(0.01),
        offsetYRatio: z.number().min(-0.01).max(0.01),
      })
      .strict(),
    layout: z
      .object({
        anchor: z.enum(["top-center", "center", "bottom-center"]),
        marginBottomRatio: z.number().min(0.02).max(0.25),
        maxWidthRatio: z.number().min(0.5).max(0.95),
        sourceScale: z.number().min(0.6).max(1),
      })
      .strict(),
    animation: z
      .object({
        type: z.enum(["none", "fade"]),
        inMs: ms.max(1000),
        outMs: ms.max(1000),
      })
      .strict(),
    emphasisColor: color,
    emphasisBySegment: z
      .array(
        z
          .object({
            segmentId: idSchema,
            keywords: z.array(z.string().min(1).max(100)).max(20),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export type SubtitleStyle = z.infer<typeof styleSchema>;
export const DEFAULT_STYLE: SubtitleStyle = {
  version: 1,
  templateId: "clean",
  fontId: "managed-cjk",
  fontSizeRatio: 0.045,
  textColor: "#FFFFFF",
  outlineColor: "#111111",
  outlineWidthRatio: 0.002,
  shadow: {
    color: "#000000",
    opacity: 0.65,
    offsetXRatio: 0,
    offsetYRatio: 0.002,
  },
  layout: {
    anchor: "bottom-center",
    marginBottomRatio: 0.08,
    maxWidthRatio: 0.86,
    sourceScale: 0.8,
  },
  animation: { type: "fade", inMs: 120, outMs: 120 },
  emphasisColor: "#FFD54F",
  emphasisBySegment: [],
};
export const optionsSchema = z
  .object({
    sourceLanguage: z.string().min(1).max(50).default("auto"),
    targetLanguage: z.string().min(1).max(50).default("zh-CN"),
    recognition: z.enum(["local", "cloud"]).default("local"),
    recognitionProfileId: idSchema.optional(),
    translationProfileId: idSchema.optional(),
    reviewProfileId: idSchema.optional(),
    chapterProfileId: idSchema.optional(),
    chapterConcurrency: z.number().int().min(1).max(3).optional(),
    translationEnabled: z.boolean().default(true),
    styleProfileId: idSchema.optional(),
    modelId: z.enum(["base", "small", "large-v3-turbo"]).default("base"),
    preferGpu: z.boolean().default(true),
    bilingual: z.boolean().default(false),
  })
  .strict();
export type JobOptions = z.infer<typeof optionsSchema>;
export type StageName =
  | "recognize"
  | "translate"
  | "style"
  | "preview"
  | "export";
export type Stage = {
  state:
    | "idle"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "interrupted";
  progress: number;
  message: string;
  code?: string;
};
export type MediaInfo = {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  audioOffsetMs: number;
  rotation: number;
  sampleAspectRatio: string;
};
export type Job = {
  id: string;
  name: string;
  inputPath: string;
  media: MediaInfo;
  options: JobOptions;
  segments: Segment[];
  style: SubtitleStyle;
  revision: number;
  createdAt: number;
  updatedAt: number;
  stages: Record<StageName, Stage>;
  actualBackend?: "cpu" | "gpu" | "cloud";
  previewUrl?: string;
  outputs: string[];
  reviewReport?: ReviewReport;
  repairRun?: RepairRun;
  nameReport?: NameReport;
  nameBatch?: NameBatch;
  chapterPlan?: ChapterPlan;
  customChapterPlan?: ChapterPlan;
  reviewRun?: ChapterReviewRun;
};
export const stageSchema: z.ZodType<Stage> = z
  .object({
    state: z.enum([
      "idle",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "interrupted",
    ]),
    progress: z.number().min(0).max(1),
    message: z.string(),
    code: z.string().optional(),
  })
  .strict();
export const mediaInfoSchema: z.ZodType<MediaInfo> = z
  .object({
    durationMs: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    hasAudio: z.boolean(),
    audioOffsetMs: z.number().int(),
    rotation: z.number().finite(),
    sampleAspectRatio: z.string(),
  })
  .strict();
export const jobSchema: z.ZodType<Job> = z
  .object({
    id: idSchema,
    name: z.string(),
    inputPath: z.string(),
    media: mediaInfoSchema,
    options: optionsSchema,
    segments: z.array(segmentSchema),
    style: styleSchema,
    revision: ms,
    createdAt: ms,
    updatedAt: ms,
    stages: z
      .object({
        recognize: stageSchema,
        translate: stageSchema,
        style: stageSchema,
        preview: stageSchema,
        export: stageSchema,
      })
      .strict(),
    actualBackend: z.enum(["cpu", "gpu", "cloud"]).optional(),
    previewUrl: z.string().optional(),
    outputs: z.array(z.string()),
    reviewReport: reviewReportSchema.optional(),
    chapterPlan: chapterPlanSchema.optional(),
    customChapterPlan: chapterPlanSchema.optional(),
    reviewRun: chapterReviewRunSchema.optional(),
    repairRun: repairRunSchema.optional(),
    nameReport: nameReportSchema.optional(),
    nameBatch: nameBatchSchema.optional(),
  })
  .strict();
export const profileSchema = profileInputSchema
  .omit({ apiKey: true, id: true })
  .extend({ id: idSchema, hasKey: z.boolean() })
  .strict();
export type RuntimeStatus = {
  downloadCache?: ArtifactCacheSummary;
  installed: boolean;
  cpuReady: boolean;
  gpuReady: boolean;
  actualBackend: "cpu" | "gpu" | "unavailable";
  message: string;
  installedModels: string[];
  gpuName?: string;
  totalMemoryGb: number;
  catalog: {
    id: "base" | "small" | "large-v3-turbo";
    name: string;
    sizeBytes: number;
  }[];
};
export type ProgressEvent = {
  jobId?: string;
  stage: StageName | "install" | "review" | "repair" | "names" | "chapters";
  progress: number;
  message: string;
  job?: Job;
  repairRunId?: string;
};
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: string };
export type ExportInput = ExportVideoOptions & {
  jobId: string;
  format: "mp4" | "mkv" | "srt" | "ass" | "vtt";
  quality?: "balanced" | "high" | "small";
};
export type AppApi = {
  diagnostics: {
    live(input?: DiagnosticsLiveInput): Promise<Result<ProviderLiveSnapshot[]>>;
    list(input?: DiagnosticsListInput): Promise<Result<ProviderDiagnostic[]>>;
    detail(id: string): Promise<Result<ProviderDiagnostic>>;
    readAnswer(id: string): Promise<Result<{ text: string; truncated: boolean }>>;
    clear(ids?: string[]): Promise<Result<void>>;
  };
  chapterCriteria: {
    list(): Promise<Result<CriterionLibrary>>;
    save(input: SaveCriterionInput): Promise<Result<CriterionLibrary>>;
    copy(input: CriterionIdentity): Promise<Result<CriterionLibrary>>;
    remove(input: CriterionIdentity): Promise<Result<CriterionLibrary>>;
    select(input: { id?: string }): Promise<Result<CriterionLibrary>>;
  };
  chapterExports: {
    export(input: ChapterExportInput): Promise<Result<ChapterExportRun | null>>;
    list(jobId: string): Promise<Result<ChapterExportRun[]>>;
  };
  exportSettings: {
    status(): Promise<Result<ExportSettings>>;
    saveSettings(input: ExportSettingsInput): Promise<Result<ExportSettings>>;
    chooseDirectory(): Promise<Result<ExportSettings | null>>;
  };
  download: {
    status(): Promise<Result<DownloadStatus>>;
    clearDownloadCache(): Promise<Result<DownloadStatus>>;
    saveSettings(input: DownloadSettingsInput): Promise<Result<DownloadStatus>>;
    chooseDirectory(): Promise<Result<DownloadStatus | null>>;
    install(): Promise<Result<DownloadStatus>>;
    importUrl(input: {
      url: string;
      options?: ImportOptions;
    }): Promise<Result<Job>>;
    cancel(): Promise<Result<void>>;
  };
  onDownloadStatus(handler: (status: DownloadStatus) => void): () => void;
  profiles: {
    list(): Promise<Result<Profile[]>>;
    save(input: ProfileInput): Promise<Result<Profile>>;
    remove(id: string): Promise<Result<void>>;
    test(
      id: string,
      purpose?: "text" | "recognition",
    ): Promise<Result<{ message: string }>>;
  };
  runtime: {
    status(): Promise<Result<RuntimeStatus>>;
    clearDownloadCache(): Promise<Result<RuntimeStatus>>;
    install(input: {
      modelId: "base" | "small" | "large-v3-turbo";
      preferGpu: boolean;
    }): Promise<Result<RuntimeStatus>>;
    cancel(): Promise<Result<void>>;
  };
  jobs: {
    list(): Promise<Result<Job[]>>;
    get(id: string): Promise<Result<Job>>;
    importVideo(options?: ImportOptions): Promise<Result<Job | null>>;
    planChapters(input: PlanChaptersInput): Promise<Result<Job>>;
    updateChapters(input: UpdateChaptersInput): Promise<Result<Job>>;
    planReprocess(input: PlanReprocessInput): Promise<Result<ReprocessPlan>>;
    recognizePartial(input: RecognizePartialInput): Promise<Result<Job>>;
    translatePartial(input: ReprocessInput): Promise<Result<Job>>;
    reviewSubtitles(input: ReviewSubtitlesInput): Promise<Result<Job>>;
    repairLoop(input: RepairLoopInput): Promise<Result<Job>>;
    analyzeNames(input: AnalyzeNamesInput): Promise<Result<Job>>;
    applyNames(input: ApplyNamesInput): Promise<Result<Job>>;
    undoNames(input: UndoNamesInput): Promise<Result<Job>>;
    acknowledgeFinding(input: AcknowledgeFindingInput): Promise<Result<Job>>;
    updateOptions(input: {
      jobId: string;
      options: JobOptions;
    }): Promise<Result<Job>>;
    recognize(id: string): Promise<Result<Job>>;
    recognizeAgain(input: {
      jobId: string;
      revision: number;
    }): Promise<Result<Job>>;
    translate(input: {
      jobId: string;
      segmentIds?: string[];
    }): Promise<Result<Job>>;
    editSegment(input: {
      jobId: string;
      segment: Segment;
      revision: number;
    }): Promise<Result<Job>>;
    addSegment(input: {
      jobId: string;
      revision: number;
      segment: NewSegment;
    }): Promise<Result<Job>>;
    removeSegment(input: {
      jobId: string;
      revision: number;
      segmentId: string;
    }): Promise<Result<Job>>;
    setStyle(input: {
      jobId: string;
      style: SubtitleStyle;
    }): Promise<Result<Job>>;
    designStyle(input: { jobId: string; prompt: string }): Promise<Result<Job>>;
    preview(input: {
      jobId: string;
      atMs: number;
    }): Promise<Result<{ url: string; job: Job }>>;
    playback(id: string): Promise<Result<{ url: string }>>;
    export(input: ExportInput): Promise<Result<{ path: string } | null>>;
    cancel(id: string): Promise<Result<void>>;
  };
  onProgress(handler: (event: ProgressEvent) => void): () => void;
};
declare global {
  interface Window {
    api: AppApi;
  }
}
