import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `vite build` makes the PWA served by the Companion server.
// `vite build --mode single` makes one self-contained HTML file (the shareable demo).
export default defineConfig(({ mode }) => ({
  plugins: [svelte(), ...(mode === "single" ? [viteSingleFile()] : [])],
  build: { outDir: mode === "single" ? "dist-single" : "dist" },
  server: { proxy: { "/api": "http://localhost:8787", "/data": "http://localhost:8787" } },
}));
