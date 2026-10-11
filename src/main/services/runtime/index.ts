import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { totalmem } from "node:os";
import { z } from "zod";
import type { ProgressEvent, RuntimeStatus } from "../../../shared/contracts";
import { AppError, checkAbort } from "../../lib/errors";
import { runProcess } from "../../lib/process";
import { CPU_ARTIFACT, GPU_ARTIFACT, MODELS, ENGINE_VERSION } from "./manifest";
import type { Artifact, ModelId } from "./manifest";
import {
  downloadArtifact,
  extractArchive,
  hasGpuExecution,
  verifyArtifact,
} from "./artifacts";

const stateSchema = z
  .object({
    version: z.literal(1),
    engineVersion: z.string(),
    cpuDirectory: z.string(),
    gpuDirectory: z.string().optional(),
    gpuReady: z.boolean(),
    gpuName: z.string().optional(),
    message: z.string(),
    models: z.record(
      z.string(),
      z
        .object({ path: z.string(), size: z.number().int().positive() })
        .strict(),
    ),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
type Config = {
  root: string;
  resourceRoot: string;
  emit: (event: ProgressEvent) => void;
  // Dependency injection is used only by integration tests with local fixtures.
  artifacts?: { cpu: Artifact; gpu: Artifact; models: typeof MODELS };
  download?: typeof downloadArtifact;
  execute?: typeof runProcess;
};

export class RuntimeService {
  private readonly config: Config;
  private state: State | undefined;
  private isInstalling = false;

  constructor(config: Config) {
    this.config = config;
    this.loadState();
  }

  private loadState(): void {
    const file = join(this.config.root, "runtime-state.json");
    if (!existsSync(file)) return;
    try {
      const parsed = stateSchema.parse(
        JSON.parse(readFileSync(file, "utf8")) as unknown,
      );
      const paths = [
        parsed.cpuDirectory,
        parsed.gpuDirectory,
        ...Object.values(parsed.models).map((model) => model.path),
      ].filter((path): path is string => typeof path === "string");
      const root = resolve(this.config.root).toLowerCase() + "\\";
      if (paths.some((path) => !resolve(path).toLowerCase().startsWith(root)))
        return;
      this.state = parsed;
    } catch {
      this.state = undefined;
    }
  }

  private executableIn(directory: string): string {
    return join(directory, "Release", "whisper-cli.exe");
  }

  private emit(progress: number, message: string): void {
    this.config.emit({ stage: "install", progress, message });
  }

  async status(): Promise<RuntimeStatus> {
    this.loadState();
    const cpuReady = Boolean(
      this.state && existsSync(this.executableIn(this.state.cpuDirectory)),
    );
    const gpuReady = Boolean(
      cpuReady &&
      this.state?.gpuReady &&
      this.state.gpuDirectory &&
      existsSync(this.executableIn(this.state.gpuDirectory)),
    );
    const installedModels: string[] = [];
    for (const [id, model] of Object.entries(this.state?.models ?? {})) {
      try {
        if ((await stat(model.path)).size === model.size)
          installedModels.push(id);
      } catch {
        /* A missing model is reported as unavailable below. */
      }
    }
    let gpuName = this.state?.gpuName;
    if (!gpuName) {
      try {
        gpuName = (
          await (this.config.execute ?? runProcess)(
            "nvidia-smi",
            ["--query-gpu=name", "--format=csv,noheader"],
            { timeoutMs: 5000 },
          )
        ).stdout
          .trim()
          .split("\n")[0];
      } catch {
        /* GPU detection is optional; CPU remains available. */
      }
    }
    return {
      installed: cpuReady && installedModels.length > 0,
      cpuReady,
      gpuReady,
      actualBackend: gpuReady ? "gpu" : cpuReady ? "cpu" : "unavailable",
      message: cpuReady
        ? (this.state?.message ?? "CPU 识别已就绪。")
        : "尚未安装本地识别；选择模型并点击一键安装。",
      installedModels,
      gpuName,
      totalMemoryGb: Math.round(totalmem() / 1024 ** 3),
      catalog: Object.entries(this.config.artifacts?.models ?? MODELS).map(
        ([id, model]) => ({
          id: id as ModelId,
          name: model.name,
          sizeBytes: model.sizeBytes,
        }),
      ),
    };
  }

  executable(preferGpu: boolean): { path: string; backend: "cpu" | "gpu" } {
    if (!this.state || !existsSync(this.executableIn(this.state.cpuDirectory)))
      throw new AppError("RUNTIME_MISSING", "请先一键安装本地识别程序。");
    if (
      preferGpu &&
      this.state.gpuReady &&
      this.state.gpuDirectory &&
      existsSync(this.executableIn(this.state.gpuDirectory))
    )
      return {
        path: this.executableIn(this.state.gpuDirectory),
        backend: "gpu",
      };
    return { path: this.executableIn(this.state.cpuDirectory), backend: "cpu" };
  }

  modelPath(id: string): string {
    const model = this.state?.models[id];
    if (!model || !existsSync(model.path))
      throw new AppError("MODEL_MISSING", "所选模型未安装，请先安装该模型。");
    return model.path;
  }

  private async smoke(
    directory: string,
    model: string,
    gpu: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const sample = join(this.config.resourceRoot, "runtime-smoke.wav");
    if (!existsSync(sample))
      throw new AppError(
        "INSTALL_RESOURCE",
        "安装包缺少识别测试音频，请重新安装应用。",
      );
    const args = ["-m", model, "-f", sample, "-l", "en", "-t", "4"];
    if (!gpu) args.push("-ng");
    const result = await (this.config.execute ?? runProcess)(
      this.executableIn(directory),
      args,
      { signal, timeoutMs: 300_000 },
    );
    if (!/ask|country/i.test(result.stdout))
      throw new AppError(
        "INSTALL_SMOKE",
        "识别程序测试未通过，请重试或选择较小模型。",
      );
    if (gpu && !hasGpuExecution(result.stderr))
      throw new AppError("GPU_UNAVAILABLE", "GPU 未完成实际识别，已回退 CPU。");
  }

  async install(
    input: { modelId: ModelId; preferGpu: boolean },
    signal: AbortSignal,
  ): Promise<RuntimeStatus> {
    if (process.platform !== "win32" || process.arch !== "x64")
      throw new AppError(
        "PLATFORM_UNSUPPORTED",
        "本地识别只支持 Windows x64。",
      );
    if (this.isInstalling)
      throw new AppError("INSTALL_BUSY", "已有本地安装正在进行。");
    this.isInstalling = true;
    const staging = join(this.config.root, ".staging-" + randomUUID());
    const modelArtifact = (this.config.artifacts?.models ?? MODELS)[
      input.modelId
    ];
    const download = this.config.download ?? downloadArtifact;
    try {
      checkAbort(signal);
      await mkdir(staging, { recursive: true });
      const storage = await statfs(staging);
      const required =
        modelArtifact.sizeBytes +
        (input.preferGpu ? 2_500_000_000 : 100_000_000);
      if (storage.bavail * storage.bsize < required)
        throw new AppError(
          "INSTALL_SPACE",
          `可用磁盘空间不足，至少需要 ${Math.ceil(required / 1024 ** 3)} GB。`,
        );
      this.emit(0.01, "下载模型（大模型可能需要较长时间）…");
      const model = join(staging, `ggml-${input.modelId}.bin`);
      await download(modelArtifact, model, signal, (ratio) =>
        this.emit(0.01 + ratio * 0.44, "正在下载并校验模型…"),
      );
      await verifyArtifact(model, modelArtifact);
      this.emit(0.45, "下载 CPU 运行包…");
      const cpuArchive = join(staging, "cpu.zip");
      await download(
        this.config.artifacts?.cpu ?? CPU_ARTIFACT,
        cpuArchive,
        signal,
        (ratio) => this.emit(0.45 + ratio * 0.08, "正在下载 CPU 运行包…"),
      );
      await verifyArtifact(
        cpuArchive,
        this.config.artifacts?.cpu ?? CPU_ARTIFACT,
      );
      const cpu = join(staging, "cpu");
      await extractArchive(cpuArchive, cpu, signal);
      this.emit(0.55, "实际测试 CPU 识别…");
      await this.smoke(cpu, model, false, signal);
      let gpuReady = false;
      let gpuName: string | undefined;
      let message = "CPU 识别已通过实际测试。";
      if (input.preferGpu) {
        try {
          gpuName = (
            await (this.config.execute ?? runProcess)(
              "nvidia-smi",
              ["--query-gpu=name", "--format=csv,noheader"],
              { signal, timeoutMs: 5000 },
            )
          ).stdout
            .trim()
            .split("\n")[0];
          if (!gpuName)
            throw new AppError("GPU_UNAVAILABLE", "未检测到兼容 NVIDIA 显卡。");
          const archive = join(staging, "gpu.zip");
          this.emit(0.6, "下载 GPU 运行包（包含 CUDA 运行库）…");
          await download(
            this.config.artifacts?.gpu ?? GPU_ARTIFACT,
            archive,
            signal,
            (ratio) =>
              this.emit(0.6 + ratio * 0.3, "正在下载并校验 GPU 运行包…"),
          );
          await verifyArtifact(
            archive,
            this.config.artifacts?.gpu ?? GPU_ARTIFACT,
          );
          await extractArchive(archive, join(staging, "gpu"), signal);
          this.emit(0.91, "实际测试 GPU 识别…");
          await this.smoke(join(staging, "gpu"), model, true, signal);
          gpuReady = true;
          message = `${gpuName} 已通过实际 GPU 识别测试；首次启动可能较慢，速度因模型和设备而异，可手动选择 CPU。`;
        } catch (error) {
          checkAbort(signal);
          message = `GPU 安装或识别测试未通过，已使用 CPU。${error instanceof AppError ? error.message : "请检查驱动与网络后重试。"}`;
        }
      }
      checkAbort(signal);
      // Activate into a unique immutable directory. The previous state and files
      // stay usable until the final state-file rename succeeds.
      const activated = join(
        this.config.root,
        `engine-${ENGINE_VERSION}-${randomUUID()}`,
      );
      await rm(cpuArchive, { force: true });
      await rm(join(staging, "gpu.zip"), { force: true });
      await rename(staging, activated);
      const state: State = {
        version: 1,
        engineVersion: ENGINE_VERSION,
        cpuDirectory: join(activated, "cpu"),
        gpuDirectory: gpuReady ? join(activated, "gpu") : undefined,
        gpuReady,
        gpuName,
        message,
        models: {
          ...this.state?.models,
          [input.modelId]: {
            path: join(activated, `ggml-${input.modelId}.bin`),
            size: modelArtifact.sizeBytes,
          },
        },
      };
      const stateTemp = join(
        this.config.root,
        `.runtime-state-${randomUUID()}.json`,
      );
      await writeFile(stateTemp, JSON.stringify(state, null, 2), "utf8");
      await rename(stateTemp, join(this.config.root, "runtime-state.json"));
      this.state = state;
      this.emit(1, message);
      return this.status();
    } finally {
      this.isInstalling = false;
      await rm(staging, { recursive: true, force: true });
    }
  }
}
