import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as files from "node:fs/promises";
vi.mock("node:fs/promises", { spy: true });
import { Store } from "../../../src/main/db/store";
import { MediaService } from "../../../src/main/services/media/lib/media-service";
import { JobService } from "../../../src/main/services/jobs/lib/job-service";
const fixtures: { root: string; store: Store }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
describe("import cancellation commit boundary", () => {
  it("cancels after identity write before store commit and removes only the new workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "slice-import-commit-"));
    const store = new Store(join(root, "app.db"), {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => "",
    });
    fixtures.push({ root, store });
    const path = join(root, "source.mp4");
    await writeFile(path, "original source bytes");
    const priorWorkspace = join(root, "jobs", "previous-existing-workspace");
    await files.mkdir(priorWorkspace, { recursive: true });
    await writeFile(
      join(priorWorkspace, "retained.txt"),
      "previous workspace bytes",
    );
    const media = new MediaService({
      ffmpeg: "unused",
      ffprobe: "unused",
      fonts: "unused",
    });
    vi.spyOn(media, "probe").mockResolvedValue({
      width: 320,
      height: 240,
      durationMs: 1000,
      hasAudio: false,
      audioOffsetMs: 0,
      rotation: 0,
      sampleAspectRatio: "1:1",
    });
    const controller = new AbortController();
    const realWrite = (await vi.importActual<typeof files>("node:fs/promises"))
      .writeFile;
    let identityWritten = false;
    vi.spyOn(files, "writeFile").mockImplementationOnce(async (...args) => {
      expect(String(args[0])).toMatch(/input-identity\.json$/);
      await realWrite(...args);
      identityWritten = true;
      controller.abort();
    });
    const commit = vi.spyOn(store, "saveJob");
    const jobs = new JobService(
      store,
      media,
      {
        executable: () => ({ path: "unused", backend: "cpu" }),
        modelPath: () => "unused",
      },
      root,
      () => {},
      (p) => p,
    );
    await expect(
      jobs.importVideo(path, controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(identityWritten).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    expect(store.listJobs()).toEqual([]);
    expect(await readdir(join(root, "jobs"))).toEqual([
      "previous-existing-workspace",
    ]);
    expect(
      await files.readFile(join(priorWorkspace, "retained.txt"), "utf8"),
    ).toBe("previous workspace bytes");
    expect(await files.readFile(path, "utf8")).toBe("original source bytes");
  });
  it("observes cancellation after probe and never persists a job", async () => {
    const root = await mkdtemp(join(tmpdir(), "slice-import-"));
    const store = new Store(join(root, "app.db"), {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => "",
    });
    fixtures.push({ root, store });
    const path = join(root, "source.mp4");
    await writeFile(path, "video");
    const media = new MediaService({
      ffmpeg: "unused",
      ffprobe: "unused",
      fonts: "unused",
    });
    const controller = new AbortController();
    vi.spyOn(media, "probe").mockImplementation(async (_path, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return {
        width: 320,
        height: 240,
        durationMs: 1000,
        hasAudio: false,
        audioOffsetMs: 0,
        rotation: 0,
        sampleAspectRatio: "1:1",
      };
    });
    const jobs = new JobService(
      store,
      media,
      {
        executable: () => ({ path: "unused", backend: "cpu" }),
        modelPath: () => "unused",
      },
      root,
      () => {},
      (p) => p,
    );
    await expect(
      jobs.importVideo(path, controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(store.listJobs()).toEqual([]);
    expect(await readdir(root)).not.toContain("jobs");
  });
});
