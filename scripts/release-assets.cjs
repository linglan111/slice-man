const { mkdirSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

async function main() {
  for (const [repository, tag] of [
    ["ggml-org/whisper.cpp", "v1.9.5"],
    ["WiseLibs/better-sqlite3", "v13.0.3"],
  ]) {
    const response = await fetch(
      `https://github.com/${repository}/releases/expanded_assets/${tag}`,
    );
    if (!response.ok) throw new Error(`Release assets HTTP ${response.status}`);
    const html = await response.text();
    const links = [
      ...html.matchAll(/href="([^"]+\/releases\/download\/[^"]+)"/g),
    ].map((match) => `https://github.com${match[1]}`);
    mkdirSync(".runtime-cache", { recursive: true });
    writeFileSync(
      resolve(".runtime-cache", repository.split("/")[1] + "-assets.json"),
      JSON.stringify({ repository, tag, links }, null, 2),
    );
    console.log(
      repository,
      tag,
      links.filter((url) => /win|cuda/.test(url)).join("\n"),
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
