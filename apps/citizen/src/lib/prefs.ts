/** Per-device conveniences. Storage can be missing or blocked, so every access is guarded. */

import type { Position } from "@democracy2/companion";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private windows and sandboxed previews refuse storage; the app works without it.
  }
}

export const prefs = {
  lang: () => read("d2.lang"),
  setLang: (lang: string) => write("d2.lang", lang),
  theme: () => read("d2.theme") as "light" | "dark" | null,
  setTheme: (theme: "light" | "dark" | null) => write("d2.theme", theme),
  /** The look flag (see `look.ts`): "affichage" or nothing. */
  look: () => read("d2.look"),
  setLook: (look: string | null) => write("d2.look", look),
  /** A resident's stance stays on their device and is never sent anywhere on its own. */
  stance: (itemId: string) => read(`d2.stance.${itemId}`) as Position | null,
  setStance: (itemId: string, stance: Position | null) => write(`d2.stance.${itemId}`, stance),
};
