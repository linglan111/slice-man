const { spawnSync } = require("node:child_process");
const { resolve, join, relative, isAbsolute } = require("node:path");
const { mkdir, copyFile, writeFile, stat } = require("node:fs/promises");

async function installedMediaSmoke(resourceRoot, outputRoot, workspace) {
  const scratch = resolve(workspace, ".native-smoke");
  const output = resolve(outputRoot);
  const offset = relative(scratch, output);
  if (!offset || offset.startsWith("..") || isAbsolute(offset))
    throw new Error(
      "Installed media probe must use its workspace scratch child",
    );
  await mkdir(join(output, "fonts"), { recursive: true });
  for (const file of ["NotoSansCJKsc-Regular.otf", "NotoSansCJKsc-Bold.otf"])
    await copyFile(
      join(resourceRoot, "fonts", file),
      join(output, "fonts", file),
    );
  const ffmpeg = resolve(resourceRoot, "media/ffmpeg.exe");
  const ffprobe = resolve(resourceRoot, "media/ffprobe.exe");
  function run(executable, args, binary = false) {
    const result = spawnSync(executable, args, {
      cwd: output,
      windowsHide: true,
      shell: false,
      timeout: 60_000,
      maxBuffer: 10_000_000,
      encoding: binary ? undefined : "utf8",
    });
    if (result.error || result.status !== 0)
      throw new Error(
        `Installed media process failed: ${result.error || result.stderr}`,
      );
    return result;
  }
  const version = run(ffmpeg, ["-version"]).stdout.split("\n")[0].trim();
  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 360
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Regular,Noto Sans CJK SC,32,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,65,1
Style: Bold,Noto Sans CJK SC,32,&H0000FFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,20,20,25,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Regular,,0,0,0,,Installed 中文字幕 世界
Dialogue: 0,0:00:00.00,0:00:01.00,Bold,,0,0,0,,粗体确认 Bold 字幕
`;
  await writeFile(join(output, "subtitle.ass"), ass, "utf8");
  const results = [];
  const selectedFonts = new Set();
  for (const container of ["mp4", "mkv"]) {
    const filename = `installed.${container}`;
    const encode = run(ffmpeg, [
      "-hide_banner",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=640x360:r=25:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-vf",
      "ass=subtitle.ass:fontsdir=fonts",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-shortest",
      filename,
    ]);
    await writeFile(join(output, `${container}-encode.log`), encode.stderr);
    if (
      /Glyph 0x[0-9a-f]+ not found|failed to find.*font|fontselect.*failed|Error opening/i.test(
        encode.stderr,
      )
    )
      throw new Error(
        `Installed ${container} subtitle glyph/font rendering failed`,
      );
    const fontLines = encode.stderr
      .split(/\r?\n/)
      .filter((line) => line.includes("fontselect:"));
    if (
      !fontLines.some((line) => /NotoSansCJKsc-Regular/i.test(line)) ||
      !fontLines.some((line) => /NotoSansCJKsc-Bold/i.test(line))
    )
      throw new Error(
        `Installed ${container} did not use both bundled Noto font faces: ${fontLines.join(";")}`,
      );
    for (const line of fontLines) selectedFonts.add(line.trim());
    const probe = JSON.parse(
      run(ffprobe, [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        filename,
      ]).stdout,
    );
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    if (
      video?.codec_name !== "h264" ||
      audio?.codec_name !== "aac" ||
      video.width !== 640 ||
      video.height !== 360 ||
      Math.abs(Number(probe.format.duration) - 1) > 0.15
    )
      throw new Error(
        `Installed ${container} codec/geometry/duration assertion failed`,
      );
    const decoded = run(
      ffmpeg,
      [
        "-v",
        "error",
        "-i",
        filename,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ],
      true,
    ).stdout;
    if (decoded.length !== 640 * 360 * 3)
      throw new Error(
        "Installed media decoding produced an unexpected pixel buffer",
      );
    let visiblePixels = 0;
    for (let i = 0; i < decoded.length; i += 3)
      if (Math.max(decoded[i], decoded[i + 1], decoded[i + 2]) > 100)
        visiblePixels++;
    if (visiblePixels < 500)
      throw new Error(
        "Decoded installed output contains no meaningful visible subtitle pixels",
      );
    run(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-i",
      filename,
      "-frames:v",
      "1",
      `${container}-preview.png`,
    ]);
    await writeFile(
      join(output, `${container}-probe.json`),
      JSON.stringify(probe, null, 2),
    );
    results.push({
      container,
      sizeBytes: (await stat(join(output, filename))).size,
      videoCodec: video.codec_name,
      audioCodec: audio.codec_name,
      width: video.width,
      height: video.height,
      durationSeconds: Number(probe.format.duration),
      visibleSubtitlePixels: visiblePixels,
    });
  }
  return {
    status: "passed",
    ffmpegVersion: version,
    fontsUsed: [...selectedFonts],
    glyphs:
      "Chinese/Latin regular and bold rendered with both bundled Noto faces; no missing-glyph/font fallback errors; decoded non-black subtitle pixels verified.",
    results,
    evidenceDirectory: output,
  };
}

module.exports = { installedMediaSmoke };
