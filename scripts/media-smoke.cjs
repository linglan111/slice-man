const { spawnSync } = require("node:child_process");
const { resolve, join } = require("node:path");
const { mkdirSync, writeFileSync, copyFileSync } = require("node:fs");

const ffmpeg = resolve("resources/media/ffmpeg.exe");
const ffprobe = resolve("resources/media/ffprobe.exe");
const directory = resolve(".media-smoke/中文 spaced path");
mkdirSync(directory, { recursive: true });
mkdirSync(join(directory, "fonts"), { recursive: true });
for (const font of ["NotoSansCJKsc-Regular.otf", "NotoSansCJKsc-Bold.otf"])
  copyFileSync(
    resolve("resources/fonts", font),
    join(directory, "fonts", font),
  );
writeFileSync(
  join(directory, "subtitle.ass"),
  `[Script Info]\nScriptType: v4.00+\nPlayResX: 640\nPlayResY: 360\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Noto Sans CJK SC,32,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,25,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Hello 世界\n`,
  "utf8",
);
function run(binary, args) {
  const result = spawnSync(binary, args, {
    cwd: directory,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0)
    throw new Error(`${binary} failed: ${result.error || result.stderr}`);
  return result;
}
for (const container of ["mp4", "mkv"]) {
  const output = `smoke.${container}`;
  run(ffmpeg, [
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
    output,
  ]);
  const metadata = JSON.parse(
    run(ffprobe, ["-v", "error", "-show_streams", "-of", "json", output])
      .stdout,
  );
  if (
    !metadata.streams.some((stream) => stream.codec_name === "h264") ||
    !metadata.streams.some((stream) => stream.codec_name === "aac")
  )
    throw new Error("Required codec missing");
  writeFileSync(
    join(directory, `${container}-probe.json`),
    JSON.stringify(metadata, null, 2),
  );
}
run(ffmpeg, [
  "-hide_banner",
  "-y",
  "-i",
  "smoke.mp4",
  "-frames:v",
  "1",
  "preview.png",
]);
console.log(
  `PASS: libass CJK subtitles, H.264/AAC MP4/MKV, ffprobe and Unicode/spaced paths: ${directory}`,
);
