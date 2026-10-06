import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// Component tests mount Svelte in jsdom, so resolve Svelte's browser build, not its server one.
export default defineConfig({ plugins: [svelte()], resolve: { conditions: ["browser"] }, test: { include: ["test/**/*.test.ts"] } });
