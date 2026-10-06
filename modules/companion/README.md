# Companion

The core of the citizen app. Given one file from the Docket snapshot, it can:

| Ability | What the resident gets | How it stays honest |
|---|---|---|
| `explain` | A plain-language explanation in lb, fr, de, en or pt, at short, standard or deep depth | Every factual sentence cites a numbered source and quotes it; a sentence is marked verified only when the quote is found word for word in that source |
| `extractArguments` | The arguments named institutions make in the file's own documents (the Commons seed for Phase 1) | Arguments whose quote isn't in the cited source are dropped |
| `challenge` | A devil's advocate that argues the other side, from Commons first, then those arguments | It may rephrase, never invent; each turn lists the arguments it shows with their source links, and labels any point the model wrote itself. With 2 or more Commons reasons on the other side (recorded votes don't count), model-written points are not shown |
| `checkClaim` | Green / yellow / red for a claim the resident heard, with quotes | Green or red needs at least one verified quote, otherwise the grade drops to yellow |

Prompts are versioned (`PROMPT_VERSION`) and every answer records the prompt version, model and item it came from. The Companion never recommends how to vote.

## Choosing a model

The Companion is model-agnostic. It talks to any server that speaks the OpenAI chat-completions API (`POST {base}/chat/completions`): Ollama, vLLM, llama.cpp server, LM Studio, Groq, OpenRouter, Mistral, Together. No vendor SDK, plain `fetch`. The decision behind it (2026-10-06): no reliance on hosted model APIs the project has no control over. AI runs on open-weight models, on our own hardware; a free tier is only a bridge.

Every call asks for one JSON object with an explicit schema, one task per call, at temperature 0.2, so smaller models cope. The answer is still checked the same way whatever the model: a sentence counts as verified only when its quote is found word for word in the cited source, and a grade of green or red needs a verified quote. A weaker model gives a lower `verified_share` and more yellow grades, never an unsourced claim. An answer that is not JSON (a refusal, prose, a list) is a 502, never a crash.

| Setting | Meaning |
|---|---|
| `LLM_PROVIDER` | `openai` (the compatible API) or `anthropic`. Default: `openai` when `LLM_BASE_URL` is set, `anthropic` when only `ANTHROPIC_API_KEY` is, none otherwise (the model routes answer 503). |
| `LLM_BASE_URL` | Base URL up to the API version, such as `http://127.0.0.1:11434/v1`. Default for `openai`: that Ollama URL. |
| `LLM_API_KEY` | Sent as a Bearer token when set. Local servers need none. |
| `LLM_MODEL` | Model name as the server knows it. Required with `openai`. |
| `LLM_TIMEOUT_MS` | One attempt's wait (default 120000; local models are slow). 429 and 5xx are retried twice with backoff, nothing else is. |

`/healthz` reports `"model": {"kind": "openai", "name": "..."}` (or `null`), never a key, and the server logs `companion model: <kind> <name> at <scheme://host>` at start, host only.

**1. Local first (the plan).** Ollama on your own machine:

```
ollama serve
ollama pull qwen3:8b
LLM_BASE_URL=http://127.0.0.1:11434/v1 LLM_MODEL=qwen3:8b SNAPSHOT=data/lu-chd.json npm run serve -w @democracy2/companion
```

Open-weight families worth trying, by size: around 8 B (`qwen3:8b`, `llama3.1:8b`, `mistral:7b`, fits 8 GB of VRAM or a laptop CPU), around 14 B to 32 B (`qwen3:14b`, `qwen3:32b`, `mistral-small`, `gemma3:27b`, needs 16 to 24 GB), 70 B and up (`llama3.3:70b`, two GPUs or a large unified-memory machine). Quality on French, German and especially Luxembourgish is not known: check each candidate with the Symmetry harness (`modules/symmetry`) and the quote checks before trusting it. llama.cpp server, vLLM and LM Studio work the same way: point `LLM_BASE_URL` at their `/v1`.

**2. Free-tier bridges, open-weight models only.** Until our own hardware runs the model:

| Service | `LLM_BASE_URL` | Notes |
|---|---|---|
| Groq | `https://api.groq.com/openai/v1` | Fast; free tier rate limited per minute and per day; open-weight models such as `llama-3.3-70b-versatile`, `qwen/qwen3-32b`. |
| OpenRouter | `https://openrouter.ai/api/v1` | Models with the `:free` suffix (such as `qwen/qwen3-32b:free`); daily caps, which fall sharply without a credit balance. |

Both need `LLM_API_KEY`. Free tiers may log prompts and use them for training: the Companion sends only public documents and the resident's own words (a claim, the conversation so far) and never personal data, and that must stay true. Rate limits show up as 429: the provider retries twice, then the route answers 502. Check each model's real rate limit before putting it in front of residents.

**3. The Anthropic path** stays for the bridge period: set `ANTHROPIC_API_KEY` (and `LLM_MODEL`, or the older `COMPANION_MODEL`) and nothing else. It is the costly option and not the plan.

## Server

```
SNAPSHOT=data/lu-chd.json LLM_BASE_URL=http://127.0.0.1:11434/v1 LLM_MODEL=qwen3:8b STATIC_DIR=apps/citizen/dist npm run serve -w @democracy2/companion
```

Set `COMMONS_URL` to a Commons API (`d2-commons serve`) to draw the other side from it. One process serves the app, `/data/snapshot.json`, `/healthz` and `POST /api/{explain,arguments,challenge,claim}`. The browser names an item; the server builds the prompt, so a model key can't be used as a general model proxy. Model calls are rate limited per client and explanations are cached.

`POST /api/factcheck` `{text, item_id?}` checks a claim with the Provenance service (`PROVENANCE_URL`, default `http://127.0.0.1:8090`) over HTTP and needs no model key. It answers `{result: "graded", grade}` (a `Grade` from `spec/schemas/grade.schema.json`) or `{result: "no_record"}` when Provenance says no record mentions the claim (its 404 with `code: "no_record"`, or its 400 `code: "unknown_context"` when it does not hold that file). Any other 404 or error is "unavailable", never "no record". With `item_id` the claim is checked against that file. A claim over 500 characters or a body over 4 KiB is refused (413), never cut. Provenance unreachable, failing or slower than 8 s: 503. An answer that does not match the schema: 502, never shown. Rate limited per client in its own bucket (`factcheckPerMinute`, default 20), apart from the model routes. Upstream failures are logged with the status and the claim's length, never its text. `/healthz` adds `"provenance": true|false` (cached 30 s, never fails the check). `gradeProblems` (exported) checks a value against the schema file itself.

`GET /api/ideas?jurisdiction=<id>&jurisdiction=<id>&limit=<n>` reads the Agora queue (`AGORA_URL`, default `http://127.0.0.1:8091`) over HTTP, read only, with no model key. It answers `{charter_version, ideas}` in Agora's order. Every idea must match `spec/schemas/idea.schema.json` and the whole answer must have exactly `charter_version` and `ideas` (at most `limit` of them), or the answer is 502 and nothing of it is shown. `proposer_nym` is dropped before the answer leaves the server, so a pseudonym never reaches a browser. `limit` is 1 to 100 (default 50), `jurisdiction` up to 20 ids of `[a-z0-9-]`; anything else, including an unknown parameter, is 400 before Agora is called. Agora unreachable, failing or slower than 3 s: 503. Any other method on `/api/ideas` or a path under it (`POST`, `PUT`, `PATCH`, `DELETE`, such as `/api/ideas/<id>/upvote`) is 405 with `Allow: GET` and never reaches Agora: posting and supporting stay off until secure sign-in (Door) replaces Agora's stand-in identity. Rate limited per client in its own bucket (`ideasPerMinute`, default 60). `/healthz` adds `"agora": true|false` (same probe as Provenance; never fails the check). `ideaProblems`, `queueProblems`, `ideasPageProblems` and `readQueue` are exported; the shared schema checker (`schema.ts`) now also knows `maxItems`, `uniqueItems`, `minimum`, `minProperties`, `format: date-time` and `$ref` to `localized-text.schema.json`, and still fails closed on any other keyword.

Licence: held (see LICENSE).
