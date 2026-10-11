import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { DOWNLOAD_ARTIFACTS } from "../../src/main/services/download/manifest";

export async function downloadFixture(
  root: string,
  video?: string,
): Promise<{
  manifest: string;
  url: string;
  behavior: { tool: "ok" | "corrupt" | "slow"; video?: string };
  requests: string[];
  close: () => Promise<void>;
}> {
  const behavior: { tool: "ok" | "corrupt" | "slow"; video?: string } = {
    tool: "ok",
  };
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    requests.push(path);
    if (path === "/blocked.mp4") {
      response.writeHead(403);
      response.end("blocked");
      return;
    }
    if (path === "/slow.mp4") return;
    if (path.startsWith("/tool-") && behavior.tool === "slow") return;
    if (path.startsWith("/tool-") && behavior.tool === "corrupt") {
      response.end("corrupt");
      return;
    }
    const file =
      path === "/tool-yt.exe"
        ? resolve(".runtime-cache/download-tools/yt-dlp.exe")
        : path === "/tool-deno.zip"
          ? resolve(".runtime-cache/download-tools/deno.zip")
          : (behavior.video ?? video);
    if (!file) {
      response.writeHead(404);
      response.end();
      return;
    }
    void stat(file)
      .then((info) => {
        response.writeHead(200, {
          "Content-Type": path.startsWith("/tool-")
            ? "application/octet-stream"
            : extname(file) === ".webm"
              ? "video/webm"
              : "video/mp4",
          "Content-Length": info.size,
        });
        if (request.method === "HEAD") response.end();
        else createReadStream(file).pipe(response);
      })
      .catch(() => {
        response.writeHead(404);
        response.end();
      });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture bind failed");
  const url = `http://127.0.0.1:${address.port}`;
  await mkdir(root, { recursive: true });
  const manifest = join(root, "download-manifest.json");
  await writeFile(
    manifest,
    JSON.stringify({
      ...DOWNLOAD_ARTIFACTS,
      ytdlp: { ...DOWNLOAD_ARTIFACTS.ytdlp, url: `${url}/tool-yt.exe` },
      deno: { ...DOWNLOAD_ARTIFACTS.deno, url: `${url}/tool-deno.zip` },
    }),
  );
  return {
    manifest,
    url,
    behavior,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
    },
  };
}
