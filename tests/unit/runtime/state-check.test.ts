import { afterEach, describe, expect, it, vi } from "vitest";
import type * as FileSystem from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({ diskBytes: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  statfs: async () => ({ bavail: mocks.diskBytes, bsize: 1 }),
}));
import { RuntimeService } from "../../../src/main/services/runtime";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "slice-state-check-"));
  roots.push(root);
  return root;
}
describe("runtime disk and state protection", () => {
  it("rejects insufficient disk before initiating any download or changing persisted state", async () => {
    const root = await fixture();
    const previous = "invalid prior state retained for diagnosis";
    await writeFile(join(root, "runtime-state.json"), previous);
    const download = vi.fn();
    const service = new RuntimeService({
      root,
      resourceRoot: root,
      emit: () => {},
      download,
    });
    await expect(
      service.install(
        { modelId: "base", preferGpu: false },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTALL_SPACE" });
    expect(download).not.toHaveBeenCalled();
    expect(await readFile(join(root, "runtime-state.json"), "utf8")).toBe(
      previous,
    );
    // The failed install releases its busy guard and remains retryable.
    await expect(
      service.install(
        { modelId: "base", preferGpu: false },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INSTALL_SPACE" });
  });
  it("does not execute a persisted runtime path outside the managed directory", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "runtime-state.json"),
      JSON.stringify({
        version: 1,
        engineVersion: "1.8.3",
        cpuDirectory: join(root, "..", "outside"),
        gpuReady: false,
        message: "claimed ready",
        models: {},
      }),
    );
    const service = new RuntimeService({
      root,
      resourceRoot: root,
      emit: () => {},
      execute: async () => ({ stdout: "", stderr: "" }),
    });
    expect(() => service.executable(false)).toThrow();
    expect((await service.status()).actualBackend).toBe("unavailable");
  });
});
