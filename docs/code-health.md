# Code health

A measured audit of the repo (2026-11-04, main @ 6118c6b), the guardrails that keep it from
getting worse, and a cleanup backlog. Re-run the commands in each section to refresh a number.

## Guardrails: the ratchet

`tools/check.sh` ends with `python tools/health.py check`. It runs five measures and compares each
with a checked-in baseline in `tools/baselines/`. It fails only on findings that are **not** in
the baseline, so today's debt is allowed and new debt is not.

| measure | tool | baseline key | today |
|---|---|---|---|
| `sizes` | line count of tracked source files | file → lines | 3 files over 800 |
| `knip` | `knip` over the npm workspaces (`knip.json`) | kind:file:symbol → count | 44 (2 more were real dead code, removed here) |
| `vulture` | `vulture charter/python modules tools spec` | file:finding → count | 37 (all false positives, see §4) |
| `ruff` | `ruff check --select SIM,PL --ignore PLR2004` (on top of the enforced E, F, I, B, UP) | file:rule → count | 74 findings in 53 keys |
| `eslint` | `@typescript-eslint/no-floating-promises`, type-aware (`eslint.config.mjs`) | file:rule → count | 35 (all in tests) |

Rules:
- **File size:** a file may not grow past max(800, baseline + 5%) lines. A file without a baseline
  entry, including every new file, may not pass 800 lines.
- **Keys carry no line numbers,** so moving code is not a new finding. A key whose count rises is.
- **When a PR fixes something,** run `uv run python tools/health.py ratchet` and commit the
  smaller baselines. `check` prints a reminder when a baseline could go down. Ratchet only lowers.
- **A real false positive** can be accepted with `uv run python tools/health.py init --only <name>`
  (rewrites that baseline from the current tree). Say why in the PR; it is the reviewer's call.
- Baselines are written sorted with one key per line, so they diff cleanly and two runs on the same
  tree give the same bytes. `tools/tests/test_health.py` covers the logic and checks that the
  committed baselines are in that canonical form.
- Not covered: `.svelte` components (eslint is limited to `.ts`; knip does see Svelte imports).
  Rust needs no extra ratchet: `cargo clippy -D warnings` already fails on dead code and unused imports.
- Module boundaries (`tools/boundaries.py`) are unchanged.

Cost: about 15 s in CI (eslint's type-aware pass is most of it).

Proof it bites: CI run 41930667429 on this PR's throwaway commit (an unused export in
`modules/desk/src/letters.ts`, a dead function in `modules/symmetry/.../metrics.py`) failed with:

```
knip: new unused TypeScript code: exports:modules/desk/src/letters.ts:UNUSED_DEMO
vulture: new dead Python code: modules/symmetry/src/d2_symmetry/metrics.py:unused function '_dead_demo'
```

# Measurements

## 1. Largest tracked source files

```sh
git ls-files | grep -E '\.(ts|svelte|js|mjs)$' | xargs wc -l | sort -rn | sed -n '2,11p'
git ls-files | grep -E '\.py$' | xargs wc -l | sort -rn | sed -n '2,11p'
git ls-files | grep -E '\.rs$' | xargs wc -l | sort -rn | sed -n '2,11p'
```

| TS / Svelte | lines | Python | lines | Rust | lines |
|---|---|---|---|---|---|
| apps/citizen/src/lib/i18n.ts | 2278 | modules/agora/src/d2_agora/agora.py | 860 | modules/door/src/vectors.rs | 792 |
| apps/citizen/test/desk.test.ts | 912 | modules/agora/tests/test_agora.py | 745 | modules/door/tests/flow.rs | 694 |
| apps/portal/src/lib/i18n.ts | 675 | modules/booth-verify/src/d2_booth_verify/verify.py | 676 | modules/door/tests/unlinkability.rs | 667 |
| modules/desk/src/desk.ts | 666 | modules/agora/tests/test_door.py | 660 | modules/booth/src/vectors.rs | 604 |
| modules/companion/src/server.ts | 611 | modules/agora/tests/test_scope_challenge.py | 618 | modules/booth/src/state.rs | 511 |
| modules/desk/src/server.ts | 561 | modules/provenance/tests/test_provenance.py | 469 | modules/door/src/http.rs | 500 |
| modules/desk/test/desk.test.ts | 539 | modules/provenance/src/d2_provenance/grader.py | 432 | modules/booth/src/ballot.rs | 458 |
| apps/citizen/src/App.svelte | 481 | modules/docket/src/d2_docket/esch.py | 416 | modules/door/tests/http.rs | 451 |
| apps/citizen/test/pulse.test.ts | 455 | modules/docket/src/d2_docket/snapshot.py | 412 | modules/door/tests/no_panic.rs | 371 |
| apps/citizen/src/lib/desk.ts | 406 | modules/record/src/d2_record/ots.py | 349 | modules/booth/src/guardian.rs | 342 |

Three files are over 800 lines and sit in `tools/baselines/sizes.json`: `apps/citizen/src/lib/i18n.ts`
(translation tables, 2278), `apps/citizen/test/desk.test.ts` (912) and `modules/agora/src/d2_agora/agora.py` (860).
311 tracked source files, 56.6k lines (ts/py/rs/svelte/js/mjs/sh).

## 2. Largest and most complex functions (lizard)

```sh
git ls-files | grep -E '\.(ts|py|rs)$' > files.txt
uv tool run lizard --csv -f files.txt > lizard.csv    # columns: nloc,ccn,tokens,params,length,location,file,name,...
```
Svelte components are not covered by lizard (their `<script>` blocks are not parsed).

### TypeScript (2522 functions; 18 with CCN > 15)

| CCN | NLOC | function | where |
|---|---|---|---|
| **185** | **233** | `route` | `modules/desk/src/server.ts:150` |
| 44 | 46 | `check` | `modules/companion/src/schema.ts:59` |
| 29 | 61 | request handler (anonymous) | `modules/companion/src/server.ts:519` |
| 28 | 44 | `loadSeed` | `modules/desk/src/seed.ts:30` |
| 27 | 21 | `procedureInput` | `modules/desk/src/desk.ts:175` |
| 21 | 32 | `parseCommitment` | `modules/lottery-verify/src/verify.ts:161` |
| 20 | 22 | `providerFromEnv` | `modules/companion/src/provider.ts:329` |
| 20 | 42 | `checkPublished` | `modules/desk/src/check-log.ts:41` |
| 19 | 32 | `dossierFacts` | `modules/companion/src/sources.ts:6` |
| 18 | 22 | `call` | `apps/citizen/src/lib/desk.ts:301` |

Longest (NLOC) besides `route`: `challenge` 79 (`modules/companion/src/companion.ts:170`),
`ruleQuestions` 54 (`modules/arena/src/rules.ts:169`), `run` 47 (`modules/lottery-verify/src/cli.ts:38`).

### Python (1063 functions; 25 with CCN > 15)

| CCN | NLOC | function | where |
|---|---|---|---|
| 46 | 57 | `_votes` | `modules/provenance/src/d2_provenance/grader.py:233` |
| 42 | 58 | `_text` | `modules/provenance/src/d2_provenance/grader.py:293` |
| 40 | 43 | `verdict` | `modules/provenance/src/d2_provenance/grader.py:355` |
| 31 | 77 | `parse_dossier` | `modules/docket/src/d2_docket/chd.py:123` |
| 30 | 85 | `main` | `modules/agora/src/d2_agora/__main__.py:41` |
| 30 | 111 | `build` | `modules/booth-verify/src/d2_booth_verify/testgen.py:134` |
| 26 | 36 | `_check_shape` | `charter/python/src/d2_charter/__init__.py:177` |
| 25 | 30 | `build_item` | `modules/provenance/src/d2_provenance/corpus.py:80` |
| 24 | 42 | `rank` | `modules/commons/src/d2_commons/ranker.py:152` |
| 24 | 63 | `build_esch_council` | `modules/docket/src/d2_docket/snapshot.py:250` |

Longest: `build` 148 NLOC (`modules/record/src/d2_record/vectors.py:40`), `invalid_cases` 83
(`modules/lottery/src/d2_lottery/vectors.py:144`), `open_challenge` 77 (`modules/agora/src/d2_agora/agora.py:395`).

### Rust (308 functions; 9 with CCN > 15)

| CCN | NLOC | function | where |
|---|---|---|---|
| 43 | 154 | `check` | `modules/door/src/vectors.rs:618` |
| 31 | 130 | `read_request` | `modules/door/src/http.rs:134` |
| 25 | **405** | `generate` | `modules/door/src/vectors.rs:195` |
| 25 | 213 | `door_and_agora_together_link_no_better_than_chance` (test) | `modules/door/tests/unlinkability.rs:413` |
| 23 | 57 | `dev_world` | `modules/door/src/bin/d2-door.rs:195` |
| 20 | 73 | `mutate` | `modules/booth/src/vectors.rs:252` |
| 17 | 28 | `apply_cached` | `modules/booth/src/state.rs:208` |
| 17 | 160 | `random_http_input_never_panics` (test) | `modules/door/tests/no_panic.rs:200` |
| 16 | 68 | `check_ballot` | `modules/booth/src/ballot.rs:305` |
| 14 | 46 | `write_canonical` | `modules/booth/src/board.rs:192` |

Longest besides `generate`: `must_fail_cases` 211 (`modules/booth/src/vectors.rs:336`).

## 3. Duplicated blocks (jscpd)

```sh
npx --yes jscpd@4 --min-lines 10 --reporters console --gitignore \
  --ignore '**/node_modules/**,**/dist/**,**/.venv/**,**/target/**,**/*.json,**/*.lock,**/fixtures/**,**/*.md,**/dist-single/**' \
  apps modules charter spec tools
```

| format | files | lines | clones | duplicated lines |
|---|---|---|---|---|
| python | 92 | 17081 | 4 | 54 (0.32%) |
| typescript | 164 | 22864 | 15 | 236 (1.03%) |
| rust | 34 | 9561 | 1 | 12 (0.13%) |
| css | 42 | 2353 | 8 | 408 (17.3%) |
| markup (svelte/html) | 44 | 7094 | 3 | 34 (0.5%) |
| **total** | 396 | 59965 | 31 | **744 (1.24%)** |

Including test fixtures the total is 6.18% (4391 lines), almost all of it saved HTML pages from
esch.lu under `modules/docket/tests/fixtures/` and `modules/commons/tests/fixtures/` (the same
page `esch-participation-projet-650.html` is committed in both modules; modules are separate
future repos, so that copy is by design).

Top code clones:
1. `apps/citizen/src/tokens.css:1-226` ≈ `apps/portal/src/tokens.css:1-229` (225 lines), plus 76 and 12 more lines further down. The design tokens are copied, not shared.
2. `apps/portal/src/lib/types.ts:79-112` ≈ `modules/desk/src/desk.ts:55-88` (34 lines) and `types.ts:117-130` ≈ `desk.ts:85-98` (14): Desk's wire types hand-copied into the portal.
3. `apps/citizen/src/lib/desk.ts:28-45` and `:73-87` ≈ `modules/desk/src/desk.ts:26-43`, `:55-69`: the same types copied into the citizen app (status enums `IDEA_STATUSES`, `FEEDBACK_STATUSES`, `ROUND_STATUSES`, `PROCEDURE_KINDS`, `DECLINE_REASONS` live in three places).
4. `apps/citizen/src/lib/tear.ts:12-35` ≈ `apps/portal/src/lib/tear.ts:19-42` (24).
5. `modules/companion/test/factcheck.test.ts` / `ideas.test.ts` / `file-arguments.test.ts`: fake-upstream setup repeated (20, 16, 15 lines).
6. `apps/portal/src/components/Procedures.svelte:89-105` ≈ `Votes.svelte:60-76` (17).
7. `modules/agora/src/d2_agora/server.py:101-116` ≈ `modules/provenance/src/d2_provenance/server.py:30-45` ≈ `modules/commons/src/d2_commons/server.py:41-55`: the stdlib HTTP handler preamble (separate modules, so by design).
8. `modules/booth/src/bin/d2-booth.rs:22-34` ≈ `modules/door/src/bin/d2-door.rs:33-45` (13): CLI arg reading.
9. `tools/boundaries.py:61-73` ≈ `:80-92` (13): two near-identical import scanners.
10. `modules/companion/src/server.ts:211-221` ≈ `modules/desk/src/server.ts:88-98` (11): JSON body reading.

Within-language helper repeats worth noting (below jscpd's 10-line threshold):
- RFC 6962 leaf/node hashing (`0x00`/`0x01` prefixes) in `modules/lottery/src/d2_lottery/pool.py:63-67`
  and `modules/record/src/d2_record/merkle.py:20-28` (Python), and in TS in `modules/desk/src/fingerprint.ts`
  and `modules/record-verify/src/verify.ts`. Separate modules by rule; desk and record-verify both
  run `spec/record/vectors/*.json`, which is the right guard.
- `sha256` helper defined twice inside one module: `modules/desk/src/db.ts:80` (hex) and
  `modules/desk/src/fingerprint.ts:26` (Buffer, variadic).
- Strict-hex parsers: `_hex` in `modules/booth-verify/.../verify.py:87`, `modules/lottery/.../drand.py:40`,
  `hexBytes` in `modules/lottery-verify/src/drand.ts:26`.

## 4. Dead code

```sh
npx knip --reporter compact          # npm workspaces
uv run vulture charter/python modules tools spec      # 60% confidence default
uv run vulture --min-confidence 80 charter/python modules tools spec
```

### knip (12 unused exports, 7 unused exported types, 1 duplicate export)

Really dead (no reference anywhere):
- `splitRef` in `apps/portal/src/lib/text.ts:75`: defined and exported, never called.
- `deskUp` in `modules/companion/src/desk.ts:64`: replaced by `healthProbe(opts.deskUrl)` in
  `server.ts:320` (the local `const deskUp` there shadows the name).

Export-only (used inside their own file; only the `export` keyword is unneeded): `IDEAS_PAGE`,
`ARGUMENTS_CACHE` (also read by a test), `PLACES` (read by a test), the five status arrays in
`apps/citizen/src/lib/desk.ts`, `moving`, `GROUPS`, `BASE`/`api` in portal `api.ts`, `TEAR_MS`,
`DESK_METHODS`, `TARGETS`, `TRANSLATIONS_SCHEMA`, `translateSystem`, `MAX_PENDING`,
`DECLINE_REASONS`, `STATUS_DAYS`, `inCommune`, `UNCHAINED_G1`, `CHAINED`, `hexBytes`, `u32be`.
Unused exported types are the public shape of wire types (keep, or drop `export`).

Intentional: `is_protected` duplicate of `isProtected` in `charter/ts/src/index.ts:278` (alias
matching the Python binding and the architecture docs). Unused files: `apps/citizen/icons/render.mjs`
and `apps/citizen/scripts/embed.mjs` are manual scripts documented in the citizen README (need
knip `entry` config, not deletion).

### vulture (37 findings at 60%, 0 at ≥80%)

All 37 are false positives or harmless:
- 30 are stdlib hook overrides: `do_GET`/`do_POST`/`log_message`, `server_version`,
  `daemon_threads`, `close_connection` (`http.server`), `handle_starttag`/`handle_endtag`/`handle_data`
  (`html.parser`), in `modules/{agora,commons,provenance,record}/src/*/server.py`,
  `modules/commons/src/d2_commons/esch.py` and test fakes.
- `no_sleep` (`modules/docket/tests/test_fetch.py:35`): autouse pytest fixture.
- `test_retest.__test__ = False` (`modules/symmetry/src/d2_symmetry/metrics.py:97`): tells pytest
  not to collect a function whose name starts with `test_`.
- `Pair.scenario_id`, `Pair.wording` (`modules/symmetry/src/d2_symmetry/suite.py:69,73`):
  dataclass fields that are set but never read (descriptive metadata; real but harmless).

### Rust

`cargo udeps` needs nightly; the toolchain is pinned to stable 1.97.0 (`rust-toolchain.toml`), so
dependencies were checked by hand:

```sh
for c in zkryptium voprf rand sha2 hex serde serde_json thiserror curve25519_dalek merlin ed25519_dalek zeroize rand_chacha; do
  grep -rlw "$c" modules/door/src modules/door/tests | wc -l; done   # same for modules/booth
```

Every declared dependency of `d2-door` (zkryptium, voprf, rand, sha2, hex, serde, serde_json,
thiserror) and `d2-booth` (curve25519-dalek, merlin, ed25519-dalek, zeroize, rand_chacha, rand, sha2,
hex, serde, serde_json, thiserror) is used. `rand_chacha` is used only in `modules/booth/src/vectors.rs`
(deterministic vector generation, which ships in the library). No `#[allow(dead_code)]` or
`#[allow(unused…)]` anywhere; `cargo clippy --workspace --all-targets -- -D warnings` in
`tools/check.sh` already fails on dead code and unused imports.

## 5. Code no test touches

Python:
```sh
uv run --all-packages --with coverage coverage run --source=charter/python/src,modules -m pytest -q -p no:cacheprovider
uv run --all-packages --with coverage coverage report -m --omit='*/tests/*,*/test_*' --sort=cover
```
828 tests; **95% line coverage** (6101 statements, 324 missed). No file is at 0% except two not
imported by any test: `modules/commons/src/d2_commons/rank.py` (CLI wrapper) and
`modules/symmetry/src/d2_symmetry/__main__.py`. Lowest: `d2_docket/__main__.py` 76%,
`d2_docket/fetch.py` 80%, `d2_provenance/__main__.py` 83%, `d2_agora/__main__.py` 84%,
`d2_commons/__main__.py` 85%, `d2_agora/sortition.py` 89% (Lottery CLI failure branches, lines 72-82),
`d2_record/ots.py` 90%, **`d2_booth_verify/verify.py` 91%: 45 uncovered lines are almost all
rejection branches of the independent board verifier** (e.g. `chain_broken` on a wrong `prev`
line 364, `proof_failed` line 586, `out_of_order` guardian line 501, guardian key mismatch line 533,
"guardians_used must be ascending" line 653). The error codes are exercised by
`spec/booth/vectors.json` `must_fail` (29 cases), but by other branches.
(Servers started as subprocesses are not measured, so `server.py` numbers are a floor.)

TypeScript (static import reachability from test files, transitive, through relative and
`@democracy2/*` imports):
```sh
# a throwaway script: walk relative and @democracy2/* imports from every test file, list src files never reached
```
Every src file is reached except entry points: `apps/citizen/src/main.ts`, `apps/portal/src/main.ts`,
`modules/desk/src/index.ts`, `modules/record-verify/src/index.ts` (re-exports), and
`modules/arena/src/cli.ts` (32 lines, the `check-seed` script; no test runs it).
`modules/record-verify/src/cli.ts` is run as a subprocess by `test/cli.test.ts`.

Rust (`#[test]` count in each src file; integration tests under `tests/` that name the module):

| file | unit tests | named by tests/ |
|---|---|---|
| door: attributes, identity, pseudonym, uniqueness | 1–3 each | yes |
| door: holder, issuer, verifier, error, http, vectors | 0 | yes (flow, acceptance, http, unlinkability, vectors, no_panic) |
| booth: ballot, board, guardian | 2–4 each | yes |
| booth: round, state, wire, vectors, error | 0 | yes |
| **booth: `group.rs` (221 lines: ElGamal, Chaum-Pedersen, Lagrange)** | **0** | **no, only indirectly** |
| booth: `delegation.rs` | 0 | no (a v1 stub: an enum and `IMPLEMENTED = false`) |

## 6. Test runtime per suite

```sh
for d in tools/tests spec charter/python modules/<each python module>; do time uv run --all-packages pytest -q $d; done
for w in charter/ts modules/{arena,pulse,companion,desk,lottery-verify,record-verify} apps/{citizen,portal}; do time npm test -w $w; done
time cargo test -q -p d2-door; time cargo test -q -p d2-booth
```

### 6a. Local (shared box under load, so 2–4x CI; wall seconds)

| suite | tests | s |
|---|---|---|
| tools/tests | 32 | 2.5 |
| spec | 89 | 2.1 |
| charter/python | 119 | 3.5 |
| **modules/agora** | 135 | **118** |
| modules/booth-verify | 74 | 20 |
| modules/commons | 36 | 5.5 |
| modules/docket | 37 | 3.4 |
| **modules/lottery** | 86 | **41** |
| modules/provenance | 96 | 3.0 |
| modules/record | 90 | 13.6 |
| modules/symmetry | 27 | 2.3 |
| charter/ts | 110 | 4.8 |
| modules/arena | 57 | 2.1 |
| modules/pulse | 25 | 2.9 |
| modules/companion | 130 | 8.6 |
| modules/desk | 40 | 7.5 |
| modules/lottery-verify | 49 | 4.2 |
| modules/record-verify | 54 | 15.1 |
| **apps/citizen** | 161 | **110–206** (1–3 timeouts at 5 s under load) |
| apps/portal | 37 | 55 |
| d2-door (cargo) | 39 | 334 (incl. rebuild while another cargo ran) |
| d2-booth (cargo) | 19 | 72 (warm) |

Agora's slowest tests each spawn the Lottery CLI for a panel draw (`d2_agora/sortition.py`):
`test_the_panel_draw_is_reproducible_from_the_published_inputs` 13.7 s,
`test_an_idea_takes_at_most_three_upheld_challenges` 11.9 s, `test_a_widened_idea_is_narrowed_by_a_door_panel` 11.1 s,
five more at 7–8 s. Lottery: `test_commit_draw_verify_round_trip` 9.3 s, `test_vectors_file_is_up_to_date` 7.5 s.

### 6b. CI (run 41838794149, the last green run on main)

| step | s |
|---|---|
| dev-setup.sh | 16 |
| boundaries | 0.2 |
| python (ruff + pytest) | 128 |
| typescript (typecheck, build, vitest) | 50 |
| rust (fmt, clippy, test) | 95 |
| **whole CI job** | median **331**, p90 389 (successful CI runs since 2026-10-21) |

## 7. Skipped tests

```sh
git grep -nE "pytest\.skip|skipif|xfail|pytest\.mark\.skip|\b(it|test|describe)\.(skip|only|todo)|\.skipIf|#\[ignore" -- ':!*.md'
```
One hit, and it never fires: `modules/symmetry/tests/test_symmetry.py:283` skips when
`spec/schemas/symmetry-report.schema.json` is missing, but the file is committed. No `.only`,
`.skip`, `.todo`, `xfail` or `#[ignore]`. (`pytest.importorskip("jsonschema")` in the same test
also cannot fire: jsonschema is a dev dependency.)

## 8. CI failures, last 2 weeks

```sh
gh run list --repo 7empes7s/demo2.0 --limit 400 --json conclusion,name,headBranch,createdAt,startedAt,updatedAt,databaseId,event
gh run view <id> --repo 7empes7s/demo2.0 --log-failed | grep -E "FAIL|Error"
```

2026-10-21 → 2026-11-04: 49 runs (CI 17: 14 success, 1 failure, 2 cancelled; Merge gate 17 success;
Docket snapshot 15 success). Most activity was 2026-10-05..10-09 and 2026-11-04.

The one CI failure in the window, and the CI failures before it, are all **flaky TS tests, not
real regressions**:

| run | date | failing test | cause |
|---|---|---|---|
| 41832509282 | 11-04 (main) | `modules/desk/test/desk.test.ts` "a code by post … forgets the name and address" | **privacy assertion is flaky**: `expect(after).not.toMatch(/Maria\|Lopes\|Alzette\|Weber\|Kennedy\|4011\|4170/i)` runs over a JSON dump full of random hex hashes; a hash that happens to contain `4011` or `4170` fails it (≈1–2% per run given ~30 64-char hashes). Line 197. |
| 37749064660 | 10-08 (main) | companion `ideas.test.ts` "times out on a body that stalls after the headers" | 100 ms client timeout vs 5 s test timeout under load |
| 37661449257 | 10-07 (main) | same | same |
| 37526686218 | 10-06 | companion `factcheck.test.ts` "reports a body that stalls after the headers as unavailable" | test timed out at 5000 ms |

Recurring cause: timing-sensitive "stalled body" tests in `modules/companion/test/{ideas,factcheck}.test.ts`.
Locally, under load, `apps/citizen/test/settings.test.ts` "Welcome steps … opens the week" also times
out at vitest's default 5 s. Merge gate failures (8) were all 2026-10-06 and are out of window.

## 9. Privacy and crypto hot spots

Crypto (Rust core, verifiers in other languages, cross-checked by `spec/*/vectors.json`):
- Door (BBS credentials, OPRF, pseudonyms): `modules/door/src/{issuer,holder,verifier,pseudonym,uniqueness,identity,attributes}.rs`, HTTP front `http.rs`, vectors `vectors.rs` → `spec/door/vectors.json`.
- Booth (ElGamal over ristretto255, Chaum-Pedersen, DKG): `modules/booth/src/{group,ballot,guardian,state,board,wire}.rs` → `spec/booth/vectors.json`; independent Python verifier `modules/booth-verify/src/d2_booth_verify/{verify,canonical,ristretto}.py`.
- Lottery (drand BLS, Merkle pool, draw): `modules/lottery/src/d2_lottery/{drand,pool,draw}.py`; TS verifier `modules/lottery-verify/src/{drand,verify}.ts`.
- Record (transparency log, signed notes, OTS): `modules/record/src/d2_record/{merkle,note,ots}.py`; TS verifier `modules/record-verify/src/verify.ts`; Desk's own log uses the same format in `modules/desk/src/fingerprint.ts`.
- Agora pseudonyms: HMAC in `modules/agora/src/d2_agora/identity.py:131`.

Privacy:
- Desk letters (name/address held until printed, then forgotten): `modules/desk/src/letters.ts`, guarded by `modules/desk/test/desk.test.ts:197` (the flaky regex above).
- Staff auth: `modules/desk/src/auth.ts` (scrypt, `timingSafeEqual`).
- Companion strips pseudonyms before serving ideas (`modules/companion/src/ideas.ts`), and logs only lengths of claims (`server.ts:285`); `server.ts:581` and `desk/src/server.ts:479` log the whole error object on a 500.

## 10. Cleanup backlog (proposed, ranked: privacy and crypto safety first)

Each is behaviour-preserving and one PR.

1. **De-flake the Desk "forgets the name and address" privacy check.** Where: `modules/desk/test/desk.test.ts:197`. What: match the personal strings as whole tokens (e.g. `/\b(4011|4170)\b/` and names) or strip `[0-9a-f]{32,}` hashes from the dump before matching; keep the assertion as strict for real leaks. Why: the only CI failure on main in two weeks; a flaky privacy test trains people to re-run it. Risk: low (test only). Guard: the test itself, plus a new case that plants "L 4011" in a row and expects the check to catch it.
2. **Cover the board verifier's rejection branches.** Where: `modules/booth/src/vectors.rs` `must_fail_cases`/`mutate` → `spec/booth/vectors.json`; `modules/booth-verify/src/d2_booth_verify/verify.py` lines 364, 501, 533, 586, 613, 617, 651, 653. What: add must-fail vectors (wrong `prev`, guardian out of order, guardian keys not matching commitments, tampered ballot proof, duplicate/unsorted `guardians_used`, share count ≠ options) so both Rust and Python reject them with the same code. Why: an independent verifier is only as good as its tested rejections; 45 lines of it are untested today. Risk: low (additive vectors; Rust and Python must agree). Guard: `modules/booth-verify/tests/test_vectors.py::test_must_fail_with_the_recorded_code`, `modules/booth/tests/vectors.rs`.
3. **Unit tests for `modules/booth/src/group.rs`.** What: direct tests for encoding round-trip, identity rejection, Chaum-Pedersen prove/verify and a wrong-statement failure, Lagrange at zero for small known sets. Why: the core primitives (221 lines) have no unit test of their own; failures today surface only as end-to-end vector mismatches. Risk: none (tests only). Guard: new tests + `spec/booth/vectors.json` unchanged.
4. **Split Desk's `route` (CCN 185, 233 lines).** Where: `modules/desk/src/server.ts:150`. What: a table of `{method, pattern, role, handler}` with one small handler per area (auth, enrol letters, ideas, procedures, rounds, audit), same responses and auth checks. Why: by far the most complex function in the repo, and it is where authorisation for personal data (enrol requests) is decided. Risk: medium (routing/auth); do it mechanically. Guard: `modules/desk/test/*.test.ts`, `apps/portal/test/*` and `apps/citizen/test/desk.test.ts` (912 lines of API calls) unchanged and green.
5. **One `sha256` helper in Desk.** Where: `modules/desk/src/db.ts:80` and `modules/desk/src/fingerprint.ts:26`. What: keep one (variadic, returns Buffer) and a `.toString("hex")` call site, or name them `sha256Hex`/`sha256Bytes`. Why: two same-named hash helpers with different return types in one module is a trap for the log/fingerprint code. Risk: low. Guard: `modules/desk/test/fingerprint.test.ts` (runs `spec/record/vectors/*.json`), backup/check-log tests.
6. ~~Remove the dead `deskUp` and `splitRef`~~ — **done in this PR** (`modules/companion/src/desk.ts`, `apps/portal/src/lib/text.ts`).
7. **Drop needless `export`s found by knip** (the 20 export-only symbols in section 4), file by file. Why: smaller public surface; lets the knip baseline shrink toward zero. Risk: none (typecheck proves no importer). Guard: `tsc`/`svelte-check`, knip baseline.
8. **One source for Desk status enums and wire types.** Where: `modules/desk/src/desk.ts:26-98`, copied into `apps/citizen/src/lib/desk.ts:20-87` and `apps/portal/src/lib/types.ts:79-130`. What: publish them as JSON in `spec/` (e.g. `spec/desk/enums.json`) or add a contract test in each app asserting its arrays equal Desk's. Why: three copies of `IDEA_STATUSES`, `FEEDBACK_STATUSES`, `ROUND_STATUSES`, `PROCEDURE_KINDS`, `DECLINE_REASONS` will drift silently (decline reasons are what residents are told). Risk: low. Guard: new contract test; existing app tests.
9. **De-flake the "stalled body" timeout tests.** Where: `modules/companion/test/ideas.test.ts:184`, `factcheck.test.ts:118,193`. What: give these tests an explicit vitest timeout well above the client timeout (e.g. `{ timeout: 15_000 }`) and close the fake server's socket in `afterEach`. Why: 3 of the 4 recent CI failures. Risk: none. Guard: the same tests, run 50x in a loop locally.
10. **Speed up Agora's panel tests.** Where: `modules/agora/tests/test_scope_challenge.py`, `test_door.py`; `modules/agora/src/d2_agora/sortition.py`. What: one session-scoped Lottery CLI result cache (or an in-process fake keeping the subprocess path covered by one test). Why: Agora is 118 s of the ~130 s Python step locally; eight tests spend 7–14 s each spawning the CLI. Risk: low if one real end-to-end draw test stays. Guard: `test_the_panel_draw_is_reproducible_from_the_published_inputs` kept on the real CLI.
11. **Share the design tokens between the two apps.** Where: `apps/citizen/src/tokens.css` and `apps/portal/src/tokens.css` (300+ identical lines). What: move common tokens to one file both import (apps are not modules, so the boundary rule allows it), keep app-specific overrides. Why: CLAUDE.md: "design tokens are the only colour source"; two copies already differ by a few lines. Risk: low-medium (visual). Guard: `apps/*/test/look*.test.ts`, before/after screenshots at 375 px and desktop.
12. **Split `apps/citizen/src/lib/i18n.ts` (2278 lines) by language or section.** What: one file per language behind the same `t()` API. Why: the only file over the 800-line budget; every UI PR touches it, so it is the top merge-conflict spot for parallel agents. Risk: low. Guard: the citizen i18n tests (all keys present in every language), `svelte-check`.
13. **Break up `modules/provenance/src/d2_provenance/grader.py` `_votes`/`_text`/`verdict` (CCN 46/42/40).** What: extract the per-rule checks into small named functions with unchanged order. Why: three of the four most complex Python functions, in the grader that decides what residents see as fact-checked. Risk: medium. Guard: `modules/provenance/tests/test_provenance.py` (96 tests) and `spec/examples/grade`.
14. **Remove the never-firing skip** in `modules/symmetry/tests/test_symmetry.py:283` (the schema is committed) and the `importorskip` (jsonschema is a dev dependency). Why: a skip that can't trigger hides a future deletion of the schema. Risk: none. Guard: the test now fails if the schema goes missing.
15. **Add a test that runs `modules/arena/src/cli.ts`** (`npm run check-seed -w modules/arena`). Why: the only non-entry TS source no test reaches. Risk: none. Guard: the new test.
