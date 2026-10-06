# Changelog

## Unreleased

- Model-agnostic provider. `OpenAICompatibleProvider` calls any server that speaks the OpenAI chat-completions API (Ollama, vLLM, llama.cpp server, LM Studio, Groq, OpenRouter, Mistral, Together) over plain `fetch`: `LLM_BASE_URL`, optional `LLM_API_KEY` (Bearer), `LLM_MODEL`, `LLM_TIMEOUT_MS`; temperature 0.2, JSON mode asked for and dropped for good when a server rejects it with a 400, retries only on 429 and 5xx (twice, Retry-After or backoff, 10 s cap). `providerFromEnv` picks the provider: `LLM_PROVIDER=openai|anthropic`, defaulting to `openai` when `LLM_BASE_URL` is set and to the Anthropic path when only `ANTHROPIC_API_KEY` is. The Anthropic path shares the transport (timeout, retries, `ModelError`) and `LLM_MODEL` wins over `COMPANION_MODEL`. The `Provider` interface gains an optional `kind`.
- `/healthz` reports `"model": {"kind", "name"}` (or `null`), never a key; the server logs the provider's kind, model and endpoint host at start.
- Model failures are 502, never 500: a refusal, prose or a list instead of JSON (`ModelAnswerError`, "the model gave an answer that could not be read"), an unreachable or failing model (`ModelError`, "the model did not answer"). `parseJson` reads JSON out of `<think>` blocks, fences (also untagged) and prose with stray braces, takes the first JSON object it finds, and refuses answers that hold none.
- Error text that reaches the server log is scrubbed of the API key and of any `user:password@` in a URL, and `LLM_BASE_URL` with credentials, a query or a fragment is refused at start-up (the key belongs in `LLM_API_KEY`).
- The Anthropic path now also sends `temperature: 0.2`, like the OpenAI-compatible path.
- Prompts `companion-prompts/4`: one shared output rule (`JSON_ONLY`: one object, exact keys, nothing around it) written for any model, and the neutrality rules say where the numbered sources are. No wording is specific to one model vendor.
- README "Choosing a model": local first (Ollama, open-weight families by size, quality on fr/de/lb to be checked with Symmetry), free-tier bridges with open-weight models (Groq, OpenRouter `:free`) with their base URLs, rate limits and prompt logging, the Anthropic path last.

- `GET /api/ideas` reads the Agora queue (`AGORA_URL`, default `http://127.0.0.1:8091`), read only. Every idea is checked against `spec/schemas/idea.schema.json` and the answer against the queue shape (502 if invalid), proposer pseudonyms are dropped, Agora unreachable, failing or slower than 3 s is 503, a bad `limit` or `jurisdiction` or an unknown parameter is 400 before Agora is called, and every other method on `/api/ideas*` is 405 and never forwarded. Own rate-limit bucket (`ideasPerMinute`, default 60); `/healthz` reports `agora: true|false` and never fails on it. Exports `readQueue`, `ideaProblems`, `queueProblems`, `ideasPageProblems` and the `Idea`, `PublicIdea`, `IdeasPage` types.
- Answers from Agora, Provenance and Commons are read as a stream and refused past 16 MiB (64 KiB for error codes and `/healthz`), never read in full: Agora or Provenance past the cap is 502, Commons past it counts as an outage. No request to another service follows a redirect. `/api/ideas` reuses Agora's answer for the same query (sorted jurisdictions, limit) for 15 s (`ideasCacheMs`), including for requests that arrive while it is being read; failures are not kept. A queue that lists the same idea id twice is refused (502). `/healthz` probes Provenance and Agora at the same time.
- The schema checker's `format: date-time` checks the calendar (no 30 February, hour 24 or offset +24:00), and `integer` means a safe integer (at most 2^53 - 1), so a count of `1e300` is refused.
- The JSON Schema checker moved to `schema.ts` and is shared by grades and ideas. It now knows `maxItems`, `uniqueItems`, `minimum`, `minProperties`, `format: date-time` and `$ref` to `localized-text.schema.json`; any other keyword still fails closed.
- The devil's advocate draws the other side from Commons first, over HTTP (`COMMONS_URL`,
  `GET /matters/{id}/arguments`). Each turn returns `shown`: the arguments it rests on, each
  with its origin (`commons`, `document` or `model`) and a source link. When Commons has at
  least 2 reasons on the other side, the model may only rephrase them: points it adds are
  dropped (counted in `dropped_model_arguments`) and no document extraction call is made.
  A `position` (a group's recorded vote) is shown but is not a reason, so it does not count
  toward the 2: the documents and labelled model points still fill in the reasons.
  Otherwise points the model adds are shown with a label saying the model wrote them.
- Prompts `companion-prompts/3`: the challenge prompt lists Commons arguments first, marks
  recorded votes as positions without reasons, and asks for model-written points separately.
  Listed arguments go in as quoted data: one line each, newlines collapsed, at most 600
  characters, inside an `<arguments>` block the prompt says never to take instructions from.
- A Commons that is down, slow (2 s timeout) or answers in an unexpected shape means no Commons
  arguments, never a failed turn. Entries whose `attribution` or `kind` is not a string (or
  `kind` not in the schema's list) are dropped; at most 20 are read, text cut at 1000 characters.
- `POST /api/factcheck` proxies a claim (and optionally its file) to the Provenance service (`PROVENANCE_URL`, default `http://127.0.0.1:8090`) and returns its grade only after it passes `spec/schemas/grade.schema.json`. Unreachable or failing: 503; invalid answer: 502; no record (only Provenance's `no_record` / `unknown_context` codes; any other 404 is 503): `{result: "no_record"}`; own rate-limit bucket; `/healthz` reports `provenance: true|false`; claims over 500 characters or bodies over 4 KiB: 413. Works without a model key. Exports `gradeClaim`, `gradeProblems`, `isGrade` and the `Grade` types.

- The server sends `Cache-Control: no-cache` for HTML pages, `sw.js` and `manifest.webmanifest`, so an installed citizen app picks up new versions.
- `readSnapshot` reads Docket snapshot/1 and /2 into the /2 shape (a `sources` list) and refuses other schemas; the server uses it at start-up.
- Item types cover Esch council points (`reference`, `theme`, `votes`) and consultations (`summary`, `opens`, `closes`, `phases`, no number). Source 1 names the right body and lists these facts.
- Prompts `companion-prompts/2`: the explain and arguments prompts name the kind of file from the item (a Chamber bill or file, an Esch council agenda point, or an Esch consultation) instead of calling every file parliamentary.
- `readSnapshot` labels a converted /1 snapshot as `d2.docket.snapshot/2`, the shape it now has.

## 0.1.0

- explain, extractArguments, challenge and checkClaim with quote verification.
- Anthropic provider; zero-dependency Node server with caching and rate limiting.
