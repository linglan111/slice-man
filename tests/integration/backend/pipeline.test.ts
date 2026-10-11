import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../../../src/main/db/store";
import { MediaService } from "../../../src/main/services/media/lib/media-service";
import { JobService } from "../../../src/main/services/jobs/lib/job-service";
import { runProcess } from "../../../src/main/lib/process";
import * as processTools from "../../../src/main/lib/process";
import { AppError } from "../../../src/main/lib/errors";
import { DEFAULT_STYLE, type Job } from "../../../src/shared/contracts";
import { compileSubtitles } from "../../../src/main/services/subtitles/lib/compiler";
const fixtures: { root: string; store: Store; server: Server }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    f.server.closeAllConnections();
    await new Promise<void>((resolve) => f.server.close(() => resolve()));
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
type Control = {
  recognitionCalls: number;
  translationCalls: number;
  mode: "good" | "incomplete" | "slow" | "invalid-style";
  responseGate?: Promise<void>;
  entered?: () => void;
  incompleteAfter?: number;
  selectedBatches?: string[][];
  cloudSegments?: { start: number; end: number; text: string }[];
  recognitionBodies?: string[];
};
async function fixture(
  durationSeconds = 2,
  audioOffsetSeconds = 0,
): Promise<{
  root: string;
  store: Store;
  media: MediaService;
  jobs: JobService;
  job: Job;
  control: Control;
  input: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "slice-集成 space-"));
  const input = join(
    root,
    audioOffsetSeconds ? "视频 sample.mkv" : "视频 sample.mp4",
  );
  const media = new MediaService({
    ffmpeg: resolve("resources/media/ffmpeg.exe"),
    ffprobe: resolve("resources/media/ffprobe.exe"),
    fonts: resolve("resources/fonts"),
  });
  await runProcess(media.paths.ffmpeg, [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=320x240:r=24:d=${durationSeconds}`,
    ...(audioOffsetSeconds ? ["-itsoffset", String(audioOffsetSeconds)] : []),
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=16000:duration=${durationSeconds - audioOffsetSeconds}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    audioOffsetSeconds ? "pcm_s16le" : "aac",
    "-shortest",
    input,
  ]);
  const control: Control = {
    recognitionCalls: 0,
    translationCalls: 0,
    mode: "good",
  };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += String(chunk);
    let output: unknown;
    if (req.url === "/v1/audio/transcriptions") {
      control.recognitionCalls++;
      control.recognitionBodies?.push(body);
      output = {
        segments: control.cloudSegments ?? [
          { start: 0, end: 1, text: "Hello world" },
          { start: 1, end: 1.9, text: "Second line" },
        ],
      };
    } else {
      control.translationCalls++;
      const parsed = JSON.parse(body) as { messages: { content: string }[] };
      const prompt = parsed.messages[0]?.content ?? "";
      let content: string;
      if (prompt.startsWith("Design subtitle style"))
        content =
          control.mode === "invalid-style"
            ? '{"version":99}'
            : JSON.stringify({ ...DEFAULT_STYLE, templateId: "cinematic" });
      else {
        const data = JSON.parse(prompt.split("\n")[1] ?? "{}") as {
          selected: { id: string; text: string }[];
        };
        control.selectedBatches?.push(data.selected.map((s) => s.id));
        if (control.mode === "slow") {
          control.entered?.();
          await control.responseGate;
        }
        content = JSON.stringify({
          translations:
            control.mode === "incomplete" ||
            (control.incompleteAfter !== undefined &&
              control.translationCalls >= control.incompleteAfter)
              ? []
              : data.selected.map((s) => ({
                  id: s.id,
                  text: `译文 ${s.text}`,
                })),
        });
      }
      output = { choices: [{ finish_reason: "stop", message: { content } }] };
    }
    if (!res.destroyed) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(output));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const store = new Store(join(root, "app.db"), {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error("unavailable");
    },
    decryptString: () => {
      throw new Error("unavailable");
    },
  });
  fixtures.push({ root, store, server });
  const profile = store.saveProfile({
    name: "Local HTTP fixture",
    protocol: "openai",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "fixture",
    maxUploadBytes: 100000,
    apiKey: "test-only",
    sessionOnly: true,
  });
  const jobs = new JobService(
    store,
    media,
    {
      executable: () => {
        throw new Error("not installed");
      },
      modelPath: () => {
        throw new Error("not installed");
      },
    },
    root,
    () => {},
    (path) => path,
  );
  let job = await jobs.importVideo(input);
  job = jobs.updateOptions(job.id, {
    ...job.options,
    recognition: "cloud",
    recognitionProfileId: profile.id,
    translationProfileId: profile.id,
    styleProfileId: profile.id,
  });
  return { root, store, media, jobs, job, control, input };
}
function localRecognizer(
  f: Awaited<ReturnType<typeof fixture>>,
  native: (
    backend: "cpu" | "gpu",
    signal: AbortSignal | undefined,
  ) => Promise<string[]>,
): JobService {
  const cpu = join(f.root, "injected-cpu.exe");
  const gpu = join(f.root, "injected-gpu.exe");
  const executeReal = processTools.runProcess;
  vi.spyOn(processTools, "runProcess").mockImplementation(
    async (executable, args, options) => {
      if (executable !== cpu && executable !== gpu)
        return executeReal(executable, args, options);
      // Verify the native boundary policy, including CPU fallback. Keep repeated
      // speech in output: decoder prevention must never become text deduplication.
      expect(args[args.indexOf("-mc") + 1]).toBe("0");
      const prefix = args[args.indexOf("-of") + 1];
      if (!prefix) throw new Error("Missing native output path");
      const backend = executable === cpu ? "cpu" : "gpu";
      const texts = await native(backend, options?.signal);
      await writeFile(
        `${prefix}.json`,
        JSON.stringify({
          transcription: texts.map((text, index) => ({
            offsets: { from: index * 600, to: index * 600 + 500 },
            text,
          })),
        }),
      );
      return {
        stdout: "",
        stderr: backend === "gpu" ? "CUDA0 model buffer size = 123 MiB" : "",
      };
    },
  );
  const jobs = new JobService(
    f.store,
    f.media,
    {
      executable: (preferGpu) => ({
        path: preferGpu ? gpu : cpu,
        backend: preferGpu ? "gpu" : "cpu",
      }),
      modelPath: () => join(f.root, "injected-model.bin"),
    },
    f.root,
    () => {},
    (path) => path,
  );
  jobs.updateOptions(f.job.id, {
    ...f.job.options,
    recognition: "local",
    sourceLanguage: "ja",
  });
  return jobs;
}
describe("real FFmpeg + SQLite + local HTTP pipeline", () => {
  it.each(["cpu", "gpu", "gpu-fallback"] as const)(
    "disables decoder history and retains legitimate repeated speech with %s",
    async (mode) => {
      const f = await fixture();
      const backends: string[] = [];
      const texts = [
        "繰り返す言葉です。",
        "繰り返す言葉です。",
        "次の説明です。",
      ];
      const jobs = localRecognizer(f, async (backend) => {
        backends.push(backend);
        if (mode === "gpu-fallback" && backend === "gpu")
          throw new AppError("PROCESS_FAILED", "Injected GPU failure");
        return texts;
      });
      const configured = f.store.getJob(f.job.id);
      jobs.updateOptions(configured.id, {
        ...configured.options,
        preferGpu: mode !== "cpu",
      });
      const result = await jobs.recognize(configured.id);
      expect(backends).toEqual(
        mode === "gpu-fallback" ? ["gpu", "cpu"] : [mode],
      );
      expect(result.actualBackend).toBe(mode === "gpu" ? "gpu" : "cpu");
      expect(result.segments.map((s) => s.sourceText)).toEqual(texts);
      expect(result.segments.map((s) => [s.startMs, s.endMs])).toEqual([
        [0, 500],
        [600, 1100],
        [1200, 1700],
      ]);
      expect(f.store.getJob(result.id).stages.recognize.state).toBe(
        "succeeded",
      );
      expect(f.control.recognitionCalls).toBe(0);
    },
  );
  it("explicitly recognizes again, replacing corrections and invalidating derived states only after success", async () => {
    const f = await fixture();
    const recognized = await f.jobs.recognize(f.job.id);
    const first = recognized.segments[0];
    if (!first) throw new Error("Missing recognition fixture cue");
    const prior = f.jobs.editSegment(
      recognized.id,
      { ...first, sourceText: "Manually corrected before re-recognition" },
      recognized.revision,
    );
    const translated = await f.jobs.translate(prior.id);
    const artifact = join(f.root, "existing-reference.txt");
    await writeFile(artifact, "prior artifact");
    translated.previewUrl = "app-media://local/old-preview";
    translated.outputs = [artifact];
    translated.stages.preview.state = "succeeded";
    translated.stages.export.state = "succeeded";
    f.store.saveJob(translated);
    let calls = 0;
    const jobs = localRecognizer(f, async () => {
      calls++;
      return ["新しい字幕です。"];
    });
    const before = f.store.getJob(prior.id);
    // Seed a completed, translated local run to exercise the successful cache.
    before.stages.recognize.state = "succeeded";
    f.store.saveJob(before);
    expect((await jobs.recognize(before.id)).segments).toEqual(before.segments);
    expect(calls).toBe(0);
    const result = await jobs.recognizeAgain(before.id, before.revision);
    expect(calls).toBe(1);
    expect(result.segments.map((s) => s.sourceText)).toEqual([
      "新しい字幕です。",
    ]);
    expect(result.segments.every((s) => s.translatedText === "")).toBe(true);
    expect(result.revision).toBe(before.revision + 1);
    expect(result.stages.recognize.state).toBe("succeeded");
    expect(result.stages.translate.state).toBe("idle");
    expect(result.stages.preview.state).toBe("idle");
    expect(result.stages.export.state).toBe("idle");
    expect(result.previewUrl).toBeUndefined();
    expect(result.style).toEqual(before.style);
    expect(result.outputs).toEqual([artifact]);
    expect(await readFile(artifact, "utf8")).toBe("prior artifact");
  });
  it.each(["failed", "cancelled"] as const)(
    "preserves corrected translated content and derived files when recognition again is %s",
    async (mode) => {
      const f = await fixture();
      await f.jobs.recognize(f.job.id);
      const old = await f.jobs.translate(f.job.id);
      const artifact = join(f.root, "prior-output.srt");
      await writeFile(artifact, "keep existing export");
      old.outputs = [artifact];
      old.previewUrl = "app-media://local/prior-reference";
      const cue = old.segments[0];
      if (!cue) throw new Error("Missing existing cue");
      old.style = {
        ...old.style,
        templateId: "cinematic",
        emphasisBySegment: [
          {
            segmentId: cue.id,
            keywords: [cue.translatedText || cue.sourceText],
          },
        ],
      };
      f.store.saveJob(old);
      let entered: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const jobs = localRecognizer(f, async (_backend, signal) => {
        if (mode === "failed")
          throw new AppError("PROCESS_FAILED", "Injected failure");
        entered?.();
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new AppError("CANCELLED", "Cancelled")),
            { once: true },
          );
        });
        return [];
      });
      const before = f.store.getJob(old.id);
      before.stages.recognize.state = "succeeded";
      f.store.saveJob(before);
      const pending = jobs.recognizeAgain(old.id, before.revision);
      const failure = expect(pending).rejects.toMatchObject({
        code: mode === "failed" ? "PROCESS_FAILED" : "CANCELLED",
      });
      if (mode === "cancelled") {
        await started;
        await expect(
          jobs.recognizeAgain(old.id, before.revision),
        ).rejects.toMatchObject({ code: "JOB_BUSY" });
        jobs.cancel(old.id);
      }
      await failure;
      const after = f.store.getJob(old.id);
      expect(after.stages.recognize.state).toBe(mode);
      expect(after.segments).toEqual(before.segments);
      expect(after.style).toEqual(before.style);
      expect(after.outputs).toEqual(before.outputs);
      expect(after.previewUrl).toEqual(before.previewUrl);
      expect(after.revision).toBe(before.revision);
      expect(await readFile(artifact, "utf8")).toBe("keep existing export");
    },
  );
  it("clears stale emphasis when new recognition recycles an old cue ID and keyword", async () => {
    const f = await fixture();
    let calls = 0;
    const jobs = localRecognizer(f, async () => [
      calls++ === 0 ? "同じ言葉、古い場面。" : "同じ言葉、新しい場面。",
    ]);
    const initial = await jobs.recognize(f.job.id);
    const cue = initial.segments[0];
    if (!cue) throw new Error("Missing initial local cue");
    const styled = jobs.setStyle(initial.id, {
      ...initial.style,
      templateId: "cinematic",
      textColor: "#AABBCC",
      emphasisBySegment: [{ segmentId: cue.id, keywords: ["同じ"] }],
    });
    styled.stages.style.state = "succeeded";
    f.store.saveJob(styled);
    const result = await jobs.recognizeAgain(styled.id, styled.revision);
    expect(result.segments[0]).toMatchObject({
      id: cue.id,
      sourceText: "同じ言葉、新しい場面。",
    });
    expect(result.style).toEqual({ ...styled.style, emphasisBySegment: [] });
    expect(result.stages.style.state).toBe("idle");
    expect(
      compileSubtitles(
        result.segments,
        result.style,
        result.media,
        false,
        "ass",
      ),
    ).not.toContain("{\\c");
  });
  it("preserves old content when cancellation arrives as successful native output finishes", async () => {
    const f = await fixture();
    await f.jobs.recognize(f.job.id);
    const old = await f.jobs.translate(f.job.id);
    const artifact = join(f.root, "completed-before-cancel.srt");
    await writeFile(artifact, "existing export");
    old.outputs = [artifact];
    old.previewUrl = "app-media://local/previous";
    const cue = old.segments[0];
    if (!cue) throw new Error("Missing old cue");
    old.style.emphasisBySegment = [
      {
        segmentId: cue.id,
        keywords: [cue.translatedText || cue.sourceText],
      },
    ];
    f.store.saveJob(old);
    const jobs = localRecognizer(f, async () => {
      // Model completion and cancellation can race with the asynchronous
      // output/receipt reads even after the native process itself has exited.
      jobs.cancel(old.id);
      return ["Late successful native output"];
    });
    const before = f.store.getJob(old.id);
    before.stages.recognize.state = "succeeded";
    f.store.saveJob(before);
    await expect(
      jobs.recognizeAgain(old.id, before.revision),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    const after = f.store.getJob(old.id);
    expect(after.stages.recognize.state).toBe("cancelled");
    expect(after.revision).toBe(before.revision);
    expect(after.segments).toEqual(before.segments);
    expect(after.style).toEqual(before.style);
    expect(after.outputs).toEqual(before.outputs);
    expect(after.previewUrl).toBe(before.previewUrl);
    expect(await readFile(artifact, "utf8")).toBe("existing export");
  });
  it("rejects an outdated recognition-again confirmation without extraction or state changes", async () => {
    const f = await fixture();
    let calls = 0;
    const jobs = localRecognizer(f, async () => {
      calls++;
      return [];
    });
    const before = f.store.getJob(f.job.id);
    const extraction = vi.spyOn(f.media, "extract");
    await expect(
      jobs.recognizeAgain(before.id, before.revision - 1),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(calls).toBe(0);
    expect(extraction).not.toHaveBeenCalled();
    expect(f.store.getJob(before.id)).toEqual(before);
  });
  it("rejects late recognition-again output after an external persisted revision change", async () => {
    const f = await fixture();
    await f.jobs.recognize(f.job.id);
    let entered: (() => void) | undefined;
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const jobs = localRecognizer(f, async () => {
      entered?.();
      await gate;
      return ["Late native result"];
    });
    const before = f.store.getJob(f.job.id);
    before.stages.recognize.state = "succeeded";
    f.store.saveJob(before);
    const pending = jobs.recognizeAgain(before.id, before.revision);
    const failure = expect(pending).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    await started;
    const current = f.store.getJob(before.id);
    const first = current.segments[0];
    if (!first) throw new Error("Missing fixture cue");
    // Simulate an external persisted revision; user editing now rejects busy work.
    current.segments = current.segments.map((segment) =>
      segment.id === first.id
        ? { ...segment, sourceText: "New persisted correction" }
        : segment,
    );
    current.revision++;
    const edited = f.store.saveJob(current);
    release?.();
    await failure;
    const after = f.store.getJob(before.id);
    expect(after.revision).toBe(edited.revision);
    expect(after.segments).toEqual(edited.segments);
    expect(after.segments[0]?.sourceText).toBe("New persisted correction");
  });
  it.each([
    {
      name: "mixed valid and zero-span Japanese cues",
      transcription: [
        { offsets: { from: 0, to: 900 }, text: "最初の字幕です。" },
        { offsets: { from: 900, to: 900 }, text: "、" },
        { offsets: { from: 1000, to: 1900 }, text: "次の字幕です。" },
        { offsets: { from: 2000, to: 2000 }, text: "。" },
      ],
      expectedIds: ["local-0", "local-2"],
    },
    {
      name: "all-zero native cues follow the existing empty-result contract",
      transcription: [
        { offsets: { from: 0, to: 0 }, text: "。" },
        { offsets: { from: 1000, to: 1000 }, text: "、" },
      ],
      expectedIds: [],
    },
  ])(
    "commits local recognition successfully for $name",
    async ({ transcription, expectedIds }) => {
      const f = await fixture();
      const nativeExecutable = join(f.root, "injected-native-output.exe");
      const executeReal = processTools.runProcess;
      let nativeCalls = 0;
      // Inject only the Whisper process output, not media extraction, SQLite,
      // normalization or job-stage handling. No user data or real API is touched.
      vi.spyOn(processTools, "runProcess").mockImplementation(
        async (executable, args, options) => {
          if (executable !== nativeExecutable)
            return executeReal(executable, args, options);
          nativeCalls++;
          expect(args[args.indexOf("-l") + 1]).toBe("ja");
          const prefix = args[args.indexOf("-of") + 1];
          if (!prefix) throw new Error("Missing native output path");
          await writeFile(
            `${prefix}.json`,
            JSON.stringify({
              model: { type: "large-v3-turbo" },
              params: { language: "ja" },
              transcription,
            }),
          );
          return { stdout: "", stderr: "" };
        },
      );
      const jobs = new JobService(
        f.store,
        f.media,
        {
          executable: () => ({ path: nativeExecutable, backend: "cpu" }),
          modelPath: () => join(f.root, "injected-model.bin"),
        },
        f.root,
        () => {},
        (path) => path,
      );
      const imported = jobs.updateOptions(f.job.id, {
        ...f.job.options,
        recognition: "local",
        sourceLanguage: "ja",
        modelId: "large-v3-turbo",
        preferGpu: false,
      });
      const recognized = await jobs.recognize(imported.id);
      expect(recognized.stages.recognize.state).toBe("succeeded");
      expect(recognized.actualBackend).toBe("cpu");
      expect(recognized.segments.map((cue) => cue.id)).toEqual(expectedIds);
      expect(f.store.getJob(imported.id).segments).toEqual(recognized.segments);
      expect(
        (await stat(join(f.root, "jobs", imported.id, "audio.wav"))).size,
      ).toBeGreaterThan(1000);
      await jobs.recognize(imported.id);
      expect(nativeCalls).toBe(1);
      expect(f.control.recognitionCalls).toBe(0);
    },
  );
  it("rejects a late translation after a material provider profile edit", async () => {
    const f = await fixture();
    const job = await f.jobs.recognize(f.job.id);
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.control.responseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.control.entered = () => entered?.();
    f.control.mode = "slow";
    const translation = f.jobs.translate(job.id);
    await started;
    const profileId = job.options.translationProfileId;
    if (!profileId) throw new Error("profile");
    const { hasKey: _hasKey, ...profile } = f.store.getProfile(profileId);
    f.store.saveProfile({ ...profile, model: "new-model" });
    release?.();
    await expect(translation).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(
      f.store
        .getJob(job.id)
        .segments.every((segment) => !segment.translatedText),
    ).toBe(true);
    expect(f.store.getJob(job.id).stages.recognize.state).toBe("idle");
  }, 15000);
  it("carries the selected source locale through real extraction to cloud multipart language", async () => {
    const f = await fixture();
    f.control.recognitionBodies = [];
    const job = f.jobs.updateOptions(f.job.id, {
      ...f.job.options,
      sourceLanguage: "zh-TW",
    });
    await f.jobs.recognize(job.id);
    expect(f.control.recognitionBodies).toHaveLength(1);
    expect(f.control.recognitionBodies[0]).toContain(
      'name="language"\r\n\r\nzh\r\n',
    );
  });
  it("combines delayed audio with chunk boundaries without shifting offsets twice", async () => {
    const f = await fixture(8, 0.5);
    f.control.cloudSegments = [{ start: 0, end: 0.1, text: "chunk speech" }];
    expect(f.job.media.audioOffsetMs).toBe(500);
    const job = await f.jobs.recognize(f.job.id);
    expect(f.control.recognitionCalls).toBe(3);
    expect(job.segments.map((s) => s.startMs)).toEqual([500, 3593, 6686]);
  }, 15000);
  it("adds absolute chunk offsets once across upload-limited audio", async () => {
    const f = await fixture(8);
    f.control.cloudSegments = [{ start: 0, end: 0.1, text: "chunk speech" }];
    const job = await f.jobs.recognize(f.job.id);
    expect(f.control.recognitionCalls).toBe(3);
    expect(job.segments.map((s) => s.startMs)).toEqual([0, 3093, 6186]);
    expect(job.segments.map((s) => s.id)).toEqual([
      "cloud-0-0",
      "cloud-1-0",
      "cloud-2-0",
    ]);
  }, 15000);
  it("retains completed batches and retries only unfinished translations", async () => {
    const f = await fixture();
    let job = await f.jobs.recognize(f.job.id);
    job.segments = Array.from({ length: 31 }, (_, i) => ({
      id: `s${i}`,
      startMs: i * 60,
      endMs: i * 60 + 50,
      sourceText: `line ${i}`,
      translatedText: "",
      translationStale: false,
    }));
    f.store.saveJob(job);
    f.control.selectedBatches = [];
    f.control.incompleteAfter = 2;
    await expect(f.jobs.translate(job.id)).rejects.toMatchObject({
      code: "TRANSLATION_INCOMPLETE",
    });
    expect(
      f.store.getJob(job.id).segments.filter((s) => s.translatedText),
    ).toHaveLength(30);
    delete f.control.incompleteAfter;
    job = await f.jobs.translate(job.id);
    expect(job.segments.every((s) => !!s.translatedText)).toBe(true);
    expect(f.control.selectedBatches.map((batch) => batch.length)).toEqual([
      30, 1, 1, 1,
    ]);
    expect(f.control.recognitionCalls).toBe(1);
  }, 15000);
  it("checks export revision before publication and preserves a preexisting destination", async () => {
    const f = await fixture();
    let job = await f.jobs.recognize(f.job.id);
    job = await f.jobs.translate(job.id);
    const destination = join(f.root, "existing.mp4");
    await writeFile(destination, "user existing output");
    const realRender = f.media.render.bind(f.media);
    vi.spyOn(f.media, "render").mockImplementation(async (...args) => {
      await realRender(...args);
      const latest = f.store.getJob(job.id);
      const first = latest.segments[0];
      if (!first) throw new Error("segment");
      // A persisted external change must still guard no-clobber publication.
      latest.segments = latest.segments.map((segment) =>
        segment.id === first.id
          ? { ...segment, translatedText: "new edit" }
          : segment,
      );
      latest.revision++;
      f.store.saveJob(latest);
    });
    await expect(
      f.jobs.export(job.id, "mp4", "balanced", destination),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(await readFile(destination, "utf8")).toBe("user existing output");
    expect(f.store.getJob(job.id).outputs).toEqual([]);
  }, 15000);
  it("retains successful recognition after failed translation, selected edits reach every export, and burns actual pixels", async () => {
    const f = await fixture();
    const original = await readFile(f.input);
    let job = await f.jobs.recognize(f.job.id);
    expect(job.stages.recognize.state).toBe("succeeded");
    f.control.mode = "incomplete";
    await expect(f.jobs.translate(job.id)).rejects.toMatchObject({
      code: "TRANSLATION_INCOMPLETE",
    });
    expect(f.store.getJob(job.id).stages.recognize.state).toBe("succeeded");
    f.control.mode = "good";
    job = await f.jobs.translate(job.id);
    expect(f.control.recognitionCalls).toBe(1);
    const second = job.segments[1];
    if (!second) throw new Error("segment");
    job = f.jobs.editSegment(
      job.id,
      { ...second, translatedText: "人工修订", startMs: 1100, endMs: 1900 },
      job.revision,
    );
    job = await f.jobs.translate(job.id, [job.segments[0]?.id ?? ""]);
    expect(job.segments[1]?.translatedText).toBe("人工修订");
    expect(job.segments[1]?.startMs).toBe(1100);
    job = await f.jobs.designStyle(job.id, "cinematic");
    const preview = await f.jobs.preview(job.id, 1500);
    expect((await stat(preview.url)).size).toBeGreaterThan(1000);
    for (const format of ["srt", "ass", "vtt"] as const) {
      const path = join(f.root, `out.${format}`);
      await f.jobs.export(job.id, format, "balanced", path);
      expect(await readFile(path, "utf8")).toContain("人工修订");
    }
    const video = join(f.root, "成品 burned.mp4");
    await f.jobs.export(job.id, "mp4", "balanced", video);
    const output = await f.media.probe(video);
    expect(output.width).toBe(320);
    expect(output.durationMs).toBeGreaterThan(1900);
    const pix = await runProcess(f.media.paths.ffmpeg, [
      "-v",
      "error",
      "-ss",
      "1.5",
      "-i",
      video,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "pipe:1",
    ]); // decoded grayscale text pixels must differ from black background
    expect([...pix.stdout].some((c) => c.charCodeAt(0) > 50)).toBe(true);
    expect(await readFile(f.input)).toEqual(original);
    await expect(
      f.jobs.export(job.id, "mp4", "balanced", video),
    ).rejects.toMatchObject({ code: "DESTINATION_EXISTS" });
    expect((await stat(video)).size).toBeGreaterThan(1000);
  }, 30000);
  it("guards late translation against an external persisted revision change", async () => {
    const f = await fixture();
    const job = await f.jobs.recognize(f.job.id);
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    f.control.responseGate = new Promise<void>((r) => {
      release = r;
    });
    f.control.entered = () => entered?.();
    f.control.mode = "slow";
    const translation = f.jobs.translate(job.id);
    await started;
    const latest = f.store.getJob(job.id);
    const first = latest.segments[0];
    if (!first) throw new Error("segment");
    // User editing is busy-guarded; emulate a separate persisted revision source.
    latest.segments = latest.segments.map((segment) =>
      segment.id === first.id
        ? { ...segment, translatedText: "保留已有修改" }
        : segment,
    );
    latest.revision++;
    f.store.saveJob(latest);
    release?.();
    await expect(translation).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(f.store.getJob(job.id).segments[0]?.translatedText).toBe(
      "保留已有修改",
    );
  }, 15000);
  it("cancels pending API work and preserves completed recognition", async () => {
    const f = await fixture();
    const job = await f.jobs.recognize(f.job.id);
    let entered: (() => void) | undefined;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    f.control.responseGate = new Promise<void>(() => {});
    f.control.entered = () => entered?.();
    f.control.mode = "slow";
    const translation = f.jobs.translate(job.id);
    await started;
    f.jobs.cancel(job.id);
    await expect(translation).rejects.toMatchObject({ code: "CANCELLED" });
    const retained = f.store.getJob(job.id);
    expect(retained.stages.translate.state).toBe("cancelled");
    expect(retained.stages.recognize.state).toBe("succeeded");
    expect(retained.segments).toHaveLength(2);
  }, 15000);
  it("keeps last valid style after bounded invalid AI output and rejects changed original media", async () => {
    const f = await fixture();
    let job = await f.jobs.recognize(f.job.id);
    job = await f.jobs.translate(job.id);
    const before = job.style;
    f.control.mode = "invalid-style";
    await expect(f.jobs.designStyle(job.id, "anything")).rejects.toMatchObject({
      code: "STYLE_INVALID",
    });
    expect(f.store.getJob(job.id).style).toEqual(before);
    expect(f.control.translationCalls).toBe(3);
    await writeFile(f.input, "changed original");
    await expect(f.jobs.recognize(job.id)).rejects.toMatchObject({
      code: "INPUT_CHANGED",
    });
    await expect(f.jobs.preview(job.id, 100)).rejects.toMatchObject({
      code: "INPUT_CHANGED",
    });
  }, 15000);
});
