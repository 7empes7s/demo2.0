# STATE

Handoff file for long-running work. Newest first.

## 2026-10-06: Door v1 protocol core (first Rust module)

- Done: `modules/door` (`d2-door`, AGPL, unaudited): issuer keys per epoch (BBS over BLS12-381, `zkryptium` 0.7.1), uniqueness key `u = OPRF_K(person_id)` (`voprf` 0.5.0, RFC 9497, single key) with a store that refuses a second enrolment per `u` per epoch, blind BBS issuance over the holder's committed secret plus jurisdiction path (one message per level), adult, epoch and revocation handle, presentations with prefix disclosure and per-context pseudonyms (per-verifier-linkability draft), `verify` with precise errors, `d2-door` CLI, `spec/door/` format and generated vectors (18 presentation cases, 13 must-fail) with a drift test. Root Cargo workspace, `rust-toolchain.toml` (1.97.0), dev-setup installs rustup, CI caches cargo; `tools/boundaries.py` understands Rust (`d2_<module>::` and Cargo `path` deps). Mock identity provider only.
- Found: `zkryptium` byte parsers panic on short input and `proof_verify_with_nym` has an unchecked subtraction on the proof's scalar count; Door enforces exact lengths before the library sees anything. Its `calculate_b` uses `P1` where the draft uses `Q_1`, so interop with other BBS implementations is unproven; the published crate ships no CFRG fixtures and GitHub was unreachable, so none were run.
- Deviations from 02-protocols section 1 are listed in `modules/door/README.md`: mock identity input, single in-memory OPRF key, `rid` stored in the clear (no threshold escrow), no revocation accumulator, holder commits to `s` only, nothing written to Record, in-memory store.
- Next: `DoorNyms` for Agora's `NymSource` (plan in the README), HTTP API and Record publication of issuer keys, durable store, threshold OPRF and `rid` escrow, revocation accumulator, EUDI/LuxTrust relying-party registration (ask for Marouane), WASM/UniFFI holder build, run CFRG fixtures from a session that can reach the upstream repo.

## 2026-10-06: Commons seeded from Esch, Companion draws from it

- Done: `d2_commons` 0.2.0 ingests Esch council groups' recorded votes (from a Docket snapshot) and resident proposals on participation.esch.lu into spec Arguments (new optional `kind`, `attribution`, `source_url`), with no person named and contact details removed; `seed/esch.json` (14 arguments from recorded fixtures); read API `GET /matters/{id}/arguments` and CLI `d2-commons`. Companion's devil's advocate reads Commons over HTTP (`COMMONS_URL`) first, returns each shown argument with origin and link, labels model-written points, and drops them when Commons has 2 or more reasons on the other side (recorded votes are shown but are not reasons, so on Esch point lu.esch.42063 the documents and labelled model points still supply reasons). Commons text enters the prompt as fenced one-line quoted data.
- Evidence for the 80% bar, scripted only: on 9 turns where Commons holds 2+ reasons on the other side and the scripted model also returns its own points and a document argument, 100% of shown arguments came from Commons; with the Commons-first rule switched off (test seam) the same script gives 25%. So the test shows the rule works, not that a real model meets the bar. Those reasons are synthetic test data: the recorded Esch seed has only council positions (which don't count) and resident proposals (not tied to a yes/no side, so they never reach the Companion yet).
- Known limits: position and attribution text in the seed is English only and has no structured fields (group, count, side, date), so the app shows it unchanged in lb/fr/de/pt; localising it needs those fields in the Argument schema. Name scrubbing catches only "proposé par / proposed by / vorgeschlagen von <Name>"; other ways of writing a name are not caught.
- Next: live ingest from a session that can reach participation.esch.lu and workflow.esch.lu (this one got 403 from the proxy), so the seed covers every voted point, not one; read full proposal text from each proposal page (the project page shows only the start); reasons, not only positions, for council points (minutes or rapports, once a privacy rule for names in PDFs exists); a `civic-commons` systemd unit and `COMMONS_URL` on Mulinux; `POST /arguments` and ratings with Door; measure the 80% bar on live turns, not scripted ones; tag resident proposals with a side so they can reach the Companion.

## 2026-10-06: Claim check with Provenance in the citizen app

- Done: Companion `POST /api/factcheck` proxies to Provenance over HTTP (`PROVENANCE_URL`, default `http://127.0.0.1:8090`), validates every grade against `spec/schemas/grade.schema.json` (502 if invalid, 503 if unreachable, 413 over 500 characters or 4 KiB, no model key needed). Citizen app: "Heard something about it?" on each file and a "Check a claim" page (`#check`), grade + plain reason + evidence links, "no document mentions this" and "checker unavailable" states, five languages, component tests in jsdom. `ops/deploy/civic-provenance.service` (loopback, `PartOf=civic-companion.service`). The checker is optional and does not gate deploys: the Companion `/healthz` reports `provenance: true|false`. "No record" only on Provenance's `no_record` / `unknown_context` codes; any other upstream error is 503 and logged.
- Next: install `civic-provenance` on Mulinux when the civic stack is installed; retire the model-based `/api/claim` once the single-file demo can reach a checker; Commons wiring.

## 2026-10-05: Phase 2, Lottery v1

- Done: `modules/lottery` (pool Merkle root, commitments to a drand round at least an hour ahead, full BLS beacon verification with injectable fetch, stratified draw with replacements, CLI), `modules/lottery-verify` (independent TypeScript verifier), `spec/lottery/` (format, recorded real beacons, vectors). Panel sizes from Charter `tiers.<tier>.review_panel`.
- Next: HTTP API and `draw.commit` / `draw.result` entries in Record; record a mainnet quicknet beacon from a session that can reach a drand relay; LEXIMIN for multi-attribute quotas.

## 2026-10-05: Provenance v1

- Done: `modules/provenance` (`d2_provenance`, AGPL): deterministic `match/2` checker over a Docket snapshot (deposit dates, council vote tallies and outcomes, numbers and dates in record text), HTTP API `POST /claims/grade` + `GET /checkers`, CLI, two seed labelled sets (94 claims, 34 adversarial; red precision 100%, no false green; agreement 61% and 64%).
- Next: grow the labelled set to 500 claims on a live snapshot; a second checker (language model, quote-verified) publishing through the same schema; live link check for evidence URLs (eval checks only that each link is http(s) with a host); raise red recall on the adversarial claims (outcome negation, record status, derived figures); wire Companion and Commons to the API.

## 2026-10-05: Docket Esch-sur-Alzette source

- Done: Docket snapshot/2 with Chamber and Esch sources (council points with votes, consultations); companion and citizen app read /1 and /2 and show Esch files.
- Next: fetch and extract Esch PDFs once there is a privacy rule for names in them; parse rapports analytiques and written questions.

## 2026-10-05: Phase 0, Record MVP

- Done: `modules/record` (log, checkpoints, proofs, HTTP API, CLI, OpenTimestamps), `modules/record-verify` (independent TypeScript verifier), `spec/record/` (format and vectors), 1M-entry benchmark.
- Next: first real anchor from Mulinux and its Bitcoin verification (Phase 0 acceptance), tiles, witnesses, signer roles in `spec/record-types.json`.

## 2026-10-05: Charter v0 and Scope

- Done: `charter/charter.yaml` 0.1.0 with schema, Luxembourg reference data, `d2_charter` (Python) and `@democracy2/charter` (TypeScript) passing shared vectors.
- Next: Rust binding; refresh populations from STATEC; decide the placeholders listed in the PR.

## 2026-10-05: overnight build, Phase 1 (Companion standalone)

- Done: repo pipeline (CI, merge gate, dev-setup, check, module boundary lint).
- Next: architecture docs, `spec/` schemas, Docket, Commons ranker, Provenance, Symmetry, citizen app.
- Waiting on Marouane: see the thread's bundled list.
