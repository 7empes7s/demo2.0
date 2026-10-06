# Changelog

## Unreleased

- Charter 0.2.0: `scope_challenge.panel_size` (5) and `scope_challenge.decision_days` (7), both placeholders, for Agora's ScopeChallenge panels. Schema, vectors and `charter.parsed.json` updated; `param(key, "0.1.0")` is now `unknown_version`.
- Python `Charter.jurisdiction_path` raises `TypeError` for a non-string id instead of returning an empty path.

## 0.1.0

- First Charter: scope thresholds, the tier dial, delegation, vote budget, bans, reopen windows, silent ratification, protected rights.
- Luxembourg reference data (STATEC, 1 January 2024; to be refreshed).
- Shared test vectors; Python and TypeScript bindings.
