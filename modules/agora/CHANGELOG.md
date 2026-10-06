# Changelog

## Unreleased

- `DoorNyms`: posts and upvotes take a Door presentation (context `agora:<jurisdiction>`) checked by the Door verifier service (`DOOR_URL`, one accepted epoch `DOOR_EPOCH`); the nym is Door's per-context pseudonym. Requires `adult` true and a disclosed jurisdiction path that starts with the idea's, so nobody files or upvotes outside the areas their credential names. Raw participant ids are refused when Door is configured. Door unreachable or answering nonsense: writes fail closed with `503 door_unavailable`, reads are unaffected.
- `GET /challenge`: one-time challenges (32 bytes, 120 s, single use) so a presentation cannot be replayed.
- `403` for refused presentations (`not_adult`, `jurisdiction_not_covered`, and Door's `context_mismatch`, `challenge_mismatch`, `epoch_mismatch`, `missing_disclosure`, `invalid_proof`); `/healthz` reports `identity`.
- `KeyedNyms` stays as the development stand-in; `serve` refuses a nym key option together with `DOOR_URL`.

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
