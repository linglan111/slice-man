import { describe, expect, it } from "vitest";
import {
  archiveDestination,
  hasGpuExecution,
} from "../../../src/main/services/runtime/artifacts";
import { resolve } from "node:path";
import { parseTestArtifacts } from "../../../src/main/services/runtime/test-artifacts";

describe("runtime boundaries", () => {
  const fixture = {
    url: "http://127.0.0.1:32100/model",
    sha256: "a".repeat(64),
    sizeBytes: 100,
  };
  const manifest = {
    cpu: fixture,
    gpu: fixture,
    models: {
      base: { ...fixture, name: "Base" },
      small: { ...fixture, name: "Small" },
      "large-v3-turbo": { ...fixture, name: "Turbo" },
    },
  };
  it("permits complete strict isolated loopback test manifests", () => {
    expect(parseTestArtifacts(manifest)).toEqual(manifest);
  });
  it.each([
    "https://example.com/model",
    "http://127.0.0.1.evil.example/model",
    "http://user:secret@localhost/model",
  ])("rejects non-loopback/credential test URL %s", (url) => {
    expect(() =>
      parseTestArtifacts({ ...manifest, cpu: { ...fixture, url } }),
    ).toThrow();
  });
  it("accepts a bounded runtime archive path", () => {
    expect(archiveDestination("runtime", "Release/whisper-cli.exe")).toBe(
      resolve("runtime/Release/whisper-cli.exe"),
    );
  });
  it.each([
    "../outside",
    "/outside",
    "C:/outside",
    "Release/../../outside",
    "Release\\..\\outside",
    "Release/whisper-cli.exe:alternate-stream",
    "",
  ])("rejects archive path %s", (name) => {
    expect(() => archiveDestination("runtime", name)).toThrow();
  });
  it("requires actual CUDA model/buffer use, not only device discovery", () => {
    expect(hasGpuExecution("found 1 CUDA devices: RTX 5070")).toBe(false);
    expect(
      hasGpuExecution("whisper_model_load: CUDA0 total size = 147 MB"),
    ).toBe(true);
    expect(
      hasGpuExecution("CUDA0 total size = 147 MB\nCUDA error: no kernel image"),
    ).toBe(false);
  });
});
