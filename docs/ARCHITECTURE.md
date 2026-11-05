# Architecture map (as built on `main`)

What exists in this repo today, where it lives and how the pieces talk. The target design, with
modules not built yet, is in [`docs/architecture/`](architecture/); this page describes only code
that is on `main`. Project skills for common changes are in [`.claude/skills/`](../.claude/skills/).

## 1. Layout and the one rule

| Folder | What lives there |
|---|---|
| `spec/` | Shared contracts as data: JSON Schemas (`spec/schemas/*.schema.json`), the protocol specs and vectors for Door, Booth, Record and Lottery (`spec/<name>/README.md`, `vectors`), `spec/record-types.json`. Tests: `spec/tests/test_schemas.py` |
| `charter/` | The rules of the game as data (`charter.yaml`, `charter.schema.json`), Luxembourg reference data (`data/lu-jurisdictions.json`), shared vectors (`vectors/`), and two bindings: `d2_charter` (`charter/python`) and `@democracy2/charter` (`charter/ts`) |
| `modules/<name>/` | One future repo each, with its own `LICENSE`, `README.md`, `CHANGELOG.md` |
| `apps/` | `citizen/` (the resident app) and `portal/` (the staff portals over Desk) |
| `ops/deploy/` | systemd units, Caddyfile, env examples and the install runbook for Mulinux |
| `tools/` | `dev-setup.sh`, `check.sh`, `boundaries.py`, `health.py` (code-health ratchet, baselines in `tools/baselines/`), `merge-gate.sh` |
| `docs/` | `architecture/` (target design), `product/desk.md` (Desk spec), `design/` (Affichage look), `code-health.md` |
| `lessons/` | One file per repeated mistake and the rule it became |
| `STATE.md` | Handoff log, newest entry first |

**A module imports only `spec` and `charter`.** `tools/boundaries.py` fails the build when a file
under `modules/<x>/` imports another module: Python `d2_<module>`, TypeScript `@democracy2/<module>`,
Rust `d2_<module>::` or a Cargo `path` dependency, or a relative path into another module.
Modules talk to each other over HTTP or a CLI, never by import. Apps are not modules: the citizen app
imports the browser libraries `@democracy2/companion`, `@democracy2/arena` and `@democracy2/pulse`.

Package names: Python `d2-<module>` / `d2_<module>` (uv workspace, root `pyproject.toml`), TypeScript
`@democracy2/<module>` (npm workspaces, root `package.json`), Rust `d2-<module>` (Cargo workspace,
root `Cargo.toml`). A new module adds one line to the matching workspace list.

## 2. Modules

| Module | Lang | What it owns | How others reach it |
|---|---|---|---|
| `companion` | TS | The citizen app's core (explain, arguments, devil's advocate, claim check; prompts versioned in `src/prompts.ts`) and the **one public Node server** (`src/server.ts`): serves the citizen app, the portal, the Docket snapshot and `/api/*` | Library import by the citizen app; HTTP on `PORT` (8787 default, 8788 on Mulinux) |
| `desk` | TS | The commune's desk: feedback, ideas, votes, procedures, staff accounts and roles, enrolment codes, code-by-post letters, the event log, the daily public fingerprint, backups | HTTP on 8094 (loopback); the Companion forwards `/api/desk/*` (`DESK_URL`) |
| `docket` | Py | Official sources normalised into a snapshot (Chamber of Deputies, Esch-sur-Alzette) | CLI `uv run d2-docket snapshot --out <file>`; the Companion reads the file (`SNAPSHOT`) |
| `provenance` | Py | Claim grading (green / yellow / red) against the snapshot's documents | HTTP on 8090 (`POST /claims/grade`); Companion `/api/factcheck` (`PROVENANCE_URL`) |
| `agora` | Py | The ideas forum, ranked by Charter tier then upvotes, ScopeChallenge | HTTP on 8091, `--read-only` in production until Door is live; Companion `GET /api/ideas` (`AGORA_URL`) |
| `commons` | Py | The argument library and the bridging ranker (`src/d2_commons/ranker.py`) | HTTP on 8093, read only; Companion devil's advocate and `GET /api/files/{id}/arguments` (`COMMONS_URL`) |
| `pulse` | TS | The weekly list, pure functions run on the device | Library import by the citizen app |
| `arena` | TS | Comprehension questions per file, no model, no network | Library import by the citizen app |
| `symmetry` | Py | Harness: does a persuasive AI push equally hard both ways | CLI `uv run d2-symmetry` |
| `door` | Rust | Anonymous credentials (BBS), one pseudonym per context; verifier HTTP service (`src/http.rs`, `POST /presentations/verify`) | CLI / binary `d2-door`; not deployed |
| `booth` | Rust | Secret, verifiable ballots (ElGamal on ristretto, guardians, proofs) | CLI `d2-booth`; not deployed |
| `record` | Py | Append-only public log (RFC 6962 tree, signed checkpoints, OpenTimestamps) | CLI `uv run d2-record`; not deployed |
| `lottery` | Py | Verifiable sortition from a drand beacon | CLI `uv run d2-lottery` |
| `booth-verify` | Py | Independent Booth verifier, written from `spec/booth/` only | CLI `uv run d2-booth-verify board.json` |
| `record-verify` | TS | Independent Record verifier, written from `spec/record/` only | `node --experimental-strip-types src/cli.ts` |
| `lottery-verify` | TS | Independent Lottery verifier, written from `spec/lottery/` only | `npm run verify -w @democracy2/lottery-verify` |

Upstream answers are checked before use: the Companion validates what Provenance, Agora and Commons
return against `spec/schemas` (`modules/companion/src/schema.ts`). An invalid answer or a model
failure is a 502, never a 500; a service that is not configured is a 503. Each route's comment in
`modules/companion/src/server.ts` gives its exact codes.

## 3. Apps

| App | Stack | Shape |
|---|---|---|
| `apps/citizen` | Svelte 5 + Vite, PWA (`sw.js`) | Screens in `src/components/*.svelte`, state and clients in `src/lib/`. Strings in `src/lib/i18n.ts`: five dictionaries `en` (reference, its keys type the rest), `fr`, `de`, `lb`, `pt`. Words from `apps/citizen/VOCABULARY.md`. Colour and material only from `src/tokens.css` (Affichage, `docs/design/`). Talks only to the Companion server (`/api/*`, `/data/*`) |
| `apps/portal` | Svelte 5 + Vite | Staff portals (operator, admin, auditor) under `/portal/`. Screens in `src/components/`, Desk client `src/lib/api.ts`, session `src/lib/session.svelte.ts`. Strings in `src/lib/i18n.ts`: `en` (reference) and `fr`. Own `src/tokens.css` plus `src/portal.css` |

The citizen app keeps where a resident lives, their topics and answers in `localStorage`; every
device downloads the same snapshot, so the server never learns them. `apps/citizen/test/pulse.test.ts`
mounts the app under different choices, records every request, and requires identical traces.

## 4. Request path

```
browser ──https──> Cloudflare tunnel ──> Caddy :80 ──> civic-companion :8788 (Mulinux)
                                                        ├─ /            apps/citizen/dist   (STATIC_DIR)
                                                        ├─ /portal/     apps/portal/dist    (PORTAL_DIR)
                                                        ├─ /data/*      Docket snapshot     (SNAPSHOT)
                                                        ├─ /api/explain … model             (LLM_BASE_URL, LLM_MODEL, LLM_API_KEY)
                                                        ├─ /api/factcheck ──> civic-provenance 127.0.0.1:8090
                                                        ├─ /api/ideas     ──> civic-agora      127.0.0.1:8091
                                                        ├─ arguments      ──> civic-commons    127.0.0.1:8093
                                                        └─ /api/desk/*    ──> civic-desk       127.0.0.1:8094
```

Only the Companion is public. Desk authenticates with an `Authorization: Staff <token>` or
`Resident <token>` header (`modules/desk/src/server.ts`, `needStaff(who, ...roles)` gives 401 without a
session and 403 for the wrong role). Roles: `admin`, `operator`, `auditor` (`modules/desk/src/auth.ts`).

## 5. Data stores

| Store | Where (Mulinux) | Rules |
|---|---|---|
| Desk SQLite | `/var/lib/civic-desk/desk.db` (WAL) | Schema in `modules/desk/src/db.ts` (`SCHEMA`, `CREATE TABLE IF NOT EXISTS` on every start, column additions by `ALTER TABLE` in the `Store` constructor). Every change goes through `Store.append(kind, actor, subject, payload, write)`, which writes the event and the row in one transaction. `events`, `ballots` and `fingerprints` are append only (SQLite triggers abort UPDATE and DELETE); `verifyChain` replays the hash chain. Spec: `docs/product/desk.md` |
| Desk log key | `/var/lib/civic-desk/log.key` (mode 600) | Made on first start when `DESK_LOG_NAME` is set; signs one checkpoint per UTC day (`src/fingerprint.ts`) |
| Agora SQLite | `/var/lib/civic-agora/agora.db` | `modules/agora/src/d2_agora/agora.py`; starts empty |
| Backups | `/var/backups/civic/YYYY-MM-DD/` | `modules/desk/src/backup.ts` via `civic-backup.timer` (03:15): online backup of Desk and Agora, integrity and chain check, 7 days kept |
| Docket snapshot | `/opt/civic/shared/lu-chd.json` | Written by `civic-docket.timer` twice a day (schema `d2.docket.snapshot/2`) |
| Translations cache | `/var/lib/civic-companion/translations.json` | The Companion's `StateDirectory`; each French text translated once |
| Commons library | `modules/commons/seed/esch.json` | Shipped in the release, read only |
| Record store | SQLite file given to `d2-record` | Hashes only, never payloads (`modules/record/src/d2_record/store.py`) |

No database, key or `.env` file is ever committed (`.gitignore`: `*.db`, `*.env`, `.env*`).

## 6. Crypto pieces and their verifiers

Every crypto module is an **unaudited prototype for non-binding use**; its README and crate docs say
so and that line stays. Each format is specified in `spec/<name>/README.md` with committed vectors, and
an independent verifier in another language is written from the spec alone.

| Protocol | Implementation | Vectors | Independent verifier |
|---|---|---|---|
| Door (credentials) | `modules/door` (Rust) | `spec/door/vectors.json` (`expect` and `error` per case) | — (verifier service in the crate) |
| Booth (ballots) | `modules/booth` (Rust) | `spec/booth/vectors.json` (`must_fail` cases with error codes) | `modules/booth-verify` (Python) |
| Record (log) | `modules/record` (Python) | `spec/record/vectors/` | `modules/record-verify` (TS) |
| Lottery (sortition) | `modules/lottery` (Python) | `spec/lottery/vectors/` | `modules/lottery-verify` (TS) |

Rust crates test with `tests/vectors.rs` (committed vectors still check; regenerating gives the same
deterministic parts), `tests/no_panic.rs` (random bytes into every external input: an error, never a
panic), `tests/acceptance.rs` and `tests/flow.rs`. Door also has `tests/unlinkability.rs` and
`tests/http.rs`. Desk's daily fingerprint uses Record's format, checked by `modules/desk/src/check-log.ts`.

## 7. Charter

`charter/charter.yaml` is read only through `d2_charter` / `@democracy2/charter` (`tier`, `param`,
`is_protected`, `source`, `basis`). Every rule has a `basis` (`constitution | law | project`) and a
`source` in the `provenance` section; a source is `verified` only with an `article`.
`charter/tests/test_charter_data.py` enforces both. A change bumps `version`, the vectors'
`charter_version` and `charter/CHANGELOG.md` (see `.claude/skills/d2-charter-rule`). The citizen app
gets the Charter values it needs at build time (`pulseCharter` in `apps/citizen/vite.config.ts`).

## 8. Tests and the check

`tools/check.sh` is the whole check and what CI runs (`.github/workflows/ci.yml`, job `Check`):

1. `uv run python tools/boundaries.py` (layout and module boundaries)
2. `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest -q` (paths in root `pyproject.toml`: `tools/tests`, `spec`, `charter`, `modules`)
3. `npm run --if-present --workspaces lint | typecheck | build | test` (vitest; Svelte apps run `svelte-check --fail-on-warnings`)
4. `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`
5. `uv run python tools/health.py check` (fails only on findings above `tools/baselines/`; see `docs/code-health.md`)

Tests live next to the code: `modules/<x>/tests/` (Python, Rust) or `modules/<x>/test/` and
`apps/<x>/test/` (TypeScript). They never reach the web or a model: Docket and Provenance use recorded
fixtures, the apps stub `fetch`, the Companion uses scripted providers. A recorded snapshot for local
use: `modules/pulse/test/fixtures/docket-recorded.json` (early October 2026).

## 9. Merge and deploy

- A PR body has `Closes #N`. CI must be green; the merge gate (`.github/workflows/merge-gate.yml`,
  `tools/merge-gate.sh`) merges PRs labelled `automerge` once reviews and threads allow.
- Mulinux runs brain's pull-based deployer as `app-deploy@civic` (timer). It takes only `main` commits
  with a green CI run, builds with `BUILD_CMD` (`npm ci`, then the citizen and portal builds), restarts
  `civic-companion` (its `PartOf` units `civic-provenance`, `civic-agora`, `civic-commons`,
  `civic-desk` restart with it), and needs five healthy `GET /healthz` in a row, else it rolls back.
  Runbook and the live install's differences: `ops/deploy/README.md`. Server work for the operator:
  `ops/operator-queue.md`.
