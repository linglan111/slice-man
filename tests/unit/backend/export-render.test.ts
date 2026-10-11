import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { runProcess } from "../../../src/main/lib/process";
import { AppError } from "../../../src/main/lib/errors";
import { MediaService } from "../../../src/main/services/media/lib/media-service";
import type { MediaInfo } from "../../../src/shared/contracts";
const mocks = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock("../../../src/main/lib/process", () => ({ runProcess: mocks.process }));
const roots: string[] = [];
const info: MediaInfo = {
  durationMs: 1000,
  width: 640,
  height: 480,
  hasAudio: false,
  audioOffsetMs: 0,
  rotation: 0,
  sampleAspectRatio: "1:1",
};
const raw = {
  streams: [
    { codec_type: "video", codec_name: "h264", width: 640, height: 480 },
  ],
  format: { duration: "1.0", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
};
beforeEach(() => vi.resetAllMocks());
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(
  output: unknown = raw,
): Promise<{
  root: string;
  input: string;
  destination: string;
  media: MediaService;
  work: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "slice-render-contract-"));
  roots.push(root);
  const fonts = join(root, "fonts");
  await mkdir(fonts);
  for (const name of ["NotoSansCJKsc-Regular.otf", "NotoSansCJKsc-Bold.otf"])
    await writeFile(join(fonts, name), "anonymous font fixture");
  const input = join(root, "input.mp4");
  await writeFile(input, "source fixture");
  mocks.process.mockImplementation(
    async (
      executable: string,
      args: string[],
      options?: Parameters<typeof runProcess>[2],
    ) => {
      if (executable === "fixture-probe")
        return {
          stdout: JSON.stringify(args.at(-1) === input ? raw : output),
          stderr: "",
        };
      if (args.includes("-encoders"))
        return {
          stdout: " V..... libx264 software\n V..... libx265 software\n",
          stderr: "",
        };
      if (args.includes("-vf")) {
        const destination = args.at(-1);
        if (!destination) throw new Error("Missing output");
        await writeFile(destination, "synthetic encoded output");
        options?.onStderr?.("out_time_us=400000\n");
        if (options?.signal?.aborted)
          throw new AppError("CANCELLED", "Cancelled fixture");
        return { stdout: "", stderr: "" };
      }
      return { stdout: "frame=1\n", stderr: "" };
    },
  );
  return {
    root,
    input,
    destination: join(root, "out.mp4"),
    work: join(root, "work"),
    media: new MediaService({
      ffmpeg: "fixture-ffmpeg",
      ffprobe: "fixture-probe",
      fonts,
    }),
  };
}
describe("video export validation boundaries", () => {
  it.each([
    { ...raw, streams: [{ ...raw.streams[0], codec_name: "vp9" }] },
    { ...raw, streams: [{ ...raw.streams[0], height: 360 }] },
    {
      ...raw,
      streams: [...raw.streams, { codec_type: "audio", codec_name: "opus" }],
    },
    { ...raw, format: { ...raw.format, format_name: "matroska,webm" } },
    { ...raw, format: { ...raw.format, duration: "0.1" } },
  ])(
    "rejects a successful process with wrong actual output and leaves no published or staging video",
    async (output) => {
      const f = await fixture(output);
      await expect(
        f.media.render(
          f.input,
          f.work,
          "fixture ASS",
          info,
          f.destination,
          "balanced",
        ),
      ).rejects.toMatchObject({ code: "OUTPUT_VALIDATION" });
      expect(await readdir(f.root)).not.toContain("out.mp4");
      expect(
        (await readdir(f.root)).some((name) => name.startsWith(".slice-")),
      ).toBe(false);
    },
  );
  it("requires the selected software encoder instead of a hardware-only or hidden codec fallback", async () => {
    const f = await fixture();
    mocks.process.mockResolvedValueOnce({
      stdout: " V..... hevc_nvenc hardware\n",
      stderr: "",
    });
    await expect(
      f.media.render(
        f.input,
        f.work,
        "ASS",
        info,
        f.destination,
        "balanced",
        undefined,
        undefined,
        undefined,
        { videoCodec: "h265" },
      ),
    ).rejects.toMatchObject({ code: "EXPORT_ENCODER_UNAVAILABLE" });
    expect(mocks.process).toHaveBeenCalledTimes(1);
  });
  it("requires a decoded output frame before publication", async () => {
    const f = await fixture();
    const normal = mocks.process.getMockImplementation();
    mocks.process.mockImplementation(
      async (
        executable: string,
        args: string[],
        options?: Parameters<typeof runProcess>[2],
      ) =>
        args.includes("-frames:v")
          ? { stdout: "frame=0\n", stderr: "" }
          : normal?.(executable, args, options),
    );
    await expect(
      f.media.render(f.input, f.work, "ASS", info, f.destination, "balanced"),
    ).rejects.toMatchObject({ code: "OUTPUT_VALIDATION" });
    expect(await readdir(f.root)).not.toContain("out.mp4");
  });
  it("checks cancellation after final probe/decode before publication", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const normal = mocks.process.getMockImplementation();
    mocks.process.mockImplementation(
      async (
        executable: string,
        args: string[],
        options?: Parameters<typeof runProcess>[2],
      ) => {
        const result = await normal?.(executable, args, options);
        if (args.includes("-frames:v")) controller.abort();
        return result;
      },
    );
    await expect(
      f.media.render(
        f.input,
        f.work,
        "ASS",
        info,
        f.destination,
        "balanced",
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await readdir(f.root)).not.toContain("out.mp4");
  });
  it("contains thrown progress callbacks, stops encoding and cleans owned artifacts", async () => {
    const f = await fixture();
    await expect(
      f.media.render(
        f.input,
        f.work,
        "ASS",
        info,
        f.destination,
        "balanced",
        undefined,
        undefined,
        () => {
          throw new Error("fixture callback failure");
        },
      ),
    ).rejects.toMatchObject({ code: "EXPORT_PROGRESS" });
    expect(await readdir(f.root)).not.toContain("out.mp4");
    expect(
      (await readdir(f.work)).some((name) => name.startsWith("sub-")),
    ).toBe(false);
  });
  it("keeps legacy reference rendering separate from video codec/resolution preferences", async () => {
    const f = await fixture();
    const image = join(f.root, "reference.png");
    await f.media.render(
      f.input,
      f.work,
      "ASS",
      info,
      image,
      "balanced",
      undefined,
      400,
      undefined,
      { videoCodec: "original", resolution: "360p" },
    );
    expect(mocks.process).toHaveBeenCalledTimes(1);
    const args = mocks.process.mock.calls[0]?.[1] as string[];
    expect(args[args.indexOf("-vf") + 1]).toContain("scale=640:480");
    expect(args).not.toContain("-c:v");
    expect(await readdir(f.root)).toContain("reference.png");
  });
});
