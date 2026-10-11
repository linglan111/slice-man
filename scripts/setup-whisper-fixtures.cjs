const { createHash, randomUUID } = require("node:crypto");
const { createReadStream, createWriteStream, existsSync } = require("node:fs");
const {
  mkdir,
  rename,
  rm,
  stat,
  lstat,
  writeFile,
} = require("node:fs/promises");
const { resolve, join, relative, isAbsolute, dirname } = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const yauzl = require("yauzl");

const workspace = resolve(__dirname, "..");
const cache = join(workspace, ".runtime-cache", "whisper");
const origin =
  "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/";
const artifacts = [
  {
    file: "cpu.zip",
    url: origin + "whisper-bin-x64.zip",
    size: 3968674,
    sha256: "d824b1e37599f882b396e73f1ee0bfd5d0529f700314c48311dcbd00b803321d",
    directory: "cpu",
  },
  {
    file: "ggml-base.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin",
    size: 147951465,
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
  },
  {
    file: "jfk.wav",
    url: "https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.8.3/samples/jfk.wav",
    size: 352078,
    sha256: "59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e",
  },
];
const gpu = {
  file: "cuda.zip",
  url: origin + "whisper-cublas-12.4.0-bin-x64.zip",
  size: 459854042,
  sha256: "c12a563333d3c3707be70754dc0e87c1cb58aa6333a87055bbcf9b524488dfb0",
  directory: "cuda",
};

function confined(path) {
  const absolute = resolve(path);
  const offset = relative(cache, absolute);
  if (!offset || offset.startsWith("..") || isAbsolute(offset))
    throw new Error("Whisper fixture path escaped its fixed cache directory");
  return absolute;
}
async function rejectLinks(path) {
  let current = resolve(path);
  while (current !== workspace) {
    if (!current.startsWith(workspace + require("node:path").sep))
      throw new Error("Fixture ancestor escaped workspace");
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("Fixture path/ancestor is a symbolic link or junction");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    current = dirname(current);
  }
}
async function hash(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
async function valid(path, artifact) {
  return (
    existsSync(path) &&
    (await stat(path)).size === artifact.size &&
    (await hash(path)) === artifact.sha256
  );
}
async function acquire(artifact) {
  const file = confined(join(cache, artifact.file));
  await rejectLinks(file);
  if (await valid(file, artifact)) {
    console.log(`Verified cached fixture: ${artifact.file}`);
    return { ...artifact, acquisition: "verified-cache" };
  }
  const partial = confined(file + ".part");
  await rejectLinks(partial);
  for (let attempt = 0; attempt < 3; attempt++) {
    await rm(partial, { force: true });
    try {
      console.log(`Downloading pinned fixture: ${artifact.file}`);
      const response = await fetch(artifact.url, {
        signal: AbortSignal.timeout(15 * 60_000),
      });
      if (!response.ok || !response.body)
        throw new Error(`Fixture download HTTP ${response.status}`);
      const input = Readable.fromWeb(response.body);
      let bytes = 0;
      input.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > artifact.size)
          input.destroy(new Error("Fixture exceeds pinned size"));
      });
      await pipeline(input, createWriteStream(partial, { flags: "wx" }));
      if (!(await valid(partial, artifact)))
        throw new Error("Fixture size/SHA-256 mismatch");
      await rename(partial, file);
      return { ...artifact, acquisition: "downloaded" };
    } catch (error) {
      await rm(partial, { force: true });
      if (attempt === 2 || /size|SHA-256/.test(error.message)) throw error;
    }
  }
  throw new Error("Fixture acquisition did not complete");
}
async function extract(artifact) {
  const target = confined(join(cache, artifact.directory));
  const staging = confined(
    join(cache, `${artifact.directory}-staging-${randomUUID()}`),
  );
  const previous = confined(
    join(cache, `${artifact.directory}-previous-${randomUUID()}`),
  );
  await rejectLinks(target);
  await mkdir(staging);
  try {
    await new Promise((resolveArchive, reject) => {
      yauzl.open(
        join(cache, artifact.file),
        { lazyEntries: true, validateEntrySizes: true },
        (error, zip) => {
          if (error || !zip)
            return reject(error || new Error("Missing ZIP reader"));
          let total = 0;
          let count = 0;
          const fail = (reason) => {
            zip.close();
            reject(reason);
          };
          zip.on("error", fail);
          zip.on("end", resolveArchive);
          zip.on("entry", (entry) => {
            (async () => {
              total += entry.uncompressedSize;
              count++;
              if (
                total > 4_000_000_000 ||
                count > 10000 ||
                ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
              )
                throw new Error("Unsafe fixture archive size/type");
              if (
                !entry.fileName ||
                /(^[\\/]|[:\\]|(^|\/)\.\.(\/|$)|\0)/i.test(entry.fileName)
              )
                throw new Error("Unsafe fixture archive path");
              const destination = resolve(staging, entry.fileName);
              const offset = relative(staging, destination);
              if (!offset || offset.startsWith("..") || isAbsolute(offset))
                throw new Error("Archive path escaped fresh staging directory");
              if (entry.fileName.endsWith("/"))
                await mkdir(destination, { recursive: true });
              else {
                await mkdir(dirname(destination), { recursive: true });
                await new Promise((resolveEntry, rejectEntry) =>
                  zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError || !stream)
                      return rejectEntry(
                        streamError || new Error("Missing ZIP entry stream"),
                      );
                    pipeline(
                      stream,
                      createWriteStream(destination, { flags: "wx" }),
                    ).then(resolveEntry, rejectEntry);
                  }),
                );
              }
              zip.readEntry();
            })().catch(fail);
          });
          zip.readEntry();
        },
      );
    });
    if (!existsSync(join(staging, "Release", "whisper-cli.exe")))
      throw new Error("Fixture archive lacks expected Whisper executable");
    if (existsSync(target)) await rename(target, previous);
    try {
      await rename(staging, target);
    } catch (error) {
      if (existsSync(previous)) await rename(previous, target);
      throw error;
    }
    await rm(confined(previous), { recursive: true, force: true });
  } finally {
    await rm(confined(staging), { recursive: true, force: true });
  }
}
async function main() {
  await rejectLinks(cache);
  await mkdir(cache, { recursive: true });
  const selected = process.argv.includes("--gpu")
    ? [...artifacts, gpu]
    : artifacts;
  const results = [];
  for (const artifact of selected) {
    results.push(await acquire(artifact));
    if (artifact.directory) await extract(artifact);
  }
  const report = {
    status: "passed",
    gpuPrepared: process.argv.includes("--gpu"),
    purpose:
      "Developer test fixtures only; production downloads use RuntimeService.",
    artifacts: results,
  };
  await writeFile(
    confined(join(cache, "fixture-preparation.json")),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
