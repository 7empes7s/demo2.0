# Companion

The core of the citizen app. Given one file from the Docket snapshot, it can:

| Ability | What the resident gets | How it stays honest |
|---|---|---|
| `explain` | A plain-language explanation in lb, fr, de, en or pt, at short, standard or deep depth | Every factual sentence cites a numbered source and quotes it; a sentence is marked verified only when the quote is found word for word in that source |
| `extractArguments` | The arguments named institutions make in the file's own documents (the Commons seed for Phase 1) | Arguments whose quote isn't in the cited source are dropped |
| `challenge` | A devil's advocate that argues the other side, from Commons first, then those arguments | It may rephrase, never invent; each turn lists the arguments it shows with their source links, and labels any point the model wrote itself. With 2 or more Commons reasons on the other side (recorded votes don't count), model-written points are not shown |
| `checkClaim` | Green / yellow / red for a claim the resident heard, with quotes | Green or red needs at least one verified quote, otherwise the grade drops to yellow |

Prompts are versioned (`PROMPT_VERSION`) and every answer records the prompt version, model and item it came from. The Companion never recommends how to vote.

## Server

```
SNAPSHOT=data/lu-chd.json AI_BASE_URL=http://127.0.0.1:11434/v1 AI_MODEL=qwen2.5:7b-instruct STATIC_DIR=apps/citizen/dist npm run serve -w @democracy2/companion
```

### The model

The Companion talks to a model through one interface (`Provider`, `src/provider.ts`) and ships two implementations, neither a vendor SDK:

| Provider | Selected by | Talks to |
|---|---|---|
| `OpenAICompatibleProvider` (default) | `AI_BASE_URL` + `AI_MODEL`, optional `AI_API_KEY`, `AI_HEADERS`, `AI_TIMEOUT_MS` | `POST {AI_BASE_URL}/chat/completions`: Ollama, vLLM, llama.cpp, LM Studio, Groq, OpenRouter, Mistral, Together, and the hosted vendors' compatible endpoints. Local servers need no key. |
| `AnthropicProvider` | `ANTHROPIC_API_KEY` (+ `COMPANION_MODEL`), only when `AI_BASE_URL` is empty | Anthropic's Messages API |

`providerFromEnv()` makes the choice; `/healthz` reports `ai: {kind, model}` (never the address or the key). `LoggingProvider` wraps whichever is chosen and keeps a record of every call: purpose (`explain`, `arguments`, `challenge`, `claim`), model, SHA-256 of the system prompt, sizes, timing and outcome, the last 500 in memory and one JSON line per call appended to `AI_LOG` when set. No resident text and no answer text is ever recorded. The provider's `listModels()` reads the endpoint's `/models`, for an operator checking a new endpoint.

The same `Provider` interface is what the in-page demo implements with the viewer's own model, so the Companion core (prompts, quote checks, grading rules) never knows which model it runs on.

Set `COMMONS_URL` to a Commons API (`d2-commons serve`) to draw the other side from it. One process serves the app, `/data/snapshot.json`, `/healthz` and `POST /api/{explain,arguments,challenge,claim}`. The browser names an item; the server builds the prompt, so the key can't be used as a general model proxy. Model calls are rate limited per client and explanations are cached.

`POST /api/factcheck` `{text, item_id?}` checks a claim with the Provenance service (`PROVENANCE_URL`, default `http://127.0.0.1:8090`) over HTTP and needs no model key. It answers `{result: "graded", grade}` (a `Grade` from `spec/schemas/grade.schema.json`) or `{result: "no_record"}` when Provenance says no record mentions the claim (its 404 with `code: "no_record"`, or its 400 `code: "unknown_context"` when it does not hold that file). Any other 404 or error is "unavailable", never "no record". With `item_id` the claim is checked against that file. A claim over 500 characters or a body over 4 KiB is refused (413), never cut. Provenance unreachable, failing or slower than 8 s: 503. An answer that does not match the schema: 502, never shown. Rate limited per client in its own bucket (`factcheckPerMinute`, default 20), apart from the model routes. Upstream failures are logged with the status and the claim's length, never its text. `/healthz` adds `"provenance": true|false` (cached 30 s, never fails the check). `gradeProblems` (exported) checks a value against the schema file itself.

`GET /api/ideas?jurisdiction=<id>&jurisdiction=<id>&limit=<n>` reads the Agora queue (`AGORA_URL`, default `http://127.0.0.1:8091`) over HTTP, read only, with no model key. It answers `{charter_version, ideas}` in Agora's order. Every idea must match `spec/schemas/idea.schema.json` and the whole answer must have exactly `charter_version` and `ideas` (at most `limit` of them), or the answer is 502 and nothing of it is shown. `proposer_nym` is dropped before the answer leaves the server, so a pseudonym never reaches a browser. `limit` is 1 to 100 (default 50), `jurisdiction` up to 20 ids of `[a-z0-9-]`; anything else, including an unknown parameter, is 400 before Agora is called. Agora unreachable, failing or slower than 3 s: 503. Any other method on `/api/ideas` or a path under it (`POST`, `PUT`, `PATCH`, `DELETE`, such as `/api/ideas/<id>/upvote`) is 405 with `Allow: GET` and never reaches Agora: posting and supporting stay off until secure sign-in (Door) replaces Agora's stand-in identity. Rate limited per client in its own bucket (`ideasPerMinute`, default 60). `/healthz` adds `"agora": true|false` (same probe as Provenance; never fails the check). `ideaProblems`, `queueProblems`, `ideasPageProblems` and `readQueue` are exported; the shared schema checker (`schema.ts`) now also knows `maxItems`, `uniqueItems`, `minimum`, `minProperties`, `format: date-time` and `$ref` to `localized-text.schema.json`, and still fails closed on any other keyword.

Licence: held (see LICENSE).
