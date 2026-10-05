/** Where the app gets the Docket snapshot, and the derived facts the screens show. */

import { readSnapshot, type DocketItem, type DocketSnapshot } from "@democracy2/companion";

/**
 * The single-file demo carries its snapshot inside the page; the served app fetches it.
 * Either way the browser only ever reads data Docket already published.
 */
export async function loadSnapshot(doc: Document = document, fetcher: typeof fetch = fetch): Promise<DocketSnapshot> {
  const embedded = doc.getElementById("snapshot");
  if (embedded?.textContent?.trim()) return readSnapshot(JSON.parse(embedded.textContent));
  const res = await fetcher("data/snapshot.json");
  if (!res.ok) throw new Error(`snapshot: ${res.status}`);
  return readSnapshot(await res.json());
}

/** Which body a file belongs to. Snapshot/1 only has the Chamber. */
export type Place = "chamber" | "esch";
export const placeOf = (item: DocketItem): Place => (item.jurisdiction_id === "lu-esch" ? "esch" : "chamber");
/** The order places are listed in: the Chamber first, so one council session's ~70 points don't bury it. */
export const PLACES: Place[] = ["chamber", "esch"];

/** The places present in the list, in display order. The place filter shows only for 2 or more. */
export function placesOf(items: DocketItem[]): Place[] {
  const present = new Set(items.map(placeOf));
  return PLACES.filter((p) => present.has(p));
}

export type TypeFilter = "all" | "bill" | "other";

/**
 * The list as shown: filtered by type, place and search, sorted, then grouped by place in
 * PLACES order. With one place (or one picked) there is one group.
 */
export function groupFiles(
  items: DocketItem[],
  today: string,
  opts: { filter: TypeFilter; place: "all" | Place; query: string },
): { place: Place; items: DocketItem[] }[] {
  const shown = sortItems(items, today).filter(
    (i) =>
      (opts.filter === "all" || (opts.filter === "bill" ? i.type === "bill" : i.type !== "bill")) &&
      (opts.place === "all" || placeOf(i) === opts.place) &&
      matches(i, opts.query),
  );
  return PLACES.map((place) => ({ place, items: shown.filter((i) => placeOf(i) === place) })).filter((g) => g.items.length);
}

/** A Chamber file, a point on the Esch council's agenda, or an Esch consultation. */
export type Kind = "chamber" | "council" | "consultation";
export function kindOf(item: DocketItem): Kind {
  if (placeOf(item) === "chamber") return "chamber";
  return item.type === "agenda" ? "council" : "consultation";
}

/**
 * The address of a file in the page (`#8739`). Chamber files keep their dossier number, so old
 * links still work; Esch point numbers repeat from one session to the next, so Esch files use
 * their Docket id without the country prefix.
 */
export function routeOf(item: DocketItem): string {
  return kindOf(item) === "chamber" && item.number ? item.number : item.id.replace(/^lu\./, "");
}

/** The sites the snapshot was read from, for the data note. */
export function sitesOf(snapshot: DocketSnapshot): string {
  const site: Record<string, string> = { chd: "chd.lu", esch: "esch.lu" };
  const names = (snapshot.sources ?? []).map((s) => site[s.id] ?? s.url ?? s.id).filter(Boolean);
  return names.length ? names.join(", ") : "chd.lu";
}

/**
 * Council vote values are published in French; the known ones are translated. A missing vote
 * (null, or the "" / "null" key it is counted under) is "no vote recorded", never the text "null".
 */
export function voteKey(value: string | null): "vote_yes" | "vote_no" | "vote_abstain" | "vote_none" | null {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "" || v === "null") return "vote_none";
  if (v === "oui") return "vote_yes";
  if (v === "non") return "vote_no";
  if (v.startsWith("abst")) return "vote_abstain";
  return null;
}

export type Stage = "filed" | "committee" | "opinions" | "vote";
export const STAGES: Stage[] = ["filed", "committee", "opinions", "vote"];

/**
 * How far a file has gone, from what the Chamber publishes. A file reaches "opinions" once any
 * formal opinion (avis) is filed, and "vote" once the history mentions a vote in plenary.
 */
export function stageOf(item: DocketItem): Stage {
  // "Adoption d'un projet de rapport" is a committee step, so only an actual vote counts.
  if (item.activities.some((a) => /\bvote\b/i.test(`${a.kind} ${a.description}`))) return "vote";
  if (item.documents.some((d) => d.kind === "avis") || item.activities.some((a) => a.kind === "Avis")) return "opinions";
  const status = (item.status ?? "").toLowerCase();
  if (status.includes("commission") || item.committee || item.agenda.length) return "committee";
  return "filed";
}

/** The next agenda entry on or after `today` (YYYY-MM-DD in Luxembourg time), if any. */
export function nextMeeting(item: DocketItem, today: string) {
  return item.agenda
    .filter((m) => (m.date ?? "") >= today)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
}

export function luxembourgToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Luxembourg" }).format(now);
}

/** The latest agenda entry before `today`, for files whose meeting has passed. */
export function lastMeeting(item: DocketItem, today: string) {
  return item.agenda
    .filter((m) => m.date && m.date < today)
    .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`))[0];
}

/** Files with a meeting coming up first (soonest first), then the most recently updated or discussed. */
export function sortItems(items: DocketItem[], today: string): DocketItem[] {
  const key = (i: DocketItem) => nextMeeting(i, today)?.date ?? "9999";
  const recent = (i: DocketItem) => i.updated ?? lastMeeting(i, today)?.date ?? "";
  return [...items].sort((a, b) => key(a).localeCompare(key(b)) || recent(b).localeCompare(recent(a)));
}

/** Only web links from the snapshot become clickable. */
export function safeUrl(url: string | null | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

export function titleOf(item: DocketItem): string {
  return item.title.fr ?? Object.values(item.title)[0] ?? item.number ?? "";
}

/** Status values the site leaves as internal placeholders are not shown. */
export function statusOf(item: DocketItem): string | null {
  return item.status && !item.status.startsWith("CHD_") ? item.status : null;
}

export function matches(item: DocketItem, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const words = [item.number, titleOf(item), item.author, item.committee, item.reference, item.theme, item.summary];
  return fold(words.filter(Boolean).join(" ")).includes(q);
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Text the Chamber's page leaves in history rows (screen-reader button labels). */
const PAGE_NOISE = /\s*Bouton graphique servant à afficher ou cacher tous les éléments de la liste qui précède\s*(Voir plus)?\s*(Voir moins)?/gi;

/** History rows worth showing, newest first, without the page's button text. */
export function historyOf(item: DocketItem) {
  return item.activities
    .map((a) => ({ ...a, description: a.description.replace(PAGE_NOISE, " ").replace(/\s+/g, " ").trim() }))
    .filter((a) => a.description)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
