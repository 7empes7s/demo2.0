/** Put a quiz together for one item, and the small helpers a player needs. */

import seedSet from "../seed/recorded-v0.json" with { type: "json" };
import { hash, ruleQuestions } from "./rules.ts";
import type { Lang, LocalizedText, Question, Quiz, SourceItem } from "./types.ts";
import { questionGroundingProblems, questionProblems } from "./validate.ts";

export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 5;

export interface SeedSet {
  generator: string;
  about: string;
  items: Record<string, Question[]>;
}

export const SEED: SeedSet = seedSet as SeedSet;

/** A question is shown only when it is well formed and every quote is in this item, word for word. */
export function usable(item: SourceItem, q: Question): boolean {
  return questionProblems(q).length === 0 && questionGroundingProblems(item, q).length === 0;
}

/**
 * The quiz for an item: hand-written seed questions first, then rule questions, at most 5.
 * A seed question with the same id as a rule question takes its place. Any question whose
 * quote is not found in the item (the file changed since the seed was written) is dropped.
 * Null when fewer than 3 questions remain: no quiz is better than a thin one.
 */
export function buildQuiz(item: SourceItem, all: SourceItem[], seed: SeedSet = SEED): Quiz | null {
  const seeded = (Object.hasOwn(seed.items, item.id) ? seed.items[item.id] : []).filter((q) => usable(item, q));
  const taken = new Set(seeded.map((q) => q.id));
  const ruled = ruleQuestions(item, all).filter((q) => !taken.has(q.id) && usable(item, q));
  const questions = [...seeded, ...ruled].slice(0, MAX_QUESTIONS);
  if (questions.length < MIN_QUESTIONS) return null;
  return { id: `${item.id}:arena/1`, item_id: item.id, questions };
}

/** Which languages to try, in order, for each reading language. Source text is French. */
const FALLBACK: Record<Lang, Lang[]> = {
  lb: ["lb", "de", "fr", "en"],
  fr: ["fr", "en"],
  de: ["de", "fr", "en"],
  en: ["en", "fr"],
  pt: ["pt", "fr", "en"],
};

/** The text in the reader's language if there is one, else the nearest language there is, and which one that is. */
export function textIn(text: LocalizedText, lang: Lang): { text: string; lang: Lang } {
  for (const l of FALLBACK[lang]) {
    const t = text[l];
    if (t) return { text: t, lang: l };
  }
  const [l, t] = Object.entries(text).find(([, v]) => v) as [Lang, string];
  return { text: t, lang: l };
}

/** The options in a fresh order for each attempt, so an answer is never "always the first one". */
export function shuffled<T>(list: T[], seed: string): T[] {
  return list
    .map((value, i) => ({ value, key: hash(`${seed}\0${i}`) }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.value);
}
