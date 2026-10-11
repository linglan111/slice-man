import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const alias = {
  "@shared": resolve("src/shared"),
  "@renderer": resolve("src/renderer/src"),
};

export default defineConfig({
  main: {
    resolve: { alias },
    build: { rollupOptions: { external: ["better-sqlite3"] } },
  },
  preload: {
    resolve: { alias },
    build: { externalizeDeps: false },
  },
  renderer: { resolve: { alias }, plugins: [react()] },
});
