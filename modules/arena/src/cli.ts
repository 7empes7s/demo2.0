/**
 * Check the seed set against a Docket snapshot and print, for every item, how many questions
 * its quiz would have. Exit 1 when a seed question for an item in the snapshot is malformed
 * or its quote is not found word for word.
 *
 *   npm run check-seed -w @democracy2/arena -- path/to/snapshot.json
 */

import { readFileSync } from "node:fs";

import { buildQuiz, SEED } from "./quiz.ts";
import type { SourceItem } from "./types.ts";
import { questionGroundingProblems, questionProblems } from "./validate.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: check-seed <snapshot.json>");
  process.exit(2);
}
const items = (JSON.parse(readFileSync(path, "utf8")) as { items: SourceItem[] }).items;
let bad = 0;
for (const item of items) {
  for (const q of Object.hasOwn(SEED.items, item.id) ? SEED.items[item.id] : []) {
    const problems = [...questionProblems(q, `${item.id} ${q.id}`), ...questionGroundingProblems(item, q, `${item.id} ${q.id}`)];
    for (const p of problems) console.error(p);
    bad += problems.length ? 1 : 0;
  }
}
const sizes = items.map((i) => buildQuiz(i, items)?.questions.length ?? 0);
const offered = sizes.filter((n) => n > 0).length;
console.log(`${items.length} items, ${offered} with a quiz, ${sizes.reduce((a, b) => a + b, 0)} questions; ${bad} seed questions failed`);
process.exit(bad ? 1 : 0);
