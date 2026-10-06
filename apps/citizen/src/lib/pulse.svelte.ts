/**
 * What the resident told this device for their weekly list: where they live and the topics they
 * follow. Kept in `localStorage` only and never sent anywhere, not even in a query string: the app
 * downloads the same public list for everyone and sorts it here (Pulse). Storage can be missing
 * or blocked (private windows, previews), so every access is guarded; the choices then last
 * until the page is closed.
 */

import type { Place, Preferences } from "@democracy2/pulse";

const KEY = "d2.pulse.v1";

/** Charter's places and weekly budget, built into the app (the same on every device). */
export const CHARTER = __PULSE_CHARTER__;
const KNOWN = new Set(CHARTER.places.map((p: Place) => p.id));

function load(): Preferences {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { home: null, topics: [] };
    const { home, topics } = raw as Record<string, unknown>;
    return {
      home: typeof home === "string" && KNOWN.has(home) ? home : null,
      topics: Array.isArray(topics) ? [...new Set(topics.filter((t): t is string => typeof t === "string" && t.length > 0 && t.length <= 200))] : [],
    };
  } catch {
    return { home: null, topics: [] };
  }
}

function save(p: Preferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ home: p.home, topics: p.topics }));
  } catch {
    // Storage refused: the choices stay in memory for this visit.
  }
}

export const pulse = $state<{ prefs: Preferences }>({ prefs: load() });

export function setHome(home: string | null) {
  pulse.prefs = { ...pulse.prefs, home: home && KNOWN.has(home) ? home : null };
  save(pulse.prefs);
}

export function toggleTopic(topic: string) {
  const has = pulse.prefs.topics.includes(topic);
  pulse.prefs = { ...pulse.prefs, topics: has ? pulse.prefs.topics.filter((t) => t !== topic) : [...pulse.prefs.topics, topic] };
  save(pulse.prefs);
}

/** Read storage again (another tab may have written it; tests use it too). */
export function reloadPulse() {
  pulse.prefs = load();
}

/** Forget the choices (tests, and the "forget my choices" button). */
export function resetPulse() {
  pulse.prefs = { home: null, topics: [] };
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}
