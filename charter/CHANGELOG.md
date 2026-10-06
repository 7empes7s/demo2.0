# Changelog

## Unreleased

- Charter 0.3.0: provenance. Decision of 2026-10-06: for the Luxembourg version the Charter is the Luxembourg Constitution (2023 text). New `sources` section (`lu_constitution_2023`, `lu_electoral_law`, `echr`, `d2_architecture`), a `provenance` section with `basis` (`constitution | law | project`) and `source` (`{instrument, article | chapter | right, status: verified | to_verify | none, note, cross_references}`) for every rule, and the same two fields inline on every protected right. 10 rules are constitution-bound, 1 law-bound, 48 project-chosen; all 11 legal citations are `to_verify` (no 2023 article number is cited until read on Legilux). No rule value changed. Schema validates the new fields and requires an `article` on a `verified` entry. New `CONSTITUTION.md` (method, full table, Legilux checklist) and `vectors/provenance.json`. `data/lu-jurisdictions.json` gains `population_source: {name: STATEC, status: to_verify}`. `param(key, "0.2.0")` is now `unknown_version`.
- Charter 0.2.0: `scope_challenge.panel_size` (5) and `scope_challenge.decision_days` (7), both placeholders, for Agora's ScopeChallenge panels. Schema, vectors and `charter.parsed.json` updated; `param(key, "0.1.0")` is now `unknown_version`.
- Python `Charter.jurisdiction_path` raises `TypeError` for a non-string id instead of returning an empty path.

## 0.1.0

- First Charter: scope thresholds, the tier dial, delegation, vote budget, bans, reopen windows, silent ratification, protected rights.
- Luxembourg reference data (STATEC, 1 January 2024; to be refreshed).
- Shared test vectors; Python and TypeScript bindings.
