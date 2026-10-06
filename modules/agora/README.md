# Agora

The agenda forum: people post ideas for their commune or the country, upvote the ones they want
discussed, and the queue puts the widest-reaching ideas first. Licence: AGPL-3.0-or-later (see
LICENSE). Architecture: `docs/architecture/01-modules.md` section 11.

v1 is the smallest slice that meets the Phase 2 Agora criterion
(`docs/architecture/00-overview.md` section 7): *Agora ranks by scope tier first, then upvotes; a
matter cannot change its own tier by relabelling.* An empty Agora is the starting state; nothing
is seeded.

## Rules

- **Tier comes from Scope.** An idea names a `jurisdiction_id` and optional `topic_ids`. Agora
  asks the Charter library (`d2_charter.tier`) for the tier and stores it with the Charter
  version. A request that carries any other field (`scope_tier`, `claimed_tier`,
  `affected_population`, `upvote_count`, ...) is refused with `unknown_field`, so a label never
  passes silently. An unknown jurisdiction is refused with the Charter's `unknown_jurisdiction`.
- **Append-only.** Ideas and upvotes live in one SQLite file. Triggers refuse every UPDATE and
  DELETE, so a stored idea cannot be moved to another jurisdiction or tier.
- **One upvote per participant per idea.** The key is (idea, nym). A second upvote is refused
  with 409 `duplicate_upvote`; it is never merged or counted. Proposers may upvote their own idea.
- **Queue order** (`rank_key`), total and deterministic:
  1. the tier's Charter `tiers.<tier>.queue_priority` (national 1, regional 2, local 3, minor 4);
  2. visible upvotes, most first;
  3. `created_at`, oldest first (first come, first served);
  4. `id` (a ULID), as the last tie-break.
- **Hidden counts.** For Charter `agora.upvote_hidden_hours` (24) after an idea is posted its
  `upvote_count` is `null` and it ranks as if it had none, so its position does not leak the
  count. The upvote answer never carries a count.

## Identity

Agora never sees a person, only a per-context pseudonym (`nym`; context `agora:<jurisdiction>`).
The `NymSource` interface (`identity.py`) turns the caller's `participant` value into a nym.
Door, which will derive nyms from anonymous credentials, does not exist yet, so v1 ships
`OpaqueNyms`: the participant string *is* the nym, and it must be an opaque id (16-128 characters
of `A-Z a-z 0-9 _ -`), so an email address, a name or a phone number is refused, not stored.

**Gap:** with `OpaqueNyms`, one upvote per nym is enforced, one per human is not. Anyone who can
reach the API can invent nyms. Keep the server on loopback behind a caller that issues the ids
until a Door-backed `NymSource` lands.

## HTTP API

`uv run d2-agora serve --db agora.db` (default `127.0.0.1:8091`). Standard library only.

| Request | Response |
|---|---|
| `POST /ideas` `{participant, jurisdiction_id, topic_ids?, title, text}` | `201` Idea (`spec/schemas/idea.schema.json`) |
| `POST /ideas/<id>/upvote` `{participant}` | `201 {idea_id, upvoted: true}`; `409 duplicate_upvote`; `404 unknown_idea` |
| `GET /ideas/<id>` | `200` Idea |
| `GET /queue?jurisdiction=<id>&jurisdiction=<id>&limit=<n>` | `200 {charter_version, ideas}` in queue order; no `jurisdiction` means all |
| `GET /healthz` | `{ok, ideas}` |

`title` and `text` are objects of language (`lb fr de en pt`) to text. Errors are
`{error, code}`.

| Limit | Value |
|---|---|
| Request body | 64 KiB (`413 too_large`); `Content-Length` required (`411`) |
| Body arrival | 10 s (`408`) |
| Title | 200 characters per language, one line |
| Text | 4,000 characters per language |
| Topics | 8, dotted ids such as `transport.cycling` |
| Queue | 20 jurisdictions, `limit` 1-500 (default 100) |

Text is trimmed; control characters and bidirectional overrides are refused.

## Not done yet

- **Record.** Architecture logs a matter, its tier and the proposer pseudonym in Record when an
  idea is promoted. Agora may not import `d2_record`, signing an entry needs an Ed25519 key in
  the signed-note format, and `spec/record-types.json` has no idea-level types. Deferred with
  promotion.
- **Promotion** (`POST /ideas/{id}/promote` to a `Matter`, by rule), `ProposerRecord` and
  proposer ratings.
- **Door.** A `NymSource` that verifies credential presentations (see Identity).
- **Topic-based scope.** The Charter's v0 Scope uses the jurisdiction only (see
  `charter/README.md`, Known gaps), so a national subject filed under a commune ranks as local
  until a `ScopeChallenge` exists.
- **Citizen app view** and a systemd unit. Agora is not deployed.
- **Operations:** no rate limit; the queue is ranked in memory, fine for a commune pilot, not for
  millions of ideas.
