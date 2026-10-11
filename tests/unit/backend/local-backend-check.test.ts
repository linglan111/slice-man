import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../../src/main/db/store";
import { MediaService } from "../../../src/main/services/media/lib/media-service";
import { JobService } from "../../../src/main/services/jobs/lib/job-service";
import { optionsSchema } from "../../../src/shared/contracts";

const mocks = vi.hoisted(() => ({
  logs: [] as string[],
  calls: [] as string[],
  arguments: [] as string[][],
}));
vi.mock("../../../src/main/lib/process", () => ({
  runProcess: async (
    executable: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> => {
    mocks.calls.push(executable);
    mocks.arguments.push(args);
    const prefix = args[args.indexOf("-of") + 1];
    if (!prefix) throw new Error("Missing output prefix");
    const { writeFile: output } = await import("node:fs/promises");
    await output(
      `${prefix}.json`,
      JSON.stringify({
        transcription: [{ offsets: { from: 0, to: 500 }, text: "recognized" }],
      }),
    );
    return { stdout: "", stderr: mocks.logs.shift() ?? "CPU" };
  },
}));
const fixtures: { root: string; store: Store }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  mocks.calls.length = 0;
  mocks.logs.length = 0;
  mocks.arguments.length = 0;
  for (const f of fixtures.splice(0)) {
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
describe("actual backend reporting after each recognition", () => {
  async function fixture(): Promise<{
    jobs: JobService;
    id: string;
    root: string;
  }> {
    const root = await mkdtemp(join(tmpdir(), "slice-local-backend-"));
    const store = new Store(join(root, "app.db"), {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => "",
    });
    fixtures.push({ root, store });
    const input = join(root, "input.mp4");
    await writeFile(input, "fixture");
    const media = new MediaService({
      ffmpeg: "unused",
      ffprobe: "unused",
      fonts: "unused",
    });
    vi.spyOn(media, "probe").mockResolvedValue({
      width: 320,
      height: 240,
      durationMs: 1000,
      hasAudio: true,
      audioOffsetMs: 0,
      rotation: 0,
      sampleAspectRatio: "1:1",
    });
    vi.spyOn(media, "extract").mockResolvedValue();
    const jobs = new JobService(
      store,
      media,
      {
        executable: (preferGpu) => ({
          path: preferGpu ? "fixture-gpu" : "fixture-cpu",
          backend: preferGpu ? "gpu" : "cpu",
        }),
        modelPath: () => "fixture-model",
      },
      root,
      () => {},
      (path) => path,
    );
    return { jobs, id: (await jobs.importVideo(input)).id, root };
  }
  it.each(["zh-CN", "zh-TW"])(
    "maps UI locale %s to Whisper's zh language code",
    async (sourceLanguage) => {
      const f = await fixture();
      f.jobs.updateOptions(
        f.id,
        optionsSchema.parse({ sourceLanguage, preferGpu: false }),
      );
      await f.jobs.recognize(f.id);
      const args = mocks.arguments[0];
      if (!args) throw new Error("Expected recognition invocation");
      expect(args[args.indexOf("-l") + 1]).toBe("zh");
    },
  );
  it("does not call device enumeration proof of GPU processing", async () => {
    const f = await fixture();
    mocks.logs.push("found 1 CUDA devices: RTX", "CPU");
    const job = await f.jobs.recognize(f.id);
    expect(mocks.calls).toEqual(["fixture-gpu", "fixture-cpu"]);
    expect(job.actualBackend).toBe("cpu");
    expect(job.segments).toHaveLength(1);
    const receipt = JSON.parse(
      await readFile(
        join(f.root, "jobs", f.id, "recognition-backend.json"),
        "utf8",
      ),
    ) as unknown;
    expect(receipt).toMatchObject({
      backend: "cpu",
      gpuExecutionVerified: false,
      stderrProof: "",
    });
  });
  it("reports GPU only when the inference log contains CUDA model buffer use", async () => {
    const f = await fixture();
    mocks.logs.push(
      "whisper_model_load: CUDA0 total size = 147 MB\nprivate fixture native diagnostic",
    );
    const job = await f.jobs.recognize(f.id);
    expect(mocks.calls).toEqual(["fixture-gpu"]);
    expect(job.actualBackend).toBe("gpu");
    const receipt = await readFile(
      join(f.root, "jobs", f.id, "recognition-backend.json"),
      "utf8",
    );
    expect(JSON.parse(receipt) as unknown).toMatchObject({
      backend: "gpu",
      gpuExecutionVerified: true,
    });
    expect(receipt).toContain("CUDA0 total size");
    expect(receipt).not.toContain("private");
  });
});
