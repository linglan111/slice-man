import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipFile } from "yazl";
import type { Artifact } from "../../../src/main/services/runtime/manifest";
import { MODELS } from "../../../src/main/services/runtime/manifest";
import {
  downloadArtifact,
  verifyArtifact,
} from "../../../src/main/services/runtime/artifacts";
import { RuntimeService } from "../../../src/main/services/runtime";
import { AppError } from "../../../src/main/lib/errors";
import type { runProcess } from "../../../src/main/lib/process";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(): Promise<{
  root: string;
  resources: string;
  archive: Buffer;
  model: Buffer;
  cpu: Artifact;
  modelArtifact: Artifact;
}> {
  const root = await mkdtemp(join(tmpdir(), "slice-runtime-"));
  roots.push(root);
  const resources = join(root, "resources");
  await mkdir(resources);
  await writeFile(join(resources, "runtime-smoke.wav"), "fixture");
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from("fixture executable"), "Release/whisper-cli.exe");
  const chunks: Buffer[] = [];
  zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve) =>
    zip.outputStream.on("end", () => resolve()),
  );
  zip.end();
  await done;
  const archive = Buffer.concat(chunks);
  const model = Buffer.from("fixture model");
  const server = createServer((request, response) => {
    const content = request.url === "/cpu" ? archive : model;
    response.setHeader("content-length", content.length);
    response.end(content);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture address unavailable");
  const origin = `http://127.0.0.1:${address.port}`;
  const make = (path: string, content: Buffer): Artifact => ({
    url: origin + path,
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.length,
  });
  return {
    root,
    resources,
    archive,
    model,
    cpu: make("/cpu", archive),
    modelArtifact: make("/model", model),
  };
}
describe("runtime installation", () => {
  it("retries transient HTTP failures and validates the eventual complete body", async () => {
    const f = await fixture();
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      if (requests < 3) {
        response.writeHead(503);
        response.end();
      } else response.end(f.model);
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Address unavailable");
    const path = join(f.root, "retry-model");
    await downloadArtifact(
      { ...f.modelArtifact, url: `http://127.0.0.1:${address.port}` },
      path,
      new AbortController().signal,
      (): void => {},
    );
    expect(requests).toBe(3);
    expect(await readFile(path)).toEqual(f.model);
  });
  it("cancels an active streamed download and removes its partial file", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-length": 100000 });
      response.write(Buffer.alloc(1000));
      controller.abort();
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Address unavailable");
    const path = join(f.root, "cancel-model");
    await expect(
      downloadArtifact(
        {
          ...f.modelArtifact,
          sizeBytes: 100000,
          url: `http://127.0.0.1:${address.port}`,
        },
        path,
        controller.signal,
        (): void => {},
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("downloads, verifies, smoke-tests, activates and reloads; GPU failure retains CPU", async () => {
    const f = await fixture();
    let cpuRuns = 0;
    const execute: typeof runProcess = async (
      executable,
    ): Promise<{ stdout: string; stderr: string }> => {
      if (executable === "nvidia-smi")
        return { stdout: "Test NVIDIA", stderr: "" };
      if (executable.includes("gpu"))
        throw new AppError("GPU_UNAVAILABLE", "Fixture GPU failure");
      cpuRuns++;
      return { stdout: "ask what your country can do", stderr: "CPU" };
    };
    const config = {
      root: join(f.root, "managed"),
      resourceRoot: f.resources,
      emit: (): void => {},
      execute,
      artifacts: {
        cpu: f.cpu,
        gpu: f.cpu,
        models: { ...MODELS, base: { ...f.modelArtifact, name: "Test base" } },
      },
    };
    const runtime = new RuntimeService(config);
    expect((await runtime.status()).installed).toBe(false);
    const status = await runtime.install(
      { modelId: "base", preferGpu: true },
      new AbortController().signal,
    );
    expect(status.installedModels).toEqual(["base"]);
    expect(status.cpuReady).toBe(true);
    expect(status.gpuReady).toBe(false);
    expect(cpuRuns).toBe(1);
    const restored = new RuntimeService(config);
    expect(restored.executable(true).backend).toBe("cpu");
    expect(await readFile(restored.modelPath("base"), "utf8")).toBe(
      "fixture model",
    );
  });
  it("failed model verification never activates or changes an installed state", async () => {
    const f = await fixture();
    const config = {
      root: join(f.root, "managed"),
      resourceRoot: f.resources,
      emit: (): void => {},
      execute: async (): Promise<{ stdout: string; stderr: string }> => ({
        stdout: "ask country",
        stderr: "",
      }),
      artifacts: {
        cpu: f.cpu,
        gpu: f.cpu,
        models: { ...MODELS, base: { ...f.modelArtifact, name: "Test" } },
      },
    };
    const runtime = new RuntimeService(config);
    await runtime.install(
      { modelId: "base", preferGpu: false },
      new AbortController().signal,
    );
    const before = await readFile(
      join(config.root, "runtime-state.json"),
      "utf8",
    );
    config.artifacts.models.base.sha256 = "0".repeat(64);
    await expect(
      runtime.install(
        { modelId: "base", preferGpu: false },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTALL_INTEGRITY" });
    expect(
      await readFile(join(config.root, "runtime-state.json"), "utf8"),
    ).toBe(before);
    expect(runtime.executable(false).backend).toBe("cpu");
  });
  it("rejects incomplete artifact data and honours cancellation before download", async () => {
    const f = await fixture();
    const path = join(f.root, "model");
    await writeFile(path, "bad");
    await expect(verifyArtifact(path, f.modelArtifact)).rejects.toMatchObject({
      code: "INSTALL_INTEGRITY",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadArtifact(
        f.modelArtifact,
        path,
        controller.signal,
        (): void => {},
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
