import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "../../../src/main/lib/errors";
import {
  normalizeDownload,
  type NormalizeDownloadInput,
} from "../../../src/main/services/download/lib/download-media";

const mocks = vi.hoisted(() => ({ process: vi.fn(), convert: vi.fn() }));
vi.mock("../../../src/main/lib/process", () => ({ runProcess: mocks.process }));
vi.mock("../../../src/main/services/download/lib/download-process", () => ({
  runDownloadProcess: mocks.convert,
}));
const roots: string[] = [];
const source = {
  streams: [
    { codec_type: "video", codec_name: "vp9", width: 640, height: 360 },
    { codec_type: "audio", codec_name: "opus" },
  ],
  format: { format_name: "matroska,webm", duration: "1.0" },
};
const output = {
  streams: [
    { codec_type: "video", codec_name: "h264", width: 640, height: 360 },
    { codec_type: "audio", codec_name: "aac" },
  ],
  format: {
    format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    duration: "1.0",
    tags: { major_brand: "isom" },
  },
};
beforeEach(() => vi.resetAllMocks());
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(
  result: unknown = output,
): Promise<NormalizeDownloadInput> {
  const root = await mkdtemp(join(tmpdir(), "slice-media-contract-"));
  roots.push(root);
  const input = join(root, "anonymous.webm");
  await writeFile(input, "source preserved");
  mocks.process.mockImplementation(
    async (executable: string, args: string[]) => ({
      stdout:
        executable === "fixture-probe"
          ? JSON.stringify(args.at(-1) === input ? source : result)
          : args.includes("-encoders")
            ? " V..... libx264 software\n V..... libx265 software\n"
            : "frame=1\n",
      stderr: "",
    }),
  );
  mocks.convert.mockImplementation(
    async (
      _executable: string,
      args: string[],
      options: { onLine: (line: string) => void },
    ) => {
      const destination = args.at(-1);
      if (!destination) throw new Error("Output missing");
      await writeFile(destination, "converted fixture");
      options.onLine("out_time_us=500000");
    },
  );
  return {
    input,
    workingDirectory: join(root, "stage"),
    container: "mp4",
    videoCodec: "h264",
    maxHeight: 1080,
    signal: new AbortController().signal,
    ffmpeg: "fixture-ffmpeg",
    ffprobe: "fixture-probe",
    onProgress: () => {},
  };
}
describe("download media semantic validation", () => {
  it.each([
    {
      ...output,
      streams: [
        { codec_type: "video", codec_name: "vp9", width: 640, height: 360 },
        output.streams[1],
      ],
    },
    {
      ...output,
      streams: [
        { codec_type: "video", codec_name: "h264", width: 640, height: 720 },
        output.streams[1],
      ],
    },
    { ...output, streams: [output.streams[0]] },
    {
      ...output,
      streams: [output.streams[0], { codec_type: "audio", codec_name: "opus" }],
    },
    { ...output, format: { ...output.format, duration: "5.0" } },
    { ...output, format: { ...output.format, duration: "0.1" } },
    { ...output, format: { ...output.format, format_name: "matroska,webm" } },
    { ...output, format: { ...output.format, tags: { major_brand: "qt  " } } },
  ])(
    "rejects a native exit-success whose actual output does not meet requested media properties",
    async (badOutput) => {
      const input = await fixture(badOutput);
      await expect(normalizeDownload(input)).rejects.toMatchObject({
        code: "DOWNLOAD_CONVERSION_VALIDATION",
      });
      expect(await readdir(input.workingDirectory)).toEqual([]);
      expect(await readFile(input.input, "utf8")).toBe("source preserved");
    },
  );
  it("requires the requested software encoder before conversion and never falls back to another codec", async () => {
    const input = await fixture();
    const normal = mocks.process.getMockImplementation();
    mocks.process.mockImplementation(
      async (executable: string, args: string[]) =>
        args.includes("-encoders")
          ? { stdout: " V..... h264_nvenc hardware\n", stderr: "" }
          : normal?.(executable, args),
    );
    await expect(normalizeDownload(input)).rejects.toMatchObject({
      code: "DOWNLOAD_ENCODER_UNAVAILABLE",
    });
    expect(mocks.convert).not.toHaveBeenCalled();
  });
  it("rejects fake successful probes without a decoded video frame", async () => {
    const input = await fixture();
    const normal = mocks.process.getMockImplementation();
    mocks.process.mockImplementation(
      async (executable: string, args: string[]) =>
        args.includes("-frames:v")
          ? { stdout: "frame=0\n", stderr: "" }
          : normal?.(executable, args),
    );
    await expect(normalizeDownload(input)).rejects.toMatchObject({
      code: "DOWNLOAD_MEDIA_INVALID",
    });
    expect(mocks.convert).not.toHaveBeenCalled();
  });
  it("cleans its output when cancellation arrives after final media validation", async () => {
    const input = await fixture();
    const controller = new AbortController();
    await expect(
      normalizeDownload({
        ...input,
        signal: controller.signal,
        onProgress: (value) => {
          if (value === 1) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await readdir(input.workingDirectory)).toEqual([]);
    expect(await readFile(input.input, "utf8")).toBe("source preserved");
  });
  it("checks cancellation before returning the unchanged original path", async () => {
    const input = await fixture();
    const controller = new AbortController();
    await expect(
      normalizeDownload({
        ...input,
        container: "original",
        videoCodec: "original",
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(mocks.convert).not.toHaveBeenCalled();
    expect(await readFile(input.input, "utf8")).toBe("source preserved");
  });
  it("bounds monotonic conversion progress despite partial/oversized native time values", async () => {
    const input = await fixture();
    const values: number[] = [];
    mocks.convert.mockImplementation(
      async (
        _executable: string,
        args: string[],
        options: { onLine: (line: string) => void },
      ) => {
        const destination = args.at(-1);
        if (!destination) throw new Error("Missing output");
        await writeFile(destination, "converted fixture");
        for (const line of [
          "out_time_us=",
          "private stderr",
          "out_time_us=800000",
          "out_time_us=100000",
          "out_time_us=99999999999999999999999",
        ])
          options.onLine(line);
      },
    );
    await normalizeDownload({
      ...input,
      onProgress: (value) => values.push(value),
    });
    expect(values).toEqual([0, 0.8, 0.8, 0.99, 1]);
  });
  it("handles callback failures inside the asynchronous conversion boundary and removes its own stage", async () => {
    const input = await fixture();
    // The real process helper catches thrown callbacks; emulate its safe rejection.
    mocks.convert.mockImplementation(
      async (_executable: string, args: string[]) => {
        const destination = args.at(-1);
        if (!destination) throw new Error("Missing output");
        await writeFile(destination, "partial fixture");
        throw new AppError("DOWNLOAD_OUTPUT", "sanitized callback failure");
      },
    );
    await expect(normalizeDownload(input)).rejects.toMatchObject({
      code: "DOWNLOAD_CONVERSION_FAILED",
    });
    expect(await readdir(input.workingDirectory)).toEqual([]);
    expect(await readFile(input.input, "utf8")).toBe("source preserved");
  });
  it.each([0, -1, 0.5, NaN, Infinity, 2161])(
    "rejects invalid maximum height %s before native work",
    async (maxHeight) => {
      const input = await fixture();
      await expect(
        normalizeDownload({ ...input, maxHeight }),
      ).rejects.toMatchObject({ code: "DOWNLOAD_MEDIA_OPTIONS" });
      expect(mocks.process).not.toHaveBeenCalled();
    },
  );
});
