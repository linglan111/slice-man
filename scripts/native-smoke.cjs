const { spawnSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const directory = resolve(".native-smoke");
mkdirSync(directory, { recursive: true });
const entry = resolve(directory, "probe.cjs");
writeFileSync(
  entry,
  `const { app, BrowserWindow, safeStorage } = require('electron');\nconst Database = require('better-sqlite3');\nconst { drizzle } = require('drizzle-orm/better-sqlite3');\nconst { sql } = require('drizzle-orm');\napp.setPath('userData', ${JSON.stringify(resolve(directory, "user-data"))});\napp.whenReady().then(async () => {\nconst sqlite = new Database(':memory:');\nconst db = drizzle(sqlite);\nconst row = db.get(sql\`select 42 as answer\`);\nif (row.answer !== 42) throw new Error('SQLite query failed');\nconst window = new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});\nawait window.loadURL('data:text/html,<h1>Native smoke</h1>');\nconsole.log(JSON.stringify({status:'passed',electron:process.versions.electron,node:process.versions.node,abi:process.versions.modules,sqlite:sqlite.prepare('select sqlite_version() version').get(),safeStorage:safeStorage.isEncryptionAvailable(),browser:await window.webContents.executeJavaScript('document.querySelector("h1").textContent')}));\nsqlite.close(); app.quit();\n}).catch(error=>{console.error(error);app.exit(1)});\n`,
  "utf8",
);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const result = spawnSync(require("electron"), [entry], {
  encoding: "utf8",
  timeout: 60_000,
  env: environment,
});
process.stdout.write(result.stdout || "");
if (result.status !== 0) {
  process.stderr.write(result.stderr || String(result.error));
  process.exitCode = 1;
}
