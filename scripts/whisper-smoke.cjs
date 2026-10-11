const { readFileSync, existsSync, createReadStream } = require("node:fs");
const { mkdir, copyFile, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { createServer } = require("node:http");
const { performance } = require("node:perf_hooks");
const { spawnSync } = require("node:child_process");

async function main() {
  const cache = resolve(".runtime-cache/whisper");
  const useGpu = !process.argv.includes("--cpu");
  for (const filename of [
    "cpu.zip",
    "ggml-base.bin",
    ...(useGpu ? ["cuda.zip"] : []),
  ])
    if (!existsSync(join(cache, filename)))
      throw new Error(
        `Missing ${filename}. Run npm run setup:whisper-fixtures${useGpu ? " -- --gpu" : ""}; use npm run test:whisper -- --cpu for CPU-only validation.`,
      );
  const { build } = await import("vite");
  await build({
    configFile: false,
    build: {
      lib: {
        entry: resolve("src/main/services/runtime/index.ts"),
        formats: ["cjs"],
        fileName: () => "runtime.cjs",
      },
      outDir: ".runtime-cache/whisper-service",
      emptyOutDir: true,
      rollupOptions: { external: ["yauzl", /^node:/] },
    },
  });
  const { RuntimeService } = require(
    resolve(".runtime-cache/whisper-service/runtime.cjs"),
  );
  const sources = {
    "/cpu": join(cache, "cpu.zip"),
    "/gpu": join(cache, "cuda.zip"),
    "/base": join(cache, "ggml-base.bin"),
  };
  const server = createServer((request, response) => {
    const path = sources[request.url];
    if (!path) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader(
      "content-length",
      require("node:fs").statSync(path).size,
    );
    createReadStream(path).pipe(response);
  });
  await new Promise((resolveServer) =>
    server.listen(0, "127.0.0.1", resolveServer),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  const models = {
    base: {
      name: "Base",
      url: origin + "/base",
      sizeBytes: 147951465,
      sha256:
        "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    },
    small: { name: "Small", url: "", sizeBytes: 487601967, sha256: "" },
    "large-v3-turbo": {
      name: "Turbo",
      url: "",
      sizeBytes: 1624555275,
      sha256: "",
    },
  };
  let previous = -1;
  const runtime = new RuntimeService({
    root: join(cache, "managed-install"),
    resourceRoot: resolve("resources"),
    emit: ({ progress, message }) => {
      if (Math.floor(progress * 10) !== previous) {
        previous = Math.floor(progress * 10);
        console.log(message, Math.round(progress * 100) + "%");
      }
    },
    artifacts: {
      cpu: {
        url: origin + "/cpu",
        sizeBytes: 3968674,
        sha256:
          "d824b1e37599f882b396e73f1ee0bfd5d0529f700314c48311dcbd00b803321d",
      },
      gpu: {
        url: origin + "/gpu",
        sizeBytes: 459854042,
        sha256:
          "c12a563333d3c3707be70754dc0e87c1cb58aa6333a87055bbcf9b524488dfb0",
      },
      models,
    },
  });
  let status;
  try {
    status = await runtime.install(
      { modelId: "base", preferGpu: useGpu },
      new AbortController().signal,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolveServer) => server.close(resolveServer));
  }
  console.log("MANAGED INSTALL", status);
  if (
    !status.cpuReady ||
    (useGpu && !status.gpuReady) ||
    !status.installedModels.includes("base")
  )
    throw new Error("Real managed CPU+GPU installation failed");
  const runs = [];
  for (const preferGpu of useGpu
    ? [false, true, true, false]
    : [false, false]) {
    const executable = runtime.executable(preferGpu);
    const output = join(cache, `base-${executable.backend}-${runs.length}`);
    const args = [
      "-m",
      runtime.modelPath("base"),
      "-f",
      resolve("resources/runtime-smoke.wav"),
      "-l",
      "en",
      "-t",
      "4",
      "-oj",
      "-of",
      output,
    ];
    if (!preferGpu) args.push("-ng");
    const start = performance.now();
    const result = spawnSync(executable.path, args, {
      encoding: "utf8",
      timeout: 300_000,
      windowsHide: true,
    });
    const wallMs = performance.now() - start;
    await writeFile(output + ".log", result.stdout + result.stderr);
    if (result.status !== 0 || !/country/i.test(result.stdout))
      throw new Error("Inference failed: " + result.stderr);
    if (preferGpu && !/CUDA0 total size/.test(result.stderr))
      throw new Error("GPU inference did not use CUDA");
    const inferenceMs = Number(
      result.stderr.match(/total time\s*=\s*([\d.]+) ms/)?.[1],
    );
    const loadMs = Number(
      result.stderr.match(/load time\s*=\s*([\d.]+) ms/)?.[1],
    );
    const transcription = JSON.parse(
      readFileSync(output + ".json", "utf8"),
    ).transcription;
    if (!Array.isArray(transcription) || !transcription.length)
      throw new Error("No timed transcription output");
    runs.push({
      backend: executable.backend,
      wallMs,
      inferenceMs,
      loadMs,
      output,
    });
    console.log(runs.at(-1));
  }
  const report = {
    status,
    sample: "Official whisper.cpp JFK (11 seconds)",
    providerCalls: 0,
    note: `Production installer executed with pinned artifacts replayed by local HTTP cache; real ${useGpu ? "CPU/CUDA" : "CPU-only"} processes and model inference.`,
    runs,
  };
  await writeFile(
    join(cache, useGpu ? "base-validation.json" : "base-validation-cpu.json"),
    JSON.stringify(report, null, 2),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
