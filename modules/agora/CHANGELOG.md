# Changelog

## 0.1.0 (unreleased)

- Ideas with a jurisdiction, topics, and a title and text in up to five languages; the tier comes
  from the Charter's Scope rules and is stored with the Charter version. Any field outside the
  documented ones (such as a proposer's own `scope_tier`) is refused with `unknown_field`.
- One upvote per (idea, nym); a second one is refused with `duplicate_upvote`.
- Queue ranked by Charter queue priority of the tier, then visible upvotes, then `created_at`,
  then `id`. Counts are hidden, and do not rank, for Charter `agora.upvote_hidden_hours`.
- Append-only SQLite store: triggers refuse UPDATE and DELETE.
- `NymSource` interface for identity, with `OpaqueNyms` as the stand-in until Door exists.
- HTTP API (`POST /ideas`, `POST /ideas/<id>/upvote`, `GET /ideas/<id>`, `GET /queue`,
  `GET /healthz`), stdlib only, loopback by default, 64 KiB body limit, 10 s body timeout.
- CLI `d2-agora serve`.
- Schemas `spec/schemas/idea.schema.json` and `spec/schemas/upvote.schema.json`.
