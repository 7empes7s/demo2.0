import { describe, expect, it } from "vitest";

import { readSnapshot } from "../src/snapshot.ts";
import { buildSources, dossierFacts } from "../src/sources.ts";
import { ESCH_CONSULTATION, ESCH_POINT, ITEM } from "./fixtures.ts";

const v1 = {
  schema: "d2.docket.snapshot/1",
  generated_at: "2026-02-01T00:00:00Z",
  source: { name: "Chambre des Députés", url: "https://example.org/fr/agenda", sha256: "ab" },
  meetings: [{ id: "m1", date: "2026-02-10", time: "10:00", body: "Commission", points: [] }],
  items: [ITEM],
  errors: [{ number: "0002", error: "timeout" }],
};

const v2 = {
  schema: "d2.docket.snapshot/2",
  generated_at: "2026-10-05T00:00:00Z",
  sources: [
    { id: "chd", name: "Chambre des Députés", url: "https://example.org/fr/agenda", sha256: "ab" },
    { id: "esch", name: "Ville d'Esch-sur-Alzette", url: "https://example.org/seances", sha256: "cd" },
  ],
  meetings: [{ source: "esch.lu", id: "esch-1", date: "2026-10-02", time: "08:30", body: "Conseil communal", points: [] }],
  items: [ITEM, ESCH_POINT, ESCH_CONSULTATION],
  errors: [],
};

describe("reading the Docket snapshot", () => {
  it("turns a /1 snapshot's single source into a sources list", () => {
    const s = readSnapshot(v1);
    expect(s.schema).toBe("d2.docket.snapshot/2"); // served with the label of the shape it has
    expect(s.sources).toEqual([{ id: "chd", name: "Chambre des Députés", url: "https://example.org/fr/agenda", sha256: "ab" }]);
    expect(s.meetings?.[0].source).toBe("chd.lu");
    expect(s.errors?.[0]).toMatchObject({ source: "chd.lu", number: "0002" });
    expect(s.items).toEqual([ITEM]);
  });

  it("keeps a /2 snapshot as it is", () => {
    const s = readSnapshot(v2);
    expect(s.sources?.map((x) => x.id)).toEqual(["chd", "esch"]);
    expect(s.items.map((i) => i.id)).toEqual([ITEM.id, ESCH_POINT.id, ESCH_CONSULTATION.id]);
    expect(s.meetings?.[0].source).toBe("esch.lu");
  });

  it("refuses an unknown schema or a snapshot without items", () => {
    expect(() => readSnapshot({ ...v2, schema: "d2.docket.snapshot/3" })).toThrow(/unsupported/);
    expect(() => readSnapshot({ schema: "d2.docket.snapshot/2" })).toThrow(/items/);
    expect(() => readSnapshot(null)).toThrow(/unsupported/);
  });
});

describe("sources for Esch items", () => {
  it("names the council point and gives its reference, theme and vote", () => {
    const [first, ...rest] = buildSources(ESCH_POINT, "en");
    expect(first.label).toBe("Esch-sur-Alzette municipal council, agenda point 3");
    expect(first.text).toContain("Reference: 2026/123");
    expect(first.text).toContain("Council vote: Oui 11, Non 8");
    expect(rest).toEqual([]); // documents listed by link only have no text to cite
  });

  it("describes a consultation without a number", () => {
    const facts = dossierFacts(ESCH_CONSULTATION);
    expect(facts).not.toContain("Number:");
    expect(facts).toContain("Closes: 2026-10-30");
    expect(buildSources(ESCH_CONSULTATION, "fr")[0].label).toBe("Esch-sur-Alzette participation, Enquête");
  });
});
