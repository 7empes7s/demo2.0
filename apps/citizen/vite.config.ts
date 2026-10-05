import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/** Files from public/ the installed app needs offline. */
const PUBLIC_SHELL = ["manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];

/**
 * Install and offline support for the served build: links the manifest from index.html and emits
 * sw.js with this build's file list. Not used by the single-file build.
 */
function pwa(): Plugin {
  return {
    name: "citizen-pwa",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "link", attrs: { rel: "manifest", href: "manifest.webmanifest" }, injectTo: "head" },
      { tag: "meta", attrs: { name: "theme-color", content: "#1B2A4A" }, injectTo: "head" },
      { tag: "link", attrs: { rel: "icon", type: "image/png", sizes: "192x192", href: "icon-192.png" }, injectTo: "head" },
      { tag: "link", attrs: { rel: "apple-touch-icon", href: "apple-touch-icon.png" }, injectTo: "head" },
    ],
    generateBundle(_, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith(".html") && !f.endsWith(".map"));
      const shell = ["./", ...PUBLIC_SHELL, ...built].sort();
      const template = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
      // Built files carry content hashes, so their names (plus the worker itself) version the cache.
      const version = createHash("sha256").update(template).update(shell.join("\n")).digest("hex").slice(0, 12);
      const source = template.replace("__VERSION__", version).replace("__SHELL__", JSON.stringify(shell));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// `vite build` makes the PWA served by the Companion server.
// `vite build --mode single` makes one self-contained HTML file (the shareable demo).
export default defineConfig(({ mode }) => ({
  plugins: [svelte(), ...(mode === "single" ? [viteSingleFile()] : [pwa()])],
  publicDir: mode === "single" ? false : "public",
  build: { outDir: mode === "single" ? "dist-single" : "dist" },
  server: { proxy: { "/api": "http://localhost:8787", "/data": "http://localhost:8787" } },
}));
