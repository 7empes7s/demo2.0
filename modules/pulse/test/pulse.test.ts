import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildWeek, charterIdOf, containingPlaces, dayOf, homeChoices, indexPlaces, isoWeek, luxembourgDate, OPEN_ENDED_WEEKS, placeName, topicList, topicsOf, weekAt, whenIn, type PublicItem } from "../src/index.ts";
import { pulseCharter } from "../src/charter.ts";

// The recorded Docket snapshot (real chd.lu and esch.lu records), as the citizen app loads it.
const recorded = JSON.parse(readFileSync(new URL("./fixtures/docket-recorded.json", import.meta.url), "utf8")) as { items: (PublicItem & { title: unknown })[] };
const ITEMS = recorded.items;
const CHARTER = pulseCharter();
const PLACES = CHARTER.places;
const ESCH = "lu-commune-esch-sur-alzette";
const CITY = "lu-commune-luxembourg";

/** Week 40 of 2026 (28 Sep to 4 Oct): Esch council of 2 October, chd.lu 8752 updated 30 September. */
const W40 = isoWeek("2026-10-01");
/** Week 41 of 2026 (5 to 11 Oct): three Chamber committee meetings. */
const W41 = isoWeek("2026-10-06");

const ids = (entries: { item: { id: string } }[]) => entries.map((e) => e.item.id);

const item = (over: Partial<PublicItem> & { id: string }): PublicItem => ({ jurisdiction_id: "lu", agenda: [], activities: [], ...over });

describe("week window", () => {
  it("is the ISO week, Monday to Sunday", () => {
    expect(isoWeek("2026-10-06")).toEqual({ id: "2026-W41", start: "2026-10-05", end: "2026-10-11" });
    expect(isoWeek("2026-10-05")).toEqual(isoWeek("2026-10-11"));
    expect(isoWeek("2026-10-12").id).toBe("2026-W42");
  });

  it("numbers weeks across year ends the ISO way", () => {
    // 2026 starts on a Thursday, so it has 53 weeks and 1-3 January 2027 belong to its last one.
    expect(isoWeek("2026-12-31")).toEqual({ id: "2026-W53", start: "2026-12-28", end: "2027-01-03" });
    expect(isoWeek("2027-01-03").id).toBe("2026-W53");
    expect(isoWeek("2027-01-04").id).toBe("2027-W01");
    // 29 December 2025 is a Monday whose Thursday is 1 January 2026.
    expect(isoWeek("2025-12-29")).toEqual({ id: "2026-W01", start: "2025-12-29", end: "2026-01-04" });
    expect(isoWeek("2024-02-29").id).toBe("2024-W09");
  });

  it("reads the instant on the Luxembourg calendar", () => {
    // Sunday 4 October 2026, 22:30 UTC, is Monday 00:30 in Luxembourg (CEST, UTC+2).
    expect(luxembourgDate(new Date("2026-10-04T22:30:00Z"))).toBe("2026-10-05");
    expect(weekAt(new Date("2026-10-04T22:30:00Z")).id).toBe("2026-W41");
    expect(weekAt(new Date("2026-10-04T21:59:59Z")).id).toBe("2026-W40");
    // Winter (CET, UTC+1): Sunday 23:00 UTC is already Monday.
    expect(weekAt(new Date("2026-12-27T23:00:00Z")).start).toBe("2026-12-28");
    expect(weekAt(new Date("2026-12-27T22:59:59Z")).start).toBe("2026-12-21");
  });

  it("refuses dates that are not dates", () => {
    expect(() => isoWeek("2026-02-30")).toThrow(RangeError);
    expect(() => isoWeek("6 Oct 2026")).toThrow(RangeError);
  });

  it("reads days from the list's dates and timestamps", () => {
    expect(dayOf("2026-10-08")).toBe("2026-10-08");
    expect(dayOf(" 2026-10-08 ")).toBe("2026-10-08");
    expect(dayOf("2026-10-04T22:30:00Z")).toBe("2026-10-05");
    expect(dayOf("2026-10-04T23:30:00")).toBe("2026-10-04");
    for (const bad of [null, undefined, "", "soon", "2026-13-01", "2026-02-30"]) expect(dayOf(bad)).toBeNull();
  });

  it("includes both ends of the week and nothing outside", () => {
    const at = (date: string) => whenIn(item({ id: date, agenda: [{ date }] }), W41);
    expect(at("2026-10-05")).toEqual({ day: "2026-10-05", kind: "meeting" });
    expect(at("2026-10-11")).toEqual({ day: "2026-10-11", kind: "meeting" });
    expect(at("2026-10-04")).toBeUndefined();
    expect(at("2026-10-12")).toBeUndefined();
  });

  it("takes the first event of the week and treats files without any date apart", () => {
    const busy = item({ id: "a", agenda: [{ date: "2026-10-09" }], activities: [{ date: "2026-10-06" }], updated: "2026-10-06" });
    expect(whenIn(busy, W41)).toEqual({ day: "2026-10-06", kind: "activity" });
    const sameDay = item({ id: "b", agenda: [{ date: "2026-10-06" }], deposited: "2026-10-06" });
    expect(whenIn(sameDay, W41)).toEqual({ day: "2026-10-06", kind: "meeting" });
    expect(whenIn(item({ id: "c", agenda: [{ date: null }], activities: [{ date: "" }] }), W41)).toBeNull();
  });

  it("keeps a consultation that is open across the whole week", () => {
    const open = item({ id: "c", opens: "2026-09-01", closes: "2026-11-30" });
    expect(whenIn(open, W41)).toEqual({ day: "2026-10-05", kind: "open" });
    expect(whenIn(item({ id: "d", opens: "2026-09-21", closes: null }), W41)).toEqual({ day: "2026-10-05", kind: "open" });
    expect(whenIn(item({ id: "e", opens: "2026-09-01", closes: "2026-10-01" }), W41)).toBeUndefined();
    expect(whenIn(item({ id: "f", opens: "2026-10-07", closes: "2026-11-30" }), W41)).toEqual({ day: "2026-10-07", kind: "open" });
  });

  it("shows a consultation without a closing date only for a few weeks after it opened", () => {
    expect(OPEN_ENDED_WEEKS).toBe(4);
    // Opened on Wednesday 16 September (week 38): weeks 38 to 41, then never again.
    const open = item({ id: "g", opens: "2026-09-16", closes: null });
    expect(whenIn(open, isoWeek("2026-09-16"))).toEqual({ day: "2026-09-16", kind: "open" });
    for (const day of ["2026-09-21", "2026-09-28", "2026-10-05"]) expect(whenIn(open, isoWeek(day))).toEqual({ day: isoWeek(day).start, kind: "open" });
    for (const day of ["2026-10-12", "2026-10-19", "2027-06-01"]) expect(whenIn(open, isoWeek(day)), day).toBeUndefined();
    expect(whenIn(open, isoWeek("2026-09-09")), "not before it opened").toBeUndefined();
    // Across a year end (2026-W53).
    const winter = item({ id: "h", opens: "2026-12-31", closes: undefined });
    expect(whenIn(winter, isoWeek("2027-01-18"))).toEqual({ day: "2027-01-18", kind: "open" });
    expect(whenIn(winter, isoWeek("2027-01-25"))).toBeUndefined();
    // Out of the list once the window is over, counted as outside.
    const list = buildWeek({ items: [open], places: PLACES, prefs: { home: null, topics: [] }, week: isoWeek("2026-10-12") });
    expect(list.outside).toBe(1);
    expect(list.others).toEqual([]);
  });
});

describe("places from Charter", () => {
  const index = indexPlaces(PLACES);

  it("loads Charter's places and the weekly budget", () => {
    expect(CHARTER.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CHARTER.budget).toBe(5);
    expect(index.get(ESCH)?.parent_id).toBe("lu-canton-esch-sur-alzette");
  });

  it("walks from a commune up to the country", () => {
    expect(containingPlaces(ESCH, index)).toEqual([ESCH, "lu-canton-esch-sur-alzette", "lu"]);
    expect(containingPlaces("lu-canton-wiltz", index)).toEqual(["lu-canton-wiltz", "lu"]);
    expect(containingPlaces("lu", index)).toEqual(["lu"]);
    expect(containingPlaces("nowhere", index)).toEqual([]);
  });

  it("stops on loops and missing parents", () => {
    const loop = indexPlaces([
      { id: "a", parent_id: "b", kind: "commune" },
      { id: "b", parent_id: "a", kind: "region" },
      { id: "c", parent_id: "gone", kind: "commune" },
    ]);
    expect(containingPlaces("a", loop)).toEqual(["a", "b"]);
    expect(containingPlaces("c", loop)).toEqual(["c"]);
    expect(() => indexPlaces([{ id: "a", kind: "x" }, { id: "a", kind: "y" }])).toThrow(/twice/);
  });

  it("maps Docket's Esch id to Charter's and nothing else", () => {
    expect(charterIdOf("lu-esch", index)).toBe(ESCH);
    expect(charterIdOf("lu", index)).toBe("lu");
    expect(charterIdOf("lu-dudelange", index)).toBeNull();
    expect(charterIdOf("constructor", index)).toBeNull();
  });

  it("offers communes and then cantons, named in the reader's language", () => {
    const { communes, regions } = homeChoices(PLACES);
    expect(communes.map((p) => p.id)).toEqual([ESCH, CITY]);
    expect(regions).toHaveLength(12);
    expect(placeName(index.get(ESCH), "lb")).toBe("Esch-Uelzecht");
    // Cantons are named in French and English only: lb falls back to French, never to the id.
    expect(placeName(index.get("lu-canton-wiltz"), "lb")).toBe("Canton de Wiltz");
    expect(placeName(index.get("lu-canton-wiltz"), "en")).toBe("Wiltz canton");
    expect(placeName(undefined, "en")).toBe("");
  });
});

describe("topics", () => {
  it("are the Esch theme and the Chamber committee, as published", () => {
    expect(topicsOf(item({ id: "x", theme: " Budget et Finances ", committee: null }))).toEqual(["Budget et Finances"]);
    expect(topicsOf(item({ id: "y", committee: "Commission des Finances" }))).toEqual(["Commission des Finances"]);
    expect(topicsOf(item({ id: "z", theme: "", committee: "  " }))).toEqual([]);
  });

  it("list every topic once, in a fixed order", () => {
    const list = topicList(ITEMS);
    expect(list).toContain("Budget et Finances");
    expect(list).toContain("Commission des Finances");
    expect(new Set(list).size).toBe(list.length);
    expect(topicList([...ITEMS].reverse())).toEqual(list);
  });
});

describe("buildWeek", () => {
  const build = (home: string | null, topics: string[], week = W40, understood: string[] = []) =>
    buildWeek({ items: ITEMS, places: PLACES, prefs: { home, topics }, week, understood: (id) => understood.includes(id), budget: CHARTER.budget });

  it("puts Esch council points and Chamber files under concerned for an Esch resident", () => {
    const list = build(ESCH, []);
    expect(ids(list.concerned)).toContain("lu.esch.42063");
    expect(ids(list.concerned)).toContain("lu.chd.8752");
    expect(list.knowledgeable).toEqual([]);
    expect(list.judge).toEqual([]);
    expect(list.budget).toBe(5);
  });

  it("gives a Luxembourg City resident the Chamber, and Esch only on followed topics", () => {
    const list = build(CITY, ["Budget et Finances"]);
    expect(ids(list.concerned)).toEqual(["lu.chd.8752"]);
    expect(ids(list.knowledgeable)).toEqual(["lu.esch.42060", "lu.esch.42090", "lu.esch.42093"]);
    expect(list.knowledgeable.every((e) => e.onTopic)).toBe(true);
    expect(ids(list.others)).toEqual(["lu.esch.42052", "lu.esch.42063", "lu.esch.42071"]);
  });

  it("concerns a canton resident with the country but not with a commune in the canton", () => {
    const list = build("lu-canton-esch-sur-alzette", []);
    expect(ids(list.concerned)).toEqual(["lu.chd.8752"]);
    expect(ids(list.others)).toContain("lu.esch.42063");
  });

  it("shows each file in one section only, and none when nobody said where they live", () => {
    for (const [home, topics] of [[ESCH, ["Budget et Finances", "Commission des Finances"]], [CITY, ["Développement urbain"]], [null, []]] as const) {
      const list = build(home, [...topics]);
      const all = [...ids(list.concerned), ...ids(list.knowledgeable), ...ids(list.others)];
      expect(new Set(all).size).toBe(all.length);
      expect(all.length + list.outside).toBe(ITEMS.length);
    }
    const nobody = build(null, ["Budget et Finances"]);
    expect(nobody.concerned).toEqual([]);
    expect(ids(nobody.knowledgeable)).toHaveLength(3);
    // An unknown home counts as none, never as a crash.
    expect(build("lu-commune-nowhere", []).concerned).toEqual([]);
  });

  it("marks followed topics inside concerned and understood files everywhere", () => {
    const list = build(ESCH, ["Budget et Finances"], W40, ["lu.esch.42063", "lu.chd.8752"]);
    const byId = new Map(list.concerned.map((e) => [e.item.id, e]));
    expect(byId.get("lu.esch.42090")?.onTopic).toBe(true);
    expect(byId.get("lu.esch.42063")?.onTopic).toBe(false);
    expect(byId.get("lu.esch.42063")?.understood).toBe(true);
    expect(byId.get("lu.chd.8752")?.understood).toBe(true);
    expect(byId.get("lu.esch.42090")?.understood).toBe(false);
  });

  it("orders by day, then reason, then id, with undated files last", () => {
    const list = build(ESCH, []);
    expect(ids(list.concerned)).toEqual(["lu.chd.8752", "lu.esch.42052", "lu.esch.42060", "lu.esch.42063", "lu.esch.42071", "lu.esch.42090", "lu.esch.42093"]);
    expect(list.concerned[0].when).toEqual({ day: "2026-09-30", kind: "activity" });

    const undated = [item({ id: "z" }), item({ id: "b", agenda: [{ date: "2026-10-09" }] }), item({ id: "a" }), item({ id: "c", agenda: [{ date: "2026-10-06" }] })];
    const out = buildWeek({ items: undated, places: PLACES, prefs: { home: CITY, topics: [] }, week: W41 });
    expect(ids(out.concerned)).toEqual(["c", "b", "a", "z"]);
    expect(out.concerned.at(-1)?.when).toBeNull();
  });

  it("only lists this week's files and counts the rest", () => {
    const list = build(ESCH, [], W41);
    expect(ids(list.concerned)).toEqual(["lu.chd.8700", "lu.chd.8821", "lu.chd.8752"]);
    expect(list.outside).toBe(6);
  });

  it("is deterministic: input order, duplicates and repeated runs change nothing", () => {
    const a = build(CITY, ["Budget et Finances"]);
    const shuffled = [...ITEMS].reverse();
    const b = buildWeek({ items: [...shuffled, ...shuffled], places: [...PLACES].reverse(), prefs: { home: CITY, topics: ["Budget et Finances"] }, week: W40, understood: () => false, budget: 5 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(build(CITY, ["Budget et Finances"]))).toBe(JSON.stringify(a));
  });

  it("drops a budget that is not a whole number", () => {
    const at = (budget: number | null) => buildWeek({ items: [], places: PLACES, prefs: { home: null, topics: [] }, week: W41, budget }).budget;
    expect(at(5)).toBe(5);
    expect(at(null)).toBeNull();
    expect(at(2.5)).toBeNull();
    expect(at(-1)).toBeNull();
  });
});
