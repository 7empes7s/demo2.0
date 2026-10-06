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
  DELETE, and any INSERT whose key is already stored (so `INSERT OR REPLACE` / `REPLACE INTO`
  cannot swap a row either). A stored idea cannot be moved to another jurisdiction or tier.
  Someone holding the file can still drop the triggers; that needs Record.
- **One upvote per participant per idea.** The key is (idea, nym), where the nym is derived for
  the idea's own jurisdiction. An idea has one jurisdiction, so a participant has exactly one nym
  per idea. A second upvote is refused with 409 `duplicate_upvote`; it is never merged or
  counted. Proposers may upvote their own idea.
- **Queue order** (`rank_key`), total and deterministic:
  1. the tier's Charter `tiers.<tier>.queue_priority` (national 1, regional 2, local 3, minor 4);
  2. visible upvotes, most first;
  3. `created_at`, oldest first (first come, first served);
  4. `id` (a ULID), as the last tie-break.
- **Hidden counts.** For Charter `agora.upvote_hidden_hours` (24) after an idea is posted its
  `upvote_count` is `null` and it ranks as if it had none, so its position does not leak the
  count. The upvote answer never carries a count.
- **Mixed Charter versions.** Each idea keeps the tier and `charter_version` it was filed under;
  it is never re-tiered. The queue ranks them all with the *current* Charter's queue priorities
  and hidden-hours value, and the response's top-level `charter_version` is the current one.
- **Jurisdiction filter is exact.** `GET /queue?jurisdiction=<commune>` returns ideas filed at
  that commune only, not at its parents (`lu`) or child districts. A caller that wants the whole
  picture for a resident lists every level.

## Identity

Agora never sees a person, only a per-context pseudonym (`nym`; context `agora:<jurisdiction>`).
The `NymSource` interface (`identity.py`) turns the caller's `participant` value into a nym.
Door, which will derive nyms from anonymous credentials, does not exist yet, so v1 ships
`KeyedNyms`: nym = `nym-` + base32(HMAC-SHA256(server key, context NUL participant)), 26
characters. The participant must be an opaque id (16-128 characters of `A-Z a-z 0-9 _ -`), so an
email address, a name or a phone number is refused. The participant id is never stored or
published, and a proposer's nyms in two jurisdictions cannot be linked.

The key is a file of at least 32 bytes, outside git (mode 600), passed with `--nym-key-file` or
`AGORA_NYM_KEY_FILE`. Without one `d2-agora serve` refuses to start; `--dev-insecure-key` uses a
public key, for development only. Changing the key changes every nym, so a participant could
upvote again: keep the key for the life of the database.

**Gap:** with `KeyedNyms`, one upvote per nym is enforced, one per human is not. Anyone who can
reach the API can invent nyms. Keep the server on loopback behind a caller that issues the ids
until a Door-backed `NymSource` lands.

## HTTP API

`uv run d2-agora serve --db agora.db --nym-key-file /etc/agora/nym.key` (default
`127.0.0.1:8091`). Standard library only.

| Request | Response |
|---|---|
| `POST /ideas` `{participant, jurisdiction_id, topic_ids?, title, text}` | `201` Idea (`spec/schemas/idea.schema.json`) |
| `POST /ideas/<id>/upvote` `{participant}` | `201 {idea_id, upvoted: true}`; `409 duplicate_upvote`; `404 unknown_idea` |
| `GET /ideas/<id>` | `200` Idea |
| `GET /queue?jurisdiction=<id>&jurisdiction=<id>&limit=<n>` | `200 {charter_version, ideas}` in queue order; no `jurisdiction` means all |
| `GET /healthz` | `{ok, ideas}` |

`title` and `text` are objects of language (`lb fr de en pt`) to text. Errors are
`{error, code}`; an unexpected failure is `500 internal` with no details.

| Limit | Value |
|---|---|
| Request body | 256 KiB (`413 too_large`); `Content-Length` required (`411`). A maximum-length post in five languages with every character `\u`-escaped fits |
| Body arrival | 10 s for the whole body (`408`) |
| Connections | 32 at once (`503 busy`) |
| Title | 200 characters per language, one line |
| Text | 4,000 characters per language |
| Topics | 8, dotted ids such as `transport.cycling` |
| Queue | 20 jurisdictions, `limit` 1-500 (default 100) |

Text is trimmed and NFC-normalised (limits count the normalised text). Control characters,
bidirectional overrides and lone surrogates are refused; titles also refuse line and paragraph
separators and zero-width characters.

## Not done yet

- **Jurisdiction widening (known v1 gap).** The proposer picks `jurisdiction_id`, so a commune
  matter filed under `lu` is stored as national and goes to the top of every queue that includes
  `lu`. That is a matter raising its own tier by relabelling the jurisdiction. Pinned by
  `test_known_gap_a_proposer_can_widen_the_jurisdiction_to_raise_the_tier`. Closing it needs
  Door eligibility (bind the jurisdiction to the proposer's area) or a `ScopeChallenge` /
  moderation step for ideas filed wider than the proposer's area. Required before any pilot.
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
- **Posting and upvoting from the citizen app.** The app shows the queue read only (Companion
  `GET /api/ideas`), and `ops/deploy/civic-agora.service` runs Agora on loopback; the Companion
  never forwards `POST /ideas` or upvotes until a Door-backed `NymSource` exists. Not installed
  on Mulinux yet.
- **Operations:** no rate limit; the queue is ranked in memory, fine for a commune pilot, not for
  millions of ideas.
