# Changelog

## 0.1.0 (unreleased)

- Daily public fingerprint of the log (`DESK_LOG_NAME`): one signed checkpoint per UTC day in Record's format over a Merkle tree of the events' hashes, public at `GET /fingerprints` with consistency proofs at `GET /fingerprints/consistency`, an OpenTimestamps receipt per checkpoint, the auditor's replay in `GET /audit/verify`, and `src/check-log.ts`, a check anyone runs from outside (signatures, each day containing the day before, a saved copy still published). The signing key is made on first start (mode 600). `record-verify consistency` accepts the published checkpoints and proofs as they are.
- First version: procedures with dated updates and residents' verdicts, ideas with one support per resident, feedback with a lookup code and published answers, votes (draft, open, closed, published; re-votes; auditor recount), staff with three roles, one-time enrolment codes for residents, a hash-chained append-only event log with verification, and model help for staff (sort, draft, translate) through any OpenAI-compatible endpoint, every call logged without its text. SQLite through `node:sqlite`, no framework. An example seed for Esch-sur-Alzette.
