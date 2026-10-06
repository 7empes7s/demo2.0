import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { evidenceGroundingProblems, fieldValue, groundingProblems, quizProblems, type Quiz, type SourceItem } from "../src/index.ts";

const EXAMPLES = new URL("../../../spec/examples/quiz/", import.meta.url).pathname;
const read = (name: string) => JSON.parse(readFileSync(join(EXAMPLES, name), "utf8"));
const VALID = read("valid.json") as Quiz;

/** A synthetic item that matches spec/examples/quiz/valid.json. */
const ITEM: SourceItem = {
  id: "lu.example.1",
  jurisdiction_id: "lu",
  type: "bill",
  type_label: "Projet de loi",
  title: { fr: "Projet de loi relatif aux horaires d'ouverture des bibliothèques" },
  committee: "Commission de la Culture",
  urls: { fr: "https://example.org/dossier/1" },
  agenda: [],
  activities: [],
  documents: [{ url: "https://example.org/session/1" }],
  votes: { counts: { Oui: 10, Non: 5 } },
};

describe("quizProblems agrees with spec/examples/quiz", () => {
  for (const name of readdirSync(EXAMPLES).filter((f) => f.endsWith(".json"))) {
    it(name, () => {
      const problems = quizProblems(read(name));
      if (name.startsWith("invalid-")) expect(problems).not.toEqual([]);
      else expect(problems).toEqual([]);
    });
  }
});

describe("quizProblems catches what JSON Schema cannot", () => {
  const variant = (change: (q: Quiz) => void) => {
    const q = structuredClone(VALID);
    change(q);
    return quizProblems(q);
  };
  it("an answer that names no option", () => {
    expect(variant((q) => (q.questions[0].answer = "z"))).toContain("quiz.questions[0].answer: must name one of the options");
  });
  it("two options with the same text", () => {
    expect(variant((q) => (q.questions[1].options[1].text = { fr: " commission de la culture " })).join()).toMatch(/same as another option/);
  });
  it("repeated option and question ids", () => {
    expect(variant((q) => (q.questions[0].options[1].id = "a")).join()).toMatch(/options\[1\]\.id: repeated/);
    expect(variant((q) => (q.questions[2].id = q.questions[0].id)).join()).toMatch(/questions\[2\]\.id: repeated/);
  });
  it("a language the app does not speak, and a non-object", () => {
    expect(variant((q) => ((q.questions[0].prompt as Record<string, string>).es = "¿Qué?")).join()).toMatch(/prompt\.es/);
    expect(quizProblems(null)).toEqual(["quiz: expected an object"]);
    expect(quizProblems([])).toEqual(["quiz: expected an object"]);
  });
});

describe("grounding", () => {
  it("the valid example is grounded in its item", () => {
    expect(groundingProblems(VALID, ITEM)).toEqual([]);
  });
  it("a quote that is not word for word in the field fails", () => {
    const e = { field: "title.fr", quote: "horaires d'ouverture des musées", url: "https://example.org/dossier/1" };
    expect(evidenceGroundingProblems(ITEM, e)).toEqual(["evidence: quote not found word for word in title.fr"]);
  });
  it("a quote found in another field does not count", () => {
    const e = { field: "committee", quote: "bibliothèques", url: "https://example.org/dossier/1" };
    expect(evidenceGroundingProblems(ITEM, e)).toHaveLength(1);
  });
  it("a number must be quoted whole", () => {
    const e = { field: "votes.counts.Oui", quote: "1", url: "https://example.org/dossier/1" };
    expect(evidenceGroundingProblems(ITEM, e)).toEqual(["evidence: quote not found word for word in votes.counts.Oui"]);
  });
  it("a link the item does not publish fails", () => {
    const e = { field: "committee", quote: "Culture", url: "https://elsewhere.example/page" };
    expect(evidenceGroundingProblems(ITEM, e)).toEqual(["evidence: link is not one the item publishes"]);
  });
  it("a path to an object, a missing field or a built-in is not a field", () => {
    for (const field of ["title", "nope", "title.__proto__", "constructor", "agenda.length", "votes.counts.toString"]) {
      const problems = evidenceGroundingProblems(ITEM, { field, quote: "x", url: "https://example.org/dossier/1" });
      expect(problems.join(), field).toMatch(/is not a text or whole-number field/);
    }
    expect(fieldValue(ITEM, "documents.0.url")).toBe("https://example.org/session/1");
    expect(fieldValue(ITEM, "documents.01.url")).toBeUndefined();
  });
  it("a quiz for another item fails", () => {
    expect(groundingProblems({ ...VALID, item_id: "lu.example.2" }, ITEM)[0]).toMatch(/is not this item/);
  });
});
