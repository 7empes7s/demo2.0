/**
 * Places: Charter's jurisdiction list (`charter/data/lu-jurisdictions.json`), read as a tree.
 * A resident who lives in a place is concerned by files of that place and of every place that
 * contains it (Esch-sur-Alzette: the commune, its canton, the country).
 */

/** One Charter jurisdiction, the fields Pulse reads. */
export interface Place {
  id: string;
  parent_id?: string | null;
  kind: string;
  name?: Record<string, string>;
}

/**
 * Docket ids that are not Charter ids yet. Docket snapshot/2 labels Esch-sur-Alzette files
 * `lu-esch`; Charter calls the commune `lu-commune-esch-sur-alzette`. Until Docket emits Charter
 * ids, this table is the only bridge. An id missing from both is "unknown place": such a file
 * never counts as concerning anyone.
 */
export const DOCKET_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "lu-esch": "lu-commune-esch-sur-alzette",
});

export type PlaceIndex = ReadonlyMap<string, Place>;

export function indexPlaces(places: readonly Place[]): PlaceIndex {
  const index = new Map<string, Place>();
  for (const p of places) {
    if (index.has(p.id)) throw new Error(`place ${JSON.stringify(p.id)} given twice`);
    index.set(p.id, p);
  }
  return index;
}

/** The Charter id for a jurisdiction id from the public list, or null when it is unknown. */
export function charterIdOf(id: string, index: PlaceIndex): string | null {
  if (index.has(id)) return id;
  const alias = Object.hasOwn(DOCKET_ALIASES, id) ? DOCKET_ALIASES[id] : undefined;
  return alias !== undefined && index.has(alias) ? alias : null;
}

/**
 * The place and every place containing it, innermost first. Unknown places give []. A parent
 * that is missing or a loop in the data ends the chain instead of looping.
 */
export function containingPlaces(id: string, index: PlaceIndex): string[] {
  const chain: string[] = [];
  let current: string | null | undefined = index.has(id) ? id : null;
  while (current && index.has(current) && !chain.includes(current)) {
    chain.push(current);
    current = index.get(current)?.parent_id;
  }
  return chain;
}

/** Places a resident can say they live in: communes first, then regions (for communes Charter does not list yet). */
export function homeChoices(places: readonly Place[]): { communes: Place[]; regions: Place[] } {
  const byId = (a: Place, b: Place) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    communes: places.filter((p) => p.kind === "commune").sort(byId),
    regions: places.filter((p) => p.kind === "region").sort(byId),
  };
}

/**
 * A place's name in `lang`, else in the nearest language Charter has (lb: de, fr; pt: fr, en;
 * others: fr, en), else any name, else "". Never the raw id.
 */
export function placeName(place: Place | undefined, lang: string): string {
  const names = place?.name ?? {};
  const order = [lang, ...(lang === "lb" ? ["de", "fr"] : lang === "pt" ? ["fr", "en"] : ["fr", "en"])];
  for (const l of order) if (names[l]) return names[l];
  return Object.values(names)[0] ?? "";
}
