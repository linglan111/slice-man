const { spawn } = require("node:child_process");
const { resolve } = require("node:path");

// Run unit/integration tests with Electron's embedded Node, so native SQLite
// uses the same ABI as desktop/E2E/packaging and no global rebuild switch occurs.
const child = spawn(
  require("electron"),
  [resolve("node_modules/vitest/vitest.mjs"), ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  },
);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
