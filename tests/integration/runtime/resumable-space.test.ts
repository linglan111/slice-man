import { afterEach, describe, expect, it, vi } from "vitest";
import * as files from "node:fs/promises";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("node:fs/promises", { spy: true });
import { RuntimeService } from "../../../src/main/services/runtime";
import { ArtifactCache, artifactCacheKey } from "../../../src/main/services/runtime/artifact-cache";
import { MODELS } from "../../../src/main/services/runtime/manifest";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
describe("durable cache plus install staging disk budget", () => {
  it("counts remaining cache bytes AND the independent staging copy before starting acquisition", async () => {
    const root = await mkdtemp(join(tmpdir(), "slice-resume-space-")); roots.push(root);
    const model = Buffer.from("test"); const artifact = { url: "http://127.0.0.1:9/model", sizeBytes: 4, sha256: createHash("sha256").update(model).digest("hex") };
    const cpu = { ...artifact, url: "http://127.0.0.1:9/cpu", sizeBytes: 40 };
    const asset = { id: "model-base" as const, name: "Base", artifact };
    const cache = new ArtifactCache(root, "runtime"); await mkdir(cache.directory, { recursive: true });
    const key = artifactCacheKey(asset);
    await writeFile(join(cache.directory, `${key}.part`), model.subarray(0, 2));
    await writeFile(join(cache.directory, `${key}.json`), JSON.stringify({ version: 1, id: asset.id, name: asset.name, ...artifact, phase: "partial" }));
    // required=2*(4+40)-2+100,000,000=100,000,086; old
    // non-durable accounting incorrectly permits this insufficient space.
    vi.spyOn(files, "statfs").mockResolvedValue({ type: 0n, bsize: 1n, blocks: 200000000n, bfree: 100000085n, bavail: 100000085n, files: 1000n, ffree: 1000n });
    const acquire = vi.fn(); const fetchSpy = vi.spyOn(globalThis, "fetch");
    const runtime = new RuntimeService({ root, resourceRoot: root, emit: vi.fn(), download: acquire, artifacts: { cpu, gpu: cpu, models: { ...MODELS, base: { ...artifact, name: "Base" } } } });
    await expect(runtime.install({ modelId: "base", preferGpu: false }, new AbortController().signal)).rejects.toMatchObject({ code: "INSTALL_SPACE" });
    expect(acquire).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
    expect((await runtime.status()).downloadCache?.totalBytes).toBe(2);
    expect(await readFile(join(cache.directory, `${key}.part`))).toEqual(model.subarray(0, 2));
    expect((await files.readdir(root)).some((name) => name.startsWith(".staging-"))).toBe(false);
  });
});
