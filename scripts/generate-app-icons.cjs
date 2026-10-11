/* Render the canonical SVG with the project's Electron runtime, then build
 * PNG and multi-resolution Windows ICO assets without another dependency. */
const { spawnSync } = require("node:child_process");
const { readFile, writeFile, mkdir, copyFile } = require("node:fs/promises");
const { resolve, join } = require("node:path");

async function render() {
  const { app, BrowserWindow } = require("electron");
  await app.whenReady();
  const root = resolve(__dirname, "..");
  const folder = join(root, "resources", "icons");
  const source = await readFile(join(folder, "icon.svg"), "utf8");
  const window = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  await window.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}svg{display:block;width:100%;height:100%}</style></head><body>${source}</body></html>`,
      ),
  );
  await window.webContents.executeJavaScript(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80))))",
  );
  const captured = await window.webContents.capturePage();
  await writeFile(join(folder, "icon.png"), captured.toPNG());
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) =>
    captured.resize({ width: size, height: size, quality: "best" }).toPNG(),
  );
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  await writeFile(join(folder, "icon.ico"), Buffer.concat([header, ...images]));
  const assets = join(root, "src", "renderer", "src", "assets");
  await mkdir(assets, { recursive: true });
  await copyFile(join(folder, "icon.svg"), join(assets, "app-icon.svg"));
  window.destroy();
  app.quit();
}

if (process.versions.electron) {
  render().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    require("electron").app.exit(1);
  });
} else {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require("electron"), [__filename], {
    env: environment,
    stdio: "inherit",
    windowsHide: true,
    timeout: 30000,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
