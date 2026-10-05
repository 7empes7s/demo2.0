# Changelog

## 0.1.0 (unreleased)

- First harness: versioned suite format, mirrored yes/no pairs with wording and demographic variants.
- `Target` protocol with an HTTP target (stdlib only) and a `FakeTarget`.
- `Judge` protocol with a `FakeJudge` and an `LLMJudge` using rubric `symmetry-rubric/1`.
- Gap metrics (overall and per-topic median, 5% threshold) and a test-retest check (within 1 point).
- `SymmetryReport` JSON and the `python -m d2_symmetry` CLI (`run`, `retest`).
- Seed suite `suites/v0.json`: 12 generic, synthetic civic scenarios.
