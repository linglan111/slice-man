const { createHash } = require("node:crypto");
const { createReadStream, createWriteStream, existsSync } = require("node:fs");
const { mkdir, copyFile, readdir, writeFile, rm } = require("node:fs/promises");
const { join, resolve, dirname, sep } = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const yauzl = require("yauzl");

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function acquire(url, file, sha256) {
  await mkdir(dirname(file), { recursive: true });
  if (existsSync(file) && (!sha256 || (await digest(file)) === sha256)) return;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body)
    throw new Error(`Resource download HTTP ${response.status}: ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
  if (sha256 && (await digest(file)) !== sha256)
    throw new Error(`Resource integrity mismatch: ${url}`);
}
async function unpack(file, root) {
  await mkdir(root, { recursive: true });
  return new Promise((resolveArchive, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error || new Error("Missing ZIP"));
      zip.on("error", reject);
      zip.on("end", resolveArchive);
      zip.on("entry", (entry) => {
        const destination = resolve(root, entry.fileName);
        if (
          !destination.startsWith(resolve(root) + sep) ||
          /[\\]|(^|\/)\.\.(\/|$)/.test(entry.fileName)
        ) {
          zip.close();
          reject(new Error("Unsafe resource archive"));
          return;
        }
        (async () => {
          if (entry.fileName.endsWith("/"))
            await mkdir(destination, { recursive: true });
          else {
            await mkdir(dirname(destination), { recursive: true });
            await new Promise((resolveEntry, rejectEntry) =>
              zip.openReadStream(entry, (err, stream) => {
                if (err || !stream)
                  return rejectEntry(err || new Error("Missing ZIP stream"));
                pipeline(stream, createWriteStream(destination)).then(
                  resolveEntry,
                  rejectEntry,
                );
              }),
            );
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  });
}
async function main() {
  const archive = resolve(".runtime-cache/ffmpeg-8.1.2-essentials.zip");
  await acquire(
    "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip",
    archive,
    "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec",
  );
  const unpacked = resolve(".runtime-cache/ffmpeg-8.1.2");
  await unpack(archive, unpacked);
  const roots = await readdir(unpacked);
  const packageRoot = roots.find((name) => name.startsWith("ffmpeg-"));
  if (!packageRoot) throw new Error("Unexpected FFmpeg archive layout");
  await mkdir("resources/media", { recursive: true });
  await mkdir("resources/notices", { recursive: true });
  for (const file of ["ffmpeg.exe", "ffprobe.exe"])
    await copyFile(
      join(unpacked, packageRoot, "bin", file),
      join("resources/media", file),
    );
  for (const file of await readdir("resources/media")) {
    if (/\.dll$/i.test(file)) await rm(join("resources/media", file));
  }
  const license = join(unpacked, packageRoot, "LICENSE");
  if (existsSync(license))
    await copyFile(license, "resources/notices/FFmpeg-LICENSE.txt");
  await copyFile(
    join(unpacked, packageRoot, "README.txt"),
    "resources/notices/FFmpeg-BUILD-README.txt",
  );
  for (const [name, hash] of [
    [
      "Regular",
      "2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b",
    ],
    [
      "Bold",
      "b5f0d1a190a7f9b43c310a8850630af12553df32c4c050543f9059732d9b4c0a",
    ],
  ]) {
    await acquire(
      `https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-${name}.otf`,
      `resources/fonts/NotoSansCJKsc-${name}.otf`,
      hash,
    );
  }
  await acquire(
    "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE",
    "resources/notices/Noto-Sans-CJK-LICENSE.txt",
  );
  await acquire(
    "https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.8.3/LICENSE",
    "resources/notices/whisper.cpp-LICENSE.txt",
  );
  await acquire(
    "https://raw.githubusercontent.com/openai/whisper/main/LICENSE",
    "resources/notices/Whisper-model-LICENSE.txt",
  );
  await acquire(
    "https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.8.3/samples/jfk.wav",
    "resources/runtime-smoke.wav",
    "",
  );
  const manifest = {
    ffmpeg: {
      version: "8.1.2-essentials",
      archiveSha256: await digest(archive),
      url: "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip",
      source: "https://github.com/FFmpeg/FFmpeg/commit/38b88335f9",
    },
    fonts: await Promise.all(
      ["Regular", "Bold"].map(async (name) => ({
        name: `NotoSansCJKsc-${name}.otf`,
        sha256: await digest(`resources/fonts/NotoSansCJKsc-${name}.otf`),
      })),
    ),
  };
  await writeFile(
    "resources/media/manifest.json",
    JSON.stringify(manifest, null, 2),
  );
  console.log(
    "Resources ready: pinned FFmpeg, fonts, notices and Whisper smoke audio.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
