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
- **A contested tier is decided by a panel.** See Scope challenges below. An idea's
  `jurisdiction_id`, `scope_tier` and `charter_version` are its *current* ones: those it was filed
  with, or those a narrowing challenge produced. `filed_jurisdiction_id` stays what the proposer
  filed, and `contested` is true while a challenge is open.
- **Jurisdiction filter is exact.** `GET /queue?jurisdiction=<commune>` returns ideas filed at
  that commune only, not at its parents (`lu`) or child districts. A caller that wants the whole
  picture for a resident lists every level.

## Scope challenges

The architecture's answer to a wrong tier (`docs/architecture/01-modules.md` section 2): contesting
a tier opens a `ScopeChallenge` decided by a small Lottery panel. v1 closes the known gap where a
resident files a commune matter under an area that contains their own (Esch under `lu`) to rank
it as national.

- **Who opens one.** Any participant with a nym in the idea's filed area (with Door: an adult
  whose credential covers it), except the proposer (`403 own_idea`). Each participant challenges
  an idea at most once, ever (`409 duplicate_challenge`), and an idea has at most one open
  challenge at a time (`409 challenge_open`), so concurrent panels never disagree. Once a panel
  upholds the tier against an area, no new challenge on that idea may name the same area
  (`409 already_decided`), so nobody gets fresh draws for the same narrowing; after 3 upheld
  challenges the idea takes no more (`409 challenge_limit`).
- **What it says.** `jurisdiction_id`: the narrower area the idea belongs to. It must lie strictly
  inside the idea's current jurisdiction (Charter `parent_id` chain) and Scope must give it a
  lower tier; anything else is `400 not_narrower`. So a challenge can only lower a tier, never
  raise one, and a narrowed idea cannot be challenged back up (it can be narrowed further).
  Nothing else is accepted (`unknown_field`), so nobody states a tier.
- **The panel.** Charter `scope_challenge.panel_size` (5) pseudonyms drawn by the Lottery module
  from the pool of everyone with a nym in the idea's filed area (proposers and upvoters of ideas
  filed there) minus the proposer and the challenger. Fewer than that many is
  `409 panel_pool_too_small`. When the challenge opens, Agora commits the pool to a drand round
  at least an hour ahead (`d2-lottery commit`, purpose `scope-challenge`, context
  `agora.scope-challenge.<id>`); 61 minutes later the first read of the challenge runs
  `d2-lottery draw`, which fetches and verifies the beacon. A failed draw is retried by a read at
  least 60 s later (in-memory, per challenge), so reads do not run the CLI each time. The pool, commitment and transcript are published in the challenge, so anyone reproduces
  the panel with `d2-lottery verify` or `lottery-verify`.
- **Votes.** Only drawn members vote (`403 not_on_panel`), once each (`409 duplicate_vote`),
  `uphold` or `narrow`, with a nym for the idea's filed area. Before the draw: `409
  panel_not_drawn`. An absolute majority of the drawn panel (floor(size/2)+1: 3 of 5) decides
  at once, either way. Only that majority narrows.
- **Deadline.** Charter `scope_challenge.decision_days` (7) after opening. Without a panel
  majority to narrow by then, the tier stands (upheld): one `narrow` vote and no others, a
  2-to-1 split, a tie, no votes or no panel all keep it. Any read settles a due challenge;
  later votes are `409 challenge_closed`.
- **The result.** Narrowed: Scope computes the tier of the proposed jurisdiction under the
  current Charter and stores it, with that version, in an outcome row; the idea moves to that
  jurisdiction's queue. Upheld: nothing changes. If Scope cannot tier the proposed jurisdiction
  then (the Charter changed under the challenge), the challenge is recorded as upheld with
  `outcome.reason` and an error log line, and reads carry on. While open, the idea keeps its tier and place,
  marked `contested`.
- **Storage.** Challenges, draws, votes and outcomes are append-only tables like ideas and
  upvotes; the idea row itself never changes.
- **Identity after narrowing.** Nyms stay those of the filed area (context
  `agora:<filed_jurisdiction_id>`), so nobody gets a second nym, and a second upvote, for the same
  idea. It also means residents of the filed area outside the narrowed one can still upvote it.

**Lottery without importing it.** Modules import only `spec` and `charter`, so Agora runs the
Lottery's CLI in a subprocess (`sortition.py`, `LotteryCli`; `serve --lottery-cmd`, default
`d2-lottery` or `$LOTTERY_CMD`; `--lottery-chain quicknet`). It needs that CLI installed beside
Agora (`uv sync --all-packages`) and outbound access to a drand relay for the draw. Without it,
opening a challenge is `503 lottery_unavailable` and nothing is stored. Tests use a recorded
mainnet beacon (`spec/lottery/vectors/beacons.json`) and never touch the network.

**Owner.** `ScopeChallenge` lives in Agora (the data model first listed it under Charter): it
needs nyms, a store and a panel, which a rules library has none of. Charter supplies the rules
(`scope_challenge.*`, `tier`, `jurisdiction_path`).

## Identity

Agora never sees a person, only a per-context pseudonym (`nym`; context `agora:<jurisdiction>`,
so one nym per person per area, and a person's nyms in two areas cannot be linked). The
`NymSource` interface (`identity.py`) turns the request's `participant` value into a nym.

**Door (`DoorNyms`, the real one).** Started with `DOOR_URL` (the Door verifier, `d2-door serve`,
see `modules/door/README.md`) and `DOOR_EPOCH` (the one credential epoch Agora accepts):

1. The app gets a one-time challenge: `GET /challenge` gives 32 random bytes as hex, valid for
   120 s, usable once (in memory, at most 10,000 open). When 10,000 are open, expired ones are
   dropped first; if it is still full the answer is `503 challenge_capacity`. A live challenge
   is never dropped to make room, so a flood of `GET /challenge` cannot cancel the ones already
   handed out, but it can use up the room for new ones. **Deployment requirement:** a
   per-client rate limit at the edge (Caddy or the Companion) on `GET /challenge` and writes.
2. It sends a Door presentation as `participant`: made for the context `agora:<jurisdiction_id>`
   of the idea, answering that challenge, disclosing `adult` and as many jurisdiction levels as
   the idea's jurisdiction has in Charter (`lu` is 1, a canton 2, a commune 3).
3. Agora uses the challenge up (even if the rest fails), then asks Door to verify it against the
   configured epoch's issuer key, requires `adult` to be true, and requires the disclosed
   jurisdiction path to start with the idea's (Charter ids, root first:
   `lu.lu-canton-esch-sur-alzette.lu-commune-esch-sur-alzette`). It stores only the nym.

A raw participant id is refused (`400 presentation_required`). Door down, slow (5 s) or
answering nonsense: posts and upvotes fail closed with `503 door_unavailable`; reads never ask
Door. Door finding Agora's own request bad (`400` other than `malformed`, for example a Charter
path deeper than Door's 4 levels) is a server problem: also `503 door_unavailable`, with one log
line naming Door's code (`Door answered 400 <code> to Agora's request`), nothing else.

**Epoch.** The database keeps the first Door epoch it was started with. Starting it with another
`DOOR_EPOCH` stops the start: every holder would get new nyms and could upvote the same ideas
again. `--new-epoch` accepts the new epoch deliberately (and stores it).

| Refusal | Status, code |
|---|---|
| Challenge never issued, used or expired (replay) | `400 unknown_challenge` |
| Presentation that does not parse | `400 malformed` |
| Made for another context, or another challenge | `403 context_mismatch`, `403 challenge_mismatch` |
| Another epoch | `403 epoch_mismatch` |
| Fewer jurisdiction levels than the idea's, or no `adult` | `403 missing_disclosure` |
| Edited fields, wrong key, bad proof | `403 invalid_proof` (or `malformed` for a wrong proof length) |
| `adult=false` | `403 not_adult` |
| Lives elsewhere (disclosed path does not start with the idea's) | `403 jurisdiction_not_covered` |

A presentation proves "an adult resident of this area, with this nym here"; it is not tied to
the idea's content, so whoever holds one before its challenge is used can spend it. Serve Agora
only over TLS (Caddy) once deployed; challenges live 120 s.

**Read only (`--read-only`).** No identity at all: Agora serves the queue and ideas and refuses
every post and upvote (`403 read_only`); `/healthz` says `"identity": "none"`. For a deployment
without Door (`ops/deploy/civic-agora.service`).

**Development stand-in (`KeyedNyms`).** Only with `--dev-identity`, and then with
`--nym-key-file` (or `AGORA_NYM_KEY_FILE`, a file of at least 32 bytes, outside git, mode 600;
the bytes are the key as they stand, only one trailing newline is dropped) or
`--dev-insecure-key` (a public key). Without `--dev-identity` the key options stop the start, so a
production unit cannot pick the stand-in by accident; with none of Door, `--read-only` or
`--dev-identity` Agora does not start. nym = `nym-` + base32(HMAC-SHA256(key,
context NUL participant)), 26 characters; the participant is an opaque id (16-128 characters of
`A-Z a-z 0-9 _ -`). One upvote per id, **not per human**: anyone who can reach the API can invent
ids. Development and tests only; `/healthz` says `"identity": "dev"`. Giving `--dev-identity`
together with `DOOR_URL` stops the start.

## HTTP API

`DOOR_URL=http://127.0.0.1:8092 DOOR_EPOCH=1 uv run d2-agora serve --db agora.db` (default
`127.0.0.1:8091`). Standard library only.

| Request | Response |
|---|---|
| `GET /challenge` | `200 {challenge, expires_in}` (Door only; `404` otherwise; `503 challenge_capacity` when full) |
| `POST /ideas` `{participant, jurisdiction_id, topic_ids?, title, text}` | `201` Idea (`spec/schemas/idea.schema.json`) |
| `POST /ideas/<id>/upvote` `{participant}` | `201 {idea_id, upvoted: true}`; `409 duplicate_upvote`; `404 unknown_idea` |
| `GET /ideas/<id>` | `200` Idea |
| `POST /ideas/<id>/challenges` `{participant, jurisdiction_id}` | `201` ScopeChallenge (`spec/schemas/scope-challenge.schema.json`) |
| `GET /ideas/<id>/challenges` | `200 {challenges}`, oldest first |
| `GET /challenges/<id>` | `200` ScopeChallenge; draws the panel when its round is due, settles it at the deadline |
| `POST /challenges/<id>/votes` `{participant, vote}` | `201 {challenge_id, voted: true}`; `uphold` or `narrow`, panel members only |
| `GET /queue?jurisdiction=<id>&jurisdiction=<id>&limit=<n>` | `200 {charter_version, ideas}` in queue order; no `jurisdiction` means all |
| `GET /healthz` | `{ok, ideas, identity}` (`door`, `dev`, or `none` when read only) |

`participant` is a Door presentation (an object) with Door, an opaque id with the stand-in. Door
refusals are listed under Identity.

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

- **Scope challenges, v1 limits.** A challenge only narrows: a national subject filed under a
  commune (the Charter's topic gap) cannot be widened by a challenge yet, since that would let a
  challenge raise a tier. The panel is drawn from everyone active in the area, with no
  stratification, no accept or decline step and no stipend; panel members learn they were drawn
  only by reading the challenge. Draws are not written to Record (`draw.commit`, `draw.result`),
  so the commit time is self-declared (Lottery's unanchored warning applies). A small area with
  fewer than five other participants cannot challenge at all.
- **Epoch rollover.** Agora accepts one Door epoch (`DOOR_EPOCH`) and refuses to start with
  another unless `--new-epoch` is given. Moving to the next epoch gives every holder new nyms,
  so they could upvote ideas from the old epoch again. Needs a rule (close the queue per epoch,
  or carry upvotes forward) before the first rollover.
- **Record.** Architecture logs a matter, its tier and the proposer pseudonym in Record when an
  idea is promoted. Agora may not import `d2_record`, signing an entry needs an Ed25519 key in
  the signed-note format, and `spec/record-types.json` has no idea-level types. Deferred with
  promotion.
- **Promotion** (`POST /ideas/{id}/promote` to a `Matter`, by rule), `ProposerRecord` and
  proposer ratings.
- **Topic-based scope.** The Charter's v0 Scope uses the jurisdiction only (see
  `charter/README.md`, Known gaps), so a national subject filed under a commune ranks as local;
  a ScopeChallenge cannot widen it (see above).
- **A unit for `d2-door serve`** (`civic-door-verify.service`), which needs a release binary built
  in CI (Mulinux does not build).
- **Posting and upvoting from the citizen app.** The app shows the queue read only (Companion
  `GET /api/ideas`), and `ops/deploy/civic-agora.service` runs Agora on loopback; the Companion
  never forwards `POST /ideas` or upvotes until Door is deployed. Not installed
  on Mulinux yet.
- **Operations:** no rate limit of its own (put one at the edge, see Identity); the queue is ranked in memory, fine for a commune pilot, not for
  millions of ideas.
