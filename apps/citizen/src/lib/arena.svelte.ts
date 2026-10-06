/**
 * How a resident did on each file's questions, kept on this device only. Nothing here is ever
 * sent anywhere: no score, no attempt count, not even that the questions were opened.
 * Storage can be missing or blocked (private windows, previews), so every access is guarded
 * and the questions still work without it; progress then lasts until the page is closed.
 */

const KEY = "d2.arena.v1";

export interface Progress {
  /** How many times the resident finished the questions for this file. */
  attempts: number;
  /** The most answers that matched the text in one go, out of `total`. */
  best: number;
  total: number;
  /** Every answer matched the text at least once. Stays true after a later, weaker attempt. */
  understood: boolean;
}

type Saved = Record<string, Progress>;

const valid = (p: unknown): p is Progress => {
  if (typeof p !== "object" || p === null) return false;
  const v = p as Record<string, unknown>;
  const n = (x: unknown) => Number.isSafeInteger(x) && (x as number) >= 0;
  return n(v.attempts) && n(v.best) && n(v.total) && (v.best as number) <= (v.total as number) && typeof v.understood === "boolean";
};

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const out: Saved = {};
    for (const [id, p] of Object.entries(raw)) if (valid(p)) out[id] = p;
    return out;
  } catch {
    return {};
  }
}

function save(data: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage refused: progress stays in memory for this visit.
  }
}

export const arena = $state<{ items: Saved }>({ items: load() });

export function progressOf(itemId: string): Progress | null {
  return Object.hasOwn(arena.items, itemId) ? arena.items[itemId] : null;
}

/** Record one finished attempt and return the file's progress after it. */
export function recordAttempt(itemId: string, matched: number, total: number): Progress {
  const before = progressOf(itemId);
  const after: Progress = {
    attempts: (before?.attempts ?? 0) + 1,
    best: Math.max(before && before.total === total ? before.best : 0, matched),
    total,
    understood: (before?.understood ?? false) || (total > 0 && matched === total),
  };
  arena.items = { ...arena.items, [itemId]: after };
  save(arena.items);
  return after;
}

/** How many files the resident has understood on this device. */
export function understoodCount(): number {
  return Object.values(arena.items).filter((p) => p.understood).length;
}

/** Read storage again (another tab may have written it; tests use it too). */
export function reloadArena() {
  arena.items = load();
}

/** Forget everything (tests, and a future "clear my data" control). */
export function resetArena() {
  arena.items = {};
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}
