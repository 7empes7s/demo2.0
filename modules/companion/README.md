# Companion

The core of the citizen app. Given one file from the Docket snapshot, it can:

| Ability | What the resident gets | How it stays honest |
|---|---|---|
| `explain` | A plain-language explanation in lb, fr, de, en or pt, at short, standard or deep depth | Every factual sentence cites a numbered source and quotes it; a sentence is marked verified only when the quote is found word for word in that source |
| `extractArguments` | The arguments named institutions make in the file's own documents (the Commons seed for Phase 1) | Arguments whose quote isn't in the cited source are dropped |
| `challenge` | A devil's advocate that argues the other side from those arguments | It may rephrase, never invent; each turn reports whether it was grounded in a listed argument |
| `checkClaim` | Green / yellow / red for a claim the resident heard, with quotes | Green or red needs at least one verified quote, otherwise the grade drops to yellow |

Prompts are versioned (`PROMPT_VERSION`) and every answer records the prompt version, model and item it came from. The Companion never recommends how to vote.

## Server

```
SNAPSHOT=data/lu-chd.json ANTHROPIC_API_KEY=... STATIC_DIR=apps/citizen/dist npm run serve -w @democracy2/companion
```

One process serves the app, `/data/snapshot.json`, `/healthz` and `POST /api/{explain,arguments,challenge,claim}`. The browser names an item; the server builds the prompt, so the key can't be used as a general model proxy. Model calls are rate limited per client and explanations are cached.

`POST /api/factcheck` `{text, item_id?}` checks a claim with the Provenance service (`PROVENANCE_URL`, default `http://127.0.0.1:8090`) over HTTP and needs no model key. It answers `{result: "graded", grade}` (a `Grade` from `spec/schemas/grade.schema.json`) or `{result: "no_record"}` when no record mentions the claim. With `item_id` the claim is checked against that file. A claim over 500 characters or a body over 4 KiB is refused (413), never cut. Provenance unreachable, failing or slower than 8 s: 503. An answer that does not match the schema: 502, never shown. Rate limited like the model routes. `gradeProblems` (exported) checks a value against the schema file itself.

Licence: held (see LICENSE).
