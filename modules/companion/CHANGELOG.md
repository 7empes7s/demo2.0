# Changelog

## Unreleased

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

- The server sends `Cache-Control: no-cache` for HTML pages, `sw.js` and `manifest.webmanifest`, so an installed citizen app picks up new versions.
- `readSnapshot` reads Docket snapshot/1 and /2 into the /2 shape (a `sources` list) and refuses other schemas; the server uses it at start-up.
- Item types cover Esch council points (`reference`, `theme`, `votes`) and consultations (`summary`, `opens`, `closes`, `phases`, no number). Source 1 names the right body and lists these facts.
- Prompts `companion-prompts/2`: the explain and arguments prompts name the kind of file from the item (a Chamber bill or file, an Esch council agenda point, or an Esch consultation) instead of calling every file parliamentary.
- `readSnapshot` labels a converted /1 snapshot as `d2.docket.snapshot/2`, the shape it now has.

## 0.1.0

- explain, extractArguments, challenge and checkClaim with quote verification.
- Anthropic provider; zero-dependency Node server with caching and rate limiting.
