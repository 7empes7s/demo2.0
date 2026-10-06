# Changelog

## Unreleased

- ScopeChallenge v1: `POST /ideas/<id>/challenges` `{participant, jurisdiction_id}` contests an idea's tier with a narrower jurisdiction (strictly inside the current one, lower tier: `400 not_narrower` otherwise); the proposer cannot (`403 own_idea`); one per participant per idea (`409 duplicate_challenge`) and one open per idea (`409 challenge_open`). A panel of Charter `scope_challenge.panel_size` is drawn by the Lottery CLI (`LotteryCli`, `serve --lottery-cmd/--lottery-chain`) from the area's participants minus proposer and challenger (`409 panel_pool_too_small`), committed when the challenge opens and drawn once the drand round is due. `POST /challenges/<id>/votes` (`uphold`/`narrow`, panel only): a panel majority decides at once; at the Charter `scope_challenge.decision_days` deadline the votes cast decide and a tie keeps the tier. Narrowed: Scope recomputes the tier for the new jurisdiction. `GET /challenges/<id>`, `GET /ideas/<id>/challenges`; `spec/schemas/scope-challenge.schema.json`.
- Ideas carry `filed_jurisdiction_id` and `contested`; `jurisdiction_id`, `scope_tier` and `charter_version` are the current ones (after a narrowing). The queue filters on the current jurisdiction. Nyms stay those of the filed area.
- The pinned widening gap test now expects a challenge to bring the idea back to its commune tier.
- Test (Phase 2 unlinkability, Agora's side): after real Door-backed posts and upvotes, the database and log records hold the nym and no run of any proof, pseudonym point or challenge, and no disclosed path.
- `DoorNyms`: posts and upvotes take a Door presentation (context `agora:<jurisdiction>`) checked by the Door verifier service (`DOOR_URL`, one accepted epoch `DOOR_EPOCH`); the nym is Door's per-context pseudonym. Requires `adult` true and a disclosed jurisdiction path that starts with the idea's, so nobody files or upvotes outside the areas their credential names. Raw participant ids are refused when Door is configured. Door unreachable or answering nonsense: writes fail closed with `503 door_unavailable`, reads are unaffected.
- `GET /challenge`: one-time challenges (32 bytes, 120 s, single use) so a presentation cannot be replayed.
- `403` for refused presentations (`not_adult`, `jurisdiction_not_covered`, and Door's `context_mismatch`, `challenge_mismatch`, `epoch_mismatch`, `missing_disclosure`, `invalid_proof`); `/healthz` reports `identity`.
- `KeyedNyms` stays as the development stand-in, only with `serve --dev-identity` (the key options are refused without it, and `--dev-identity` is refused together with `DOOR_URL`); `/healthz` reports it as `dev`.
- `serve --read-only`: no identity, every post and upvote refused (`403 read_only`), `/healthz` `identity: "none"`. The Mulinux unit uses it until Door is deployed.
- `GET /challenge` refuses with `503 challenge_capacity` when full instead of dropping the oldest live challenge (expired ones are pruned first), so a flood cannot cancel challenges already handed out.
- The database stores the accepted Door epoch; `serve` refuses another `DOOR_EPOCH` unless `--new-epoch` is given.
- Door's `400` (other than `malformed`) is Agora's own problem: `503 door_unavailable` and a log line with Door's code only.
- The nym key file is read as raw bytes with at most one trailing newline dropped (it was stripped, so a random key with whitespace bytes at its ends lost them).

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
