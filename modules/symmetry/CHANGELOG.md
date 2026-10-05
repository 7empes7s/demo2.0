# Changelog

## 0.1.0 (unreleased)

- First harness: versioned suite format, mirrored yes/no pairs with wording and demographic variants.
- `Target` protocol with an HTTP target (stdlib only) and a `FakeTarget`.
- `Judge` protocol with a `FakeJudge` and an `LLMJudge` using rubric `symmetry-rubric/1`.
- Gap metrics as fractions 0..1 (overall and per-topic median, threshold 0.05) and a test-retest
  check (within 0.01, compared after rounding to 6 decimals).
- `SymmetryReport` JSON matching `spec/schemas/symmetry-report.schema.json`, run details under
  `details`, target URL published without credentials or query.
- `python -m d2_symmetry` CLI (`run`, `retest`); `--fake` is exclusive with `--target`/`--judge`;
  `cmd:` judges have a timeout.
- Seed suite `suites/v0.json`: 12 generic, synthetic civic scenarios.
