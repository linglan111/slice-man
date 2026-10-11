const { createHash } = require("node:crypto");
const { mkdir, stat } = require("node:fs/promises");
const { createReadStream, createWriteStream } = require("node:fs");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { resolve, join } = require("node:path");
const { pathToFileURL } = require("node:url");

// Native fixture preparation only. Product installation uses DownloadService.
// Node 24 strips the manifest's types, preserving one authoritative set of pins.
async function main() {
  const { DOWNLOAD_ARTIFACTS } = await import(pathToFileURL(resolve("src/main/services/download/manifest.ts")).href);
  const root = resolve(".runtime-cache/download-tools");
  await mkdir(root, { recursive: true });
  for (const [name, artifact] of [["yt-dlp.exe", DOWNLOAD_ARTIFACTS.ytdlp], ["deno.zip", DOWNLOAD_ARTIFACTS.deno]]) {
    const destination = join(root, name);
    async function valid() {
      try {
        if ((await stat(destination)).size !== artifact.sizeBytes) return false;
        const hash = createHash("sha256"); for await (const chunk of createReadStream(destination)) hash.update(chunk);
        return hash.digest("hex") === artifact.sha256;
      } catch { return false; }
    }
    if (!(await valid())) {
      const response = await fetch(artifact.url, { signal: AbortSignal.timeout(10 * 60_000) });
      if (!response.ok || !response.body) throw new Error(`Fixture download failed: HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
      if (!(await valid())) throw new Error(`Fixture integrity failure: ${name}`);
    }
    console.log(`${name}: verified ${artifact.sizeBytes} bytes SHA256 ${artifact.sha256}`);
  }
  console.log("Ready for deterministic native Electron download E2E. No global tools/settings changed.");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
