const { spawnSync } = require("node:child_process");
const { dirname, resolve, basename, join } = require("node:path");
const {
  readdirSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} = require("node:fs");
const { createHash } = require("node:crypto");

function executablePath(name) {
  const result = spawnSync("where.exe", [name], { encoding: "utf8" });
  const found = result.stdout?.trim().split(/\r?\n/)[0];
  if (result.status !== 0 || !found)
    throw new Error(`${name} missing from PATH; set up FFmpeg first.`);
  return found;
}

const sourceDirectory =
  process.env.SLICE_MEDIA_SOURCE || dirname(executablePath("ffmpeg.exe"));
const destination = resolve("resources/media");
mkdirSync(destination, { recursive: true });
const files = readdirSync(sourceDirectory).filter(
  (file) => /^(ffmpeg|ffprobe)\.exe$/i.test(file) || /\.dll$/i.test(file),
);
for (const file of files)
  copyFileSync(join(sourceDirectory, file), join(destination, file));
const version = spawnSync(join(destination, "ffmpeg.exe"), ["-version"], {
  encoding: "utf8",
});
if (version.status !== 0)
  throw new Error(`Copied FFmpeg failed: ${version.stderr}`);
const manifest = {
  version: version.stdout.split("\n")[0],
  origin: sourceDirectory,
  files: files.map((file) => ({
    name: basename(file),
    sha256: createHash("sha256")
      .update(readFileSync(join(destination, file)))
      .digest("hex"),
  })),
};
writeFileSync(
  join(destination, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  `Prepared ${files.length} media files in ${destination}. ${manifest.version}`,
);
