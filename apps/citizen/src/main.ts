import { mount } from "svelte";

import App from "./App.svelte";
import { prefs } from "./lib/prefs.ts";
import { registerServiceWorker } from "./lib/pwa.ts";
import "./tokens.css";

mount(App, { target: document.getElementById("app") as HTMLElement });

// Vite replaces both conditions at build time, so dev and the single-file build drop this code.
if (import.meta.env.PROD && import.meta.env.MODE !== "single") registerServiceWorker();
