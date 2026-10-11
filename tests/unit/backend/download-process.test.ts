import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  downloadFailure,
  runDownloadProcess,
} from "../../../src/main/services/download/lib/download-process";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(
  script: string,
): Promise<{ root: string; script: string }> {
  const root = await mkdtemp(join(tmpdir(), "slice-child-"));
  roots.push(root);
  const path = join(root, "child.cjs");
  await writeFile(path, script);
  return { root, script: path };
}
describe("bounded native download output", () => {
  it("decodes split Unicode paths/progress and preserves literal argv", async () => {
    const f = await fixture(
      `const buffer=Buffer.from('SLICE_FILE:字幕 文件.mp4\\nSLICE_PROGRESS:75.0%\\n'); process.stdout.write(buffer.subarray(0,13)); setTimeout(()=>process.stdout.write(buffer.subarray(13)),10);`,
    );
    const lines: string[] = [];
    await runDownloadProcess(process.execPath, [f.script], {
      cwd: f.root,
      signal: new AbortController().signal,
      onLine: (line) => lines.push(line),
    });
    expect(lines).toEqual(["SLICE_FILE:字幕 文件.mp4", "SLICE_PROGRESS:75.0%"]);
  });
  it("returns sanitized website failure and never includes secret stderr text", async () => {
    const f = await fixture(
      `process.stderr.write('HTTP 403 https://user:secret@example.org/?token=private'); process.exitCode=1;`,
    );
    try {
      await runDownloadProcess(process.execPath, [f.script], {
        cwd: f.root,
        signal: new AbortController().signal,
        onLine: () => {},
      });
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "DOWNLOAD_BLOCKED" });
      expect(String(error)).not.toMatch(/secret|private|example\.org/);
    }
  });
  it("kills the owned process on cancellation and releases its output handles", async () => {
    const f = await fixture(
      `console.log('started'); setInterval(()=>{},1000);`,
    );
    const controller = new AbortController();
    const promise = runDownloadProcess(process.execPath, [f.script], {
      cwd: f.root,
      signal: controller.signal,
      onLine: () => controller.abort(),
    });
    await expect(promise).rejects.toMatchObject({ code: "CANCELLED" });
  });
  it("handles throwing progress callbacks without crashing the parent", async () => {
    const f = await fixture(
      `console.log('started'); setInterval(()=>{},1000);`,
    );
    await expect(
      runDownloadProcess(process.execPath, [f.script], {
        cwd: f.root,
        signal: new AbortController().signal,
        onLine: () => {
          throw new Error("parser");
        },
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_OUTPUT" });
  });
  it.each([
    ["Please sign in", "DOWNLOAD_AUTH"],
    ["HTTP429", "DOWNLOAD_RATE_LIMIT"],
    ["Unsupported URL", "DOWNLOAD_UNSUPPORTED"],
    ["network problem", "DOWNLOAD_FAILED"],
  ])("classifies %s", (text, code) => {
    expect(downloadFailure(text).code).toBe(code);
  });
});
