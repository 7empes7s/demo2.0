/**
 * The weekly list, built on the device. Input: the public file list everyone downloads (the
 * Docket snapshot), Charter's places, and what the resident told this device (where they live,
 * the topics they follow, which files they understood). Output: this week's files in sections.
 * Pure and deterministic: no clock read, no storage, no network.
 */

import { charterIdOf, containingPlaces, indexPlaces, type Place } from "./places.ts";
import { dayOf, inWeek, isoWeek, type Week } from "./week.ts";

/** The fields of a public file Pulse reads. Any Docket item fits. */
export interface PublicItem {
  id: string;
  jurisdiction_id: string;
  /** Esch-sur-Alzette council points: the city's theme, e.g. "Budget et Finances". */
  theme?: string | null;
  /** Chamber files: the committee, e.g. "Commission des Finances". */
  committee?: string | null;
  deposited?: string | null;
  updated?: string | null;
  agenda?: readonly { date?: string | null }[];
  activities?: readonly { date?: string | null }[];
  /** Consultations: open from `opens` to `closes`. */
  opens?: string | null;
  closes?: string | null;
}

/** What the resident told this device. Never leaves it. */
export interface Preferences {
  /** A Charter place id (a commune, or a canton when the commune is not listed yet), or null. */
  home: string | null;
  /** Topics from `topicsOf`, exactly as the public list spells them. */
  topics: readonly string[];
}

/** Why a file is in this week. Earlier kinds win on the same day. */
export type WhenKind = "meeting" | "open" | "filed" | "activity";
const WHEN_ORDER: readonly WhenKind[] = ["meeting", "open", "filed", "activity"];

export interface Entry<T extends PublicItem> {
  item: T;
  /** The first thing that happens to the file this week, or null when the list gives no date at all. */
  when: { day: string; kind: WhenKind } | null;
  /** The file is on a topic the resident follows. */
  onTopic: boolean;
  /** The resident marked the file understood on this device (Arena). */
  understood: boolean;
}

export interface WeeklyList<T extends PublicItem> {
  week: Week;
  /** Files of the place the resident lives in or of a place containing it. */
  concerned: Entry<T>[];
  /** Files elsewhere on topics the resident follows. */
  knowledgeable: Entry<T>[];
  /** Files a Lottery panel the resident sits on reviews. Always empty until panels exist. */
  judge: Entry<T>[];
  /** Everything else that happens this week, so nothing is hidden. */
  others: Entry<T>[];
  /** Files with dates, none of them in this week. Not listed. */
  outside: number;
  /** The weekly vote budget from Charter, shown only: voting does not exist yet. */
  budget: number | null;
}

export interface BuildInput<T extends PublicItem> {
  items: readonly T[];
  places: readonly Place[];
  prefs: Preferences;
  week: Week;
  /** Arena's "understood" mark, per file id. */
  understood?: (id: string) => boolean;
  /** Charter `vote_budget.matters_per_week`, when present. */
  budget?: number | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A file's topics as the public list names them: the Esch theme and the Chamber committee. */
export function topicsOf(item: PublicItem): string[] {
  return [...new Set([text(item.theme), text(item.committee)].filter((t): t is string => t !== null))];
}

/** Every topic in the list, sorted by code point so every device shows the same order. */
export function topicList(items: readonly PublicItem[]): string[] {
  return [...new Set(items.flatMap(topicsOf))].sort(compare);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every dated thing the public list says about a file, as (day, kind). */
function events(item: PublicItem): { day: string; kind: WhenKind }[] {
  const out: { day: string; kind: WhenKind }[] = [];
  const add = (value: unknown, kind: WhenKind) => {
    const day = dayOf(value as string | null);
    if (day) out.push({ day, kind });
  };
  for (const m of item.agenda ?? []) add(m?.date, "meeting");
  add(item.deposited, "filed");
  for (const a of item.activities ?? []) add(a?.date, "activity");
  add(item.updated, "activity");
  add(item.opens, "open");
  add(item.closes, "open");
  return out;
}

/**
 * A consultation that gives no closing date counts as open in the week it opened and the
 * `OPEN_ENDED_WEEKS - 1` weeks after it, then drops out: the list cannot tell whether it is
 * still open, and must not show it every week forever.
 */
export const OPEN_ENDED_WEEKS = 4;

const WEEK_MS = 7 * 86_400_000;

/** Whole weeks from the week containing `day` to `week` (0 for the same week). */
const weeksSince = (day: string, week: Week): number => Math.round((Date.parse(week.start) - Date.parse(isoWeek(day).start)) / WEEK_MS);

/**
 * When a file shows in `week`: its first event in the week; a consultation that opened before
 * and closes after the week counts from Monday (one without a closing date only for
 * `OPEN_ENDED_WEEKS` weeks from the week it opened). `undefined` means it has dates, none this week.
 */
export function whenIn(item: PublicItem, week: Week): Entry<PublicItem>["when"] | undefined {
  const all = events(item);
  if (all.length === 0) return null;
  const hits = all.filter((e) => inWeek(e.day, week));
  const opens = dayOf(item.opens ?? null);
  const closes = dayOf(item.closes ?? null);
  const stillOpen = closes === null ? opens !== null && weeksSince(opens, week) < OPEN_ENDED_WEEKS : closes > week.end;
  if (opens && opens < week.start && stillOpen) hits.push({ day: week.start, kind: "open" });
  if (hits.length === 0) return undefined;
  hits.sort((a, b) => compare(a.day, b.day) || WHEN_ORDER.indexOf(a.kind) - WHEN_ORDER.indexOf(b.kind));
  return hits[0];
}

/** Dated files by day, then why, then id; files without any date last, by id. */
function order<T extends PublicItem>(a: Entry<T>, b: Entry<T>): number {
  if (a.when && b.when) {
    return compare(a.when.day, b.when.day) || WHEN_ORDER.indexOf(a.when.kind) - WHEN_ORDER.indexOf(b.when.kind) || compare(a.item.id, b.item.id);
  }
  if (a.when) return -1;
  if (b.when) return 1;
  return compare(a.item.id, b.item.id);
}

/**
 * The resident's list for `week`. Each file appears in one section only: concerned first, then
 * knowledgeable, else others. A file whose place Charter does not know never counts as concerned.
 */
export function buildWeek<T extends PublicItem>(input: BuildInput<T>): WeeklyList<T> {
  const index = indexPlaces(input.places);
  const home = input.prefs.home && index.has(input.prefs.home) ? input.prefs.home : null;
  const mine = new Set(home ? containingPlaces(home, index) : []);
  const follows = new Set(input.prefs.topics);
  const understood = input.understood ?? (() => false);

  const list: WeeklyList<T> = {
    week: input.week,
    concerned: [],
    knowledgeable: [],
    judge: [],
    others: [],
    outside: 0,
    budget: typeof input.budget === "number" && Number.isSafeInteger(input.budget) && input.budget >= 0 ? input.budget : null,
  };
  const seen = new Set<string>();
  for (const item of input.items) {
    if (seen.has(item.id)) continue; // a file listed twice shows once
    seen.add(item.id);
    const when = whenIn(item, input.week);
    if (when === undefined) {
      list.outside++;
      continue;
    }
    const place = charterIdOf(item.jurisdiction_id, index);
    const entry: Entry<T> = {
      item,
      when,
      onTopic: topicsOf(item).some((t) => follows.has(t)),
      understood: understood(item.id),
    };
    if (place !== null && mine.has(place)) list.concerned.push(entry);
    else if (entry.onTopic) list.knowledgeable.push(entry);
    else list.others.push(entry);
  }
  list.concerned.sort(order);
  list.knowledgeable.sort(order);
  list.others.sort(order);
  return list;
}
