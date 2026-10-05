/** Where the app gets the Docket snapshot, and the derived facts the screens show. */

import type { DocketItem, DocketSnapshot } from "@democracy2/companion";

/**
 * The single-file demo carries its snapshot inside the page; the served app fetches it.
 * Either way the browser only ever reads data Docket already published.
 */
export async function loadSnapshot(doc: Document = document, fetcher: typeof fetch = fetch): Promise<DocketSnapshot> {
  const embedded = doc.getElementById("snapshot");
  if (embedded?.textContent?.trim()) return JSON.parse(embedded.textContent) as DocketSnapshot;
  const res = await fetcher("data/snapshot.json");
  if (!res.ok) throw new Error(`snapshot: ${res.status}`);
  return (await res.json()) as DocketSnapshot;
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

/** Files with a meeting coming up first (soonest first), then the most recently updated. */
export function sortItems(items: DocketItem[], today: string): DocketItem[] {
  const key = (i: DocketItem) => nextMeeting(i, today)?.date ?? "9999";
  return [...items].sort((a, b) => key(a).localeCompare(key(b)) || (b.updated ?? "").localeCompare(a.updated ?? ""));
}

/** Only web links from the snapshot become clickable. */
export function safeUrl(url: string | null | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

export function titleOf(item: DocketItem): string {
  return item.title.fr ?? Object.values(item.title)[0] ?? item.number;
}

/** Status values the site leaves as internal placeholders are not shown. */
export function statusOf(item: DocketItem): string | null {
  return item.status && !item.status.startsWith("CHD_") ? item.status : null;
}

export function matches(item: DocketItem, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return fold(`${item.number} ${titleOf(item)} ${item.author ?? ""} ${item.committee ?? ""}`).includes(q);
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
