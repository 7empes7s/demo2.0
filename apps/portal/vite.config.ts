import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// The built portal is served by the Companion server under /portal/ (PORTAL_DIR), and every API
// call is an absolute /api/desk/... path on the same origin. In dev, Vite proxies /api to the
// Companion on :8787, which forwards /api/desk/* to Desk.
export default defineConfig({
  base: "/portal/",
  plugins: [svelte()],
  build: { outDir: "dist" },
  server: { proxy: { "/api": "http://localhost:8787" } },
});
