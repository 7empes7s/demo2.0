import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  // Absolute (base-relative) URLs, so a deep link served the SPA fallback still finds them.
  let base = "/";
  let publicDir = "";
  return {
    name: "citizen-pwa",
    apply: "build",
    configResolved(config) {
      base = config.base;
      publicDir = config.publicDir;
    },
    transformIndexHtml: () => [
      { tag: "link", attrs: { rel: "manifest", href: `${base}manifest.webmanifest` }, injectTo: "head" },
      { tag: "meta", attrs: { name: "theme-color", content: "#1B2A4A" }, injectTo: "head" },
      { tag: "link", attrs: { rel: "icon", type: "image/png", sizes: "192x192", href: `${base}icon-192.png` }, injectTo: "head" },
      { tag: "link", attrs: { rel: "apple-touch-icon", href: `${base}apple-touch-icon.png` }, injectTo: "head" },
    ],
    generateBundle(_, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith(".html") && !f.endsWith(".map"));
      const shell = ["./", ...PUBLIC_SHELL, ...built].sort();
      const template = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
      // The cache version covers the bytes of everything the worker caches: the worker itself,
      // every built file (index.html included) and every public/ file, whose names carry no hash.
      // Changing only an icon or the manifest therefore still ships a new worker and a new cache.
      const hash = createHash("sha256").update(template);
      for (const name of Object.keys(bundle).sort()) {
        const out = bundle[name];
        hash.update(`\0${name}\0`).update(out.type === "chunk" ? out.code : out.source);
      }
      for (const name of PUBLIC_SHELL) hash.update(`\0public/${name}\0`).update(readFileSync(join(publicDir, name)));
      const version = hash.digest("hex").slice(0, 12);
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
