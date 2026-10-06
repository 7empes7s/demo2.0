# Changelog

## 0.1.0 (unreleased)

- `match/2` checker: grades a claim green, yellow or red against a Docket snapshot, with
  evidence (link, passage, locator) on every grade; no grade when no record mentions the claim.
- Structured checks for deposit dates and council vote tallies; sentence checks for numbers and
  dates in record text; opinions and negation mismatches are never green or red.
- Dates in fr, de, en, pt and lb; numbers with `.`, `,` or space thousands separators.
- HTTP API (`POST /claims/grade`, `GET /checkers`, `GET /healthz`), stdlib only. Grades match
  `spec/schemas/grade.schema.json`.
- CLI `d2-provenance` (`grade`, `serve`, `eval`).
- A matching deposit date or vote tally is green only when the record states the rest of the
  claim; vote outcomes are checked; comparisons (*plus de* / *moins de*) must match; a dossier
  named in the claim wins over `context`, and an unknown `context` is bad input.
- Digits of any script, invisible characters and English contractions are read as shown; a word
  mixing alphabets is yellow.
- The API times out a body that does not arrive (408) and answers deep JSON nesting with 400.
- Seed labelled sets: 49 claims on recorded Docket pages, 45 on synthetic bills, 34 of them
  adversarial. Red precision 100% and no false green on both.
