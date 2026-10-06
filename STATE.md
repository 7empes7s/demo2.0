# STATE

Handoff file for long-running work. Newest first.

## 2026-10-06: Claim check with Provenance in the citizen app

- Done: Companion `POST /api/factcheck` proxies to Provenance over HTTP (`PROVENANCE_URL`, default `http://127.0.0.1:8090`), validates every grade against `spec/schemas/grade.schema.json` (502 if invalid, 503 if unreachable, 413 over 500 characters or 4 KiB, no model key needed). Citizen app: "Heard something about it?" on each file and a "Check a claim" page (`#check`), grade + plain reason + evidence links, "no document mentions this" and "checker unavailable" states, five languages, component tests in jsdom. `ops/deploy/civic-provenance.service` (loopback, `PartOf=civic-companion.service`), health URL added to the deployer.
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
