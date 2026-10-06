import { pulseCharter } from "@democracy2/pulse/charter";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// Component tests mount Svelte in jsdom, so resolve Svelte's browser build, not its server one.
// Pulse's Charter data is defined exactly as in vite.config.ts.
export default defineConfig({
  plugins: [svelte()],
  define: { __PULSE_CHARTER__: JSON.stringify(pulseCharter()) },
  resolve: { conditions: ["browser"] },
  test: { include: ["test/**/*.test.ts"] },
});
