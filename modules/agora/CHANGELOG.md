# Changelog

## 0.1.0 (unreleased)

- Ideas with a jurisdiction, topics, and a title and text in up to five languages; the tier comes
  from the Charter's Scope rules and is stored with the Charter version. Any field outside the
  documented ones (such as a proposer's own `scope_tier`) is refused with `unknown_field`.
- One upvote per (idea, nym); a second one is refused with `duplicate_upvote`.
- Queue ranked by Charter queue priority of the tier, then visible upvotes, then `created_at`,
  then `id`. Counts are hidden, and do not rank, for Charter `agora.upvote_hidden_hours`.
- Append-only SQLite store: triggers refuse UPDATE, DELETE and an INSERT over a stored key
  (`INSERT OR REPLACE`, `REPLACE INTO`).
- `NymSource` interface for identity, with `KeyedNyms` (HMAC-SHA256 per jurisdiction under a
  server key; no key, no start) as the stand-in until Door exists. Participant ids are never
  stored or published.
- Text is NFC-normalised; lone surrogates are refused, and titles refuse line separators and
  zero-width characters. The clock must be timezone-aware.
- HTTP API (`POST /ideas`, `POST /ideas/<id>/upvote`, `GET /ideas/<id>`, `GET /queue`,
  `GET /healthz`), stdlib only, loopback by default, 256 KiB body limit, 10 s total body
  deadline, 32 connections at once, `500 internal` without details on unexpected errors.
- CLI `d2-agora serve`.
- Schemas `spec/schemas/idea.schema.json` and `spec/schemas/upvote.schema.json`.
