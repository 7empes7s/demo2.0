import { mount } from "svelte";

import App from "./App.svelte";
import { applyLook, resolveLook } from "./lib/look.ts";
import { prefs } from "./lib/prefs.ts";
import { registerServiceWorker } from "./lib/pwa.ts";
import "./tokens.css";
import "./affichage.css";

// The look flag is applied before the first paint, so no frame shows the other look.
const look = resolveLook(location.search, prefs.look());
prefs.setLook(look);
applyLook(document.documentElement, look);

mount(App, { target: document.getElementById("app") as HTMLElement });

// Vite replaces both conditions at build time, so dev and the single-file build drop this code.
if (import.meta.env.PROD && import.meta.env.MODE !== "single") registerServiceWorker();
