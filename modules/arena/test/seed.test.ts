import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { questionGroundingProblems, questionProblems, SEED, type SourceItem } from "../src/index.ts";

const SNAPSHOT = JSON.parse(readFileSync(new URL("./fixtures/docket-recorded.json", import.meta.url), "utf8")) as { items: SourceItem[] };
const byId = new Map(SNAPSHOT.items.map((i) => [i.id, i]));
const entries = Object.entries(SEED.items).flatMap(([id, qs]) => qs.map((q) => [id, q] as const));

/** Words that would turn a question about the text into a question about opinions. */
const LOADED = /\b(should|ought|best|better|worse|correct|wrong|good|bad|fair|unfair|right to)\b/i;

describe("seed set (recorded snapshot)", () => {
  it("covers real items of the recorded snapshot", () => {
    expect(Object.keys(SEED.items).length).toBeGreaterThanOrEqual(3);
    for (const id of Object.keys(SEED.items)) expect(byId.has(id), id).toBe(true);
    expect(SEED.generator).toBe("arena.seed/1");
  });

  for (const [id, q] of entries) {
    describe(`${id} ${q.id}`, () => {
      it("is well formed and every quote is word for word in the recorded file", () => {
        expect(questionProblems(q)).toEqual([]);
        expect(questionGroundingProblems(byId.get(id)!, q)).toEqual([]);
        expect(q.origin).toBe("seed");
        expect(q.generator).toBe(SEED.generator);
      });
      it("is written in English, French and German, prompt and options alike", () => {
        for (const text of [q.prompt, ...q.options.map((o) => o.text)]) {
          expect(Object.keys(text).sort()).toEqual(["de", "en", "fr"]);
        }
      });
      it("asks what the text says, not what anyone should think", () => {
        for (const text of [q.prompt.en!, ...q.options.map((o) => o.text.en!)]) expect(text).not.toMatch(LOADED);
      });
    });
  }
});
