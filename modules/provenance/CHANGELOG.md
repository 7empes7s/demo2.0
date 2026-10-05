# Changelog

## 0.1.0 (unreleased)

- `match/1` checker: grades a claim green, yellow or red against a Docket snapshot, with
  evidence (link, passage, locator) on every grade; no grade when no record mentions the claim.
- Structured checks for deposit dates and council vote tallies; sentence checks for numbers and
  dates in record text; opinions and negation mismatches are never green or red.
- Dates in fr, de, en, pt and lb; numbers with `.`, `,` or space thousands separators.
- HTTP API (`POST /claims/grade`, `GET /checkers`, `GET /healthz`), stdlib only. Grades match
  `spec/schemas/grade.schema.json`.
- CLI `d2-provenance` (`grade`, `serve`, `eval`).
- Seed labelled sets: 32 claims on recorded Docket pages, 28 on synthetic bills. Red precision
  100% on both.
