/**
 * What the resident told this device for their weekly list: where they live and the topic
 * groups they follow (see lib/topics.ts), plus whether they have been through the welcome steps.
 * Kept in `localStorage` only and never sent anywhere, not even in a query string: the app
 * downloads the same public list for everyone and sorts it here (Pulse). Storage can be missing
 * or blocked (private windows, previews), so every access is guarded; the choices then last
 * until the page is closed.
 */

import type { Place } from "@democracy2/pulse";

import { groupsOf, isGroup, type Group } from "./topics.ts";

const KEY = "d2.pulse.v1";

export interface Choices {
  /** Charter place id of the commune or canton, or null while not chosen. */
  home: string | null;
  /** Topic groups followed, in the order they were picked. */
  groups: Group[];
  /** True once the resident finished or skipped the welcome steps. */
  done: boolean;
}

/** Charter's places and weekly budget, built into the app (the same on every device). */
export const CHARTER = __PULSE_CHARTER__;
const KNOWN = new Set(CHARTER.places.map((p: Place) => p.id));

const NONE: Choices = { home: null, groups: [], done: false };

function load(): Choices {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...NONE };
    const { home, groups, topics, done } = raw as Record<string, unknown>;
    const chosen = Array.isArray(groups) ? groups.filter(isGroup) : [];
    // Before groups, the device kept the published names themselves; they fall into their groups.
    const legacy = Array.isArray(topics) ? topics.filter((t): t is string => typeof t === "string").flatMap(groupsOf) : [];
    const place = typeof home === "string" && KNOWN.has(home) ? home : null;
    return {
      home: place,
      groups: [...new Set([...chosen, ...legacy])],
      // A device that already chose a place has been set up, whether or not it saw the steps.
      done: done === true || place !== null,
    };
  } catch {
    return { ...NONE };
  }
}

function save(c: Choices) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ home: c.home, groups: c.groups, done: c.done }));
  } catch {
    // Storage refused: the choices stay in memory for this visit.
  }
}

export const pulse = $state<{ prefs: Choices }>({ prefs: load() });

export function setHome(home: string | null) {
  const place = home && KNOWN.has(home) ? home : null;
  // A device that chose a place is set up, whether or not it went through the welcome steps.
  pulse.prefs = { ...pulse.prefs, home: place, done: pulse.prefs.done || place !== null };
  save(pulse.prefs);
}

export function toggleGroup(group: Group) {
  const has = pulse.prefs.groups.includes(group);
  pulse.prefs = { ...pulse.prefs, groups: has ? pulse.prefs.groups.filter((g) => g !== group) : [...pulse.prefs.groups, group] };
  save(pulse.prefs);
}

/** The welcome steps are over (finished or skipped): the app opens on the week from now on. */
export function finishSetup() {
  pulse.prefs = { ...pulse.prefs, done: true };
  save(pulse.prefs);
}

/** Read storage again (another tab may have written it; tests use it too). */
export function reloadPulse() {
  pulse.prefs = load();
}

/** Forget the choices (tests, and the "forget my choices" button). The welcome steps stay done. */
export function resetPulse() {
  pulse.prefs = { ...NONE, done: pulse.prefs.done };
  try {
    if (pulse.prefs.done) save(pulse.prefs);
    else localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}
