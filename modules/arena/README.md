# Arena (`@democracy2/arena`)

Comprehension checks: 3 to 5 quick questions on what one Docket file's official text says, each
answer shown with the passage it is quoted from and a link to it. This is Arena v1 (see
`docs/architecture/01-modules.md`, module 10); the scenario game and badges come later.

A TypeScript library with no server and no network access. The citizen app runs it in the browser.

## Where the questions come from

The live box has no model key, so v1 uses no model at all.

| Source | What it is | Version |
|---|---|---|
| Rules (`src/rules.ts`) | Fixed rules ask about fields every file page shows: what the file is about (its title), how the page classifies it, its committee (Chamber), its theme (Esch), a step on its agenda, how many council members voted yes (Esch), its status. The option the text supports is copied from that field. The other options are the same field taken from other files in the same snapshot, so every option is real text from an official page. The same item and snapshot always give the same questions. | `arena.rules/1` |
| Seed set (`seed/recorded-v0.json`) | 8 hand-written questions on 3 files of the recorded snapshot (`test/fixtures/docket-recorded.json`: chd.lu dossier 8752, Esch-sur-Alzette council of 2 October 2026 points 6.1 and 7.1), about what the text does, not only its labels. In English, French and German. Written by the Arena builder; not yet signed off by advocates of each side. | `arena.seed/1` |

`buildQuiz(item, allItems)` puts seed questions first, then rule questions, at most 5. A seed
question whose id matches a rule (`about`, `agenda`, `vote`) takes that rule's place. Fewer than 3
questions means no quiz: the app then shows nothing.

## Grounding (never invented facts)

Every question carries `evidence`: a dotted path to a field of the Docket item (`title.fr`,
`agenda.0.steps.1`, `votes.counts.Oui`), a quote, and a link. `groundingProblems` checks that each
quote is found word for word in that field (a number must match whole) and that each link is one
the item itself publishes (its page, its documents, or the documents in its history).
`buildQuiz` drops any question that fails, so when a file changes after a seed question was
written, the stale question disappears instead of showing a quote that is no longer there.

Wrong options are, by definition, things the text does not say. Rule questions take them from
other files; seed questions use plainly unrelated or contradicted alternatives, never invented
legal citations or figures presented as real.

## Neutral

Questions ask what the text says (what it changes, who handles it, how the council voted),
never what anyone should think of it. The seed test rejects loaded words (should, best, good,
bad, fair, ...) in prompts and options.

## Languages

Rule prompts are written in all five languages (lb, fr, de, en, pt). Their options are copied
from the source, so they are in French, the language of chd.lu and esch.lu; the app says so.
Seed questions are in English, French and German; `textIn` picks the reader's language, then the
nearest one (lb: de, fr, en; pt: fr, en), and the app says when it fell back.

## Privacy

Nothing in this module talks to a network. The citizen app keeps progress (attempts, best score,
understood) in `localStorage` only, per file, and sends nothing: no per-person data and no
aggregates in v1. Pass-rate monitoring by language and region (the module's "done when") needs an
opt-in, anonymous count channel first; see Deferred in `CHANGELOG.md`.

## Format

`spec/schemas/quiz.schema.json`, with examples in `spec/examples/quiz/`. `quizProblems` checks the
same shape plus what JSON Schema cannot say (the answer is one of the options, ids and option
texts are unique); `test/validate.test.ts` runs it over the spec examples so the two agree.

## Use

```ts
import { buildQuiz, shuffled, textIn } from "@democracy2/arena";
const quiz = buildQuiz(item, snapshot.items); // null when there is too little to ask
```

Check the seed set against another snapshot (a live one, before shipping a seed change):

```sh
npm run check-seed -w @democracy2/arena -- path/to/snapshot.json
```

Tests: `npm test -w @democracy2/arena`.

## Licence

Held (see `LICENSE`), like the other products. The future scenario pool is planned as CC BY-SA.
