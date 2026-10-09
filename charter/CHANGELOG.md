# Changelog

## Unreleased

- Charter 0.4.0: Constitution citations checked against the 2023 text (Chambre des Députés edition of 21 April 2023, plus the June 2026 alinéa in Article 15(3)). The 8 constitutional protected rights and `charter_change.majority` now cite their articles and are `verified`: integrity Arts. 12-13, equality Art. 15(1)-(2), expression and press Art. 23, assembly and association Arts. 25-26, conscience and religion Arts. 14 and 24, privacy and data Arts. 20, 21, 30, 31 and 15(4), fair trial Arts. 18, 19 and 110, vote and secret ballot Arts. 63 and 122 (corrected: not Chapitre II), revision Art. 131. ECHR cross-references `verified`; `lu_constitution_2023` and `echr` marked `consulted`. `charter_change.quorum_share_of_electorate` becomes `basis: project` because Article 131 sets no turnout condition. No rule value changed. Counts: 9 constitution-bound, 1 law-bound, 49 project-chosen; 9 verified, 1 to verify. `param(key, "0.3.0")` is now `unknown_version`.
- Charter 0.3.0: provenance. Decision of 2026-10-06: for the Luxembourg version the Charter is the Luxembourg Constitution (2023 text). New `sources` section (`lu_constitution_2023`, `lu_electoral_law`, `echr`, `d2_architecture`), a `provenance` section with `basis` (`constitution | law | project`) and `source` (`{instrument, article | chapter | right, status: verified | to_verify | none, note, cross_references}`) for every rule, and the same two fields inline on every protected right. 10 rules are constitution-bound, 1 law-bound, 48 project-chosen; all 11 legal citations are `to_verify` (no 2023 article number is cited until read on Legilux). No rule value changed. Schema validates the new fields and requires an `article` on a `verified` entry. New `CONSTITUTION.md` (method, full table, Legilux checklist) and `vectors/provenance.json`. `data/lu-jurisdictions.json` gains `population_source: {name: STATEC, status: to_verify}`. `param(key, "0.2.0")` is now `unknown_version`.
- Charter 0.2.0: `scope_challenge.panel_size` (5) and `scope_challenge.decision_days` (7), both placeholders, for Agora's ScopeChallenge panels. Schema, vectors and `charter.parsed.json` updated; `param(key, "0.1.0")` is now `unknown_version`.
- Python `Charter.jurisdiction_path` raises `TypeError` for a non-string id instead of returning an empty path.

## 0.1.0

- First Charter: scope thresholds, the tier dial, delegation, vote budget, bans, reopen windows, silent ratification, protected rights.
- Luxembourg reference data (STATEC, 1 January 2024; to be refreshed).
- Shared test vectors; Python and TypeScript bindings.
