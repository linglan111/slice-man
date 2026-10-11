import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolvePackageAppDirectory } = require(
  "../../../scripts/package-smoke-path.cjs",
) as {
  resolvePackageAppDirectory: (args: string[], workspace: string) => string;
};
const fixtures: string[] = [];

function createWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "slice-man-package-path-"));
  fixtures.push(workspace);
  mkdirSync(join(workspace, "dist"));
  return workspace;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    const insideTemp = relative(resolve(tmpdir()), resolve(fixture));
    if (
      !insideTemp ||
      insideTemp.startsWith("..") ||
      isAbsolute(insideTemp) ||
      !insideTemp.startsWith("slice-man-package-path-")
    )
      throw new Error("Unsafe package-path fixture cleanup");
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe("packaged smoke application selection", () => {
  it("preserves the default portable directory", () => {
    const workspace = createWorkspace();
    expect(resolvePackageAppDirectory([], workspace)).toBe(
      join(workspace, "dist", "win-unpacked"),
    );
  });

  it("accepts relative and absolute isolated release directories", () => {
    const workspace = createWorkspace();
    const appDirectory = join(workspace, "dist", "release-0.1.3", "win-unpacked");
    for (const input of ["dist/release-0.1.3/win-unpacked", appDirectory])
      expect(resolvePackageAppDirectory(["--app-dir", input], workspace)).toBe(
        appDirectory,
      );
  });

  it("rejects escaping paths, sibling prefixes and the dist root", () => {
    const workspace = createWorkspace();
    for (const input of [
      "dist/../../outside",
      "dist-sibling/win-unpacked",
      "dist",
    ])
      expect(() =>
        resolvePackageAppDirectory(["--app-dir", input], workspace),
      ).toThrow("inside workspace/dist");
  });

  it("rejects missing values, duplicate flags and unknown arguments", () => {
    const workspace = createWorkspace();
    for (const args of [
      ["--app-dir"],
      ["--app-dir", ""],
      ["--unknown", "dist/win-unpacked"],
      ["--app-dir", "dist/win-unpacked", "--app-dir", "dist/other"],
    ])
      expect(() => resolvePackageAppDirectory(args, workspace)).toThrow("Usage");
  });

  it("rejects a junction escaping the selected dist directory", () => {
    const workspace = createWorkspace();
    const outside = join(workspace, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(workspace, "dist", "linked"), "junction");
    expect(() =>
      resolvePackageAppDirectory(["--app-dir", "dist/linked/app"], workspace),
    ).toThrow("ordinary directories");
  });
});
