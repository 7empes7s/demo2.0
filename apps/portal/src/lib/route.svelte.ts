/** Hash routing: `#section` or `#section/<id>`. The id in the hash is a technical detail, never shown as text. */

import type { Section } from "./session.svelte.ts";
import { SECTIONS } from "./session.svelte.ts";

export interface Route {
  section: Section | null;
  arg: string | null;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  if (!raw) return { section: null, arg: null };
  const [head, ...rest] = raw.split("/");
  const section = head in SECTIONS ? (head as Section) : null;
  let arg: string | null = rest.length ? rest.join("/") : null;
  if (arg !== null) {
    try {
      arg = decodeURIComponent(arg);
    } catch {
      // Keep it raw.
    }
  }
  return { section, arg };
}

export const route = $state<Route>(typeof location === "undefined" ? { section: null, arg: null } : parseHash(location.hash));

export function navigate(section: Section, arg: string | null = null) {
  const next = `#${section}${arg ? `/${encodeURIComponent(arg)}` : ""}`;
  if (location.hash === next) return;
  location.hash = next;
}

export function syncRoute() {
  const r = parseHash(location.hash);
  route.section = r.section;
  route.arg = r.arg;
}
