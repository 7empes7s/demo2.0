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

export interface LetterAsked {
  at: string;
  code: string | null;
}

export const prefs = {
  lang: () => read("d2.lang"),
  setLang: (lang: string) => write("d2.lang", lang),
  theme: () => read("d2.theme") as "light" | "dark" | null,
  setTheme: (theme: "light" | "dark" | null) => write("d2.theme", theme),
  motion: () => read("d2.motion") as "on" | "off" | null,
  setMotion: (motion: "on" | "off" | null) => write("d2.motion", motion),
  /** A resident's stance stays on their device and is never sent anywhere on its own. */
  stance: (itemId: string) => read(`d2.stance.${itemId}`) as Position | null,
  setStance: (itemId: string, stance: Position | null) => write(`d2.stance.${itemId}`, stance),
  /** The token the commune's desk gave for an enrolment code. It names no one and goes only to the desk. */
  deskToken: () => read("d2.desk.token"),
  setDeskToken: (token: string | null) => write("d2.desk.token", token),
  /**
   * When this device asked for a code by post, and the random request code the desk gave back to
   * look up the outcome. The name and address are not kept here.
   */
  letterAsked: (): LetterAsked | null => {
    const raw = read("d2.desk.letter");
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as Partial<LetterAsked>;
      if (typeof v.at === "string") return { at: v.at, code: typeof v.code === "string" ? v.code : null };
    } catch {
      // Stored before request codes: the date alone.
    }
    return { at: raw, code: null };
  },
  setLetterAsked: (asked: LetterAsked | null) => write("d2.desk.letter", asked ? JSON.stringify(asked) : null),
};
