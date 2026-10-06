import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildQuiz, groundingProblems, quizProblems, ruleQuestions, SEED, shuffled, textIn, titleSnippet, type SourceItem } from "../src/index.ts";

const SNAPSHOT = JSON.parse(readFileSync(new URL("./fixtures/docket-recorded.json", import.meta.url), "utf8")) as { items: SourceItem[] };
const ITEMS = SNAPSHOT.items;
const get = (id: string) => ITEMS.find((i) => i.id === id)!;

describe("rule questions", () => {
  it("every item of the recorded snapshot gets a well-formed, grounded quiz of 3 to 5 questions", () => {
    const sizes: Record<string, number> = {};
    for (const item of ITEMS) {
      const quiz = buildQuiz(item, ITEMS);
      expect(quiz, item.id).not.toBeNull();
      expect(quizProblems(quiz)).toEqual([]);
      expect(groundingProblems(quiz!, item)).toEqual([]);
      sizes[item.id] = quiz!.questions.length;
    }
    expect(Object.values(sizes).reduce((a, b) => a + b, 0)).toBe(40);
  });

  it("are the same whatever order the snapshot lists its items in", () => {
    for (const item of ITEMS) expect(ruleQuestions(item, [...ITEMS].reverse())).toEqual(ruleQuestions(item, ITEMS));
  });

  it("offer only text from other files as wrong options, never this file's own", () => {
    for (const item of ITEMS) {
      for (const q of ruleQuestions(item, ITEMS)) {
        const right = q.options.find((o) => o.id === q.answer)!;
        expect(Object.values(right.text)[0]).toContain(q.evidence[0].quote);
        for (const o of q.options.filter((o) => o.id !== q.answer)) {
          const text = Object.values(o.text)[0]!.replace(/…$/, "");
          if (q.id === "vote") continue;
          const field = q.evidence[0].field;
          const own = field.startsWith("title") ? Object.values(item.title)[0]! : String(item[field.split(".")[0] as keyof SourceItem] ?? "");
          expect(own, `${item.id} ${q.id}`).not.toBe(text);
          expect(ITEMS.some((other) => other.id !== item.id && JSON.stringify(other).includes(JSON.stringify(text).slice(1, -1).slice(0, 20)))).toBe(true);
        }
      }
    }
  });

  it("never offer two steps that mean the same thing (Nomination / Désignation d'un rapporteur)", () => {
    const agenda = ruleQuestions(get("lu.chd.8821"), ITEMS).find((q) => q.id === "agenda")!;
    const texts = agenda.options.map((o) => o.text.fr);
    expect(texts[0]).toBe("Désignation d'un rapporteur");
    expect(texts.join()).not.toMatch(/Nomination/);
  });

  it("put council points next to council points, not Chamber files", () => {
    const kind = ruleQuestions(get("lu.esch.42090"), ITEMS).find((q) => q.id === "kind")!;
    expect(kind.options.map((o) => o.text.fr)).toEqual(["Devis", "Conventions", "Crédits Spéciaux"]);
  });

  it("ask about the council vote with the other counts as wrong options", () => {
    const vote = ruleQuestions(get("lu.esch.42063"), ITEMS).find((q) => q.id === "vote")!;
    expect(vote.options.map((o) => o.text.en)).toEqual(["11", "8", "19"]);
    expect(vote.evidence).toEqual([{ field: "votes.counts.Oui", quote: "11", url: get("lu.esch.42063").urls.fr }]);
  });

  it("give no quiz for a file without an official page or with too little to ask", () => {
    const bare = { ...get("lu.chd.8821"), urls: {} };
    expect(ruleQuestions(bare, ITEMS)).toEqual([]);
    expect(buildQuiz(bare, ITEMS)).toBeNull();
    expect(buildQuiz(get("lu.chd.8821"), [get("lu.chd.8821")])).toBeNull();
  });

  it("cut long titles at a word and short council subjects keep the whole title", () => {
    const long = titleSnippet(get("lu.chd.8752").title.fr!);
    expect(long.cut).toBe(true);
    expect(long.quote.length).toBeLessThanOrEqual(140);
    expect(get("lu.chd.8752").title.fr).toContain(long.quote);
    expect(titleSnippet("PAP Quai Neiduerf ; décision")).toEqual({ quote: "PAP Quai Neiduerf ; décision", cut: false });
    expect(titleSnippet("Relevé et rôle supplétif de l'impôt foncier ; décision")).toEqual({ quote: "Relevé et rôle supplétif de l'impôt foncier", cut: true });
  });
});

describe("buildQuiz", () => {
  it("puts seed questions first and lets a seed question take a rule's place", () => {
    const quiz = buildQuiz(get("lu.esch.42063"), ITEMS)!;
    expect(quiz.questions.map((q) => `${q.origin}:${q.id}`)).toEqual(["seed:about", "seed:vote", "rules:kind", "rules:theme", "rules:status"]);
  });

  it("drops a seed question whose quote is no longer in the file, and fills from the rules", () => {
    const changed = { ...get("lu.esch.42063"), votes: { counts: { Oui: 12, Non: 7 } } };
    const quiz = buildQuiz(changed, ITEMS)!;
    expect(quiz.questions.map((q) => `${q.origin}:${q.id}`)).toEqual(["seed:about", "rules:kind", "rules:theme", "rules:vote", "rules:status"]);
    expect(groundingProblems(quiz, changed)).toEqual([]);
  });

  it("keeps only the first of two seed questions with the same id", () => {
    const seed = structuredClone(SEED);
    const [q] = seed.items["lu.esch.42063"];
    seed.items["lu.esch.42063"] = [q, structuredClone(q)];
    const quiz = buildQuiz(get("lu.esch.42063"), ITEMS, seed)!;
    const ids = quiz.questions.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(quizProblems(quiz)).toEqual([]);
  });

  it("drops a malformed seed question", () => {
    const seed = structuredClone(SEED);
    seed.items["lu.esch.42052"][0].answer = "z";
    expect(buildQuiz(get("lu.esch.42052"), ITEMS, seed)!.questions.map((q) => q.id)).not.toContain("seed-partner");
  });
});

describe("textIn and shuffled", () => {
  it("falls back to the nearest language and says which one it used", () => {
    expect(textIn({ en: "Hello", fr: "Bonjour", de: "Hallo" }, "lb")).toEqual({ text: "Hallo", lang: "de" });
    expect(textIn({ en: "Hello", fr: "Bonjour" }, "pt")).toEqual({ text: "Bonjour", lang: "fr" });
    expect(textIn({ fr: "Bonjour" }, "en")).toEqual({ text: "Bonjour", lang: "fr" });
    expect(textIn({ pt: "Olá" }, "en")).toEqual({ text: "Olá", lang: "pt" });
  });
  it("is a fixed permutation for a seed and varies across attempts", () => {
    const list = ["a", "b", "c", "d"];
    expect(shuffled(list, "x:1")).toEqual(shuffled(list, "x:1"));
    expect([...shuffled(list, "x:1")].sort()).toEqual(list);
    const orders = new Set(Array.from({ length: 12 }, (_, i) => shuffled(list, `x:${i}`).join("")));
    expect(orders.size).toBeGreaterThan(3);
  });
});
