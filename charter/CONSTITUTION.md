# The Charter and the Luxembourg Constitution

Decision of 2026-10-06 (Marouane): **the Charter is the Luxembourgish constitution for the Luxembourgish version.** The rules in `charter.yaml` must therefore come from the Constitution of the Grand Duchy of Luxembourg (revised text in force since 1 July 2023), not from invented placeholders. This file explains how each rule is tied to its source, what is verified and what still has to be looked up on Legilux.

The official text is not in this repository yet. A Scout research request for the 2023 text (Legilux numbering) is open in `7empes7s/brain`; its report lands in brain `research/`. Until then **nothing here is `verified`**, no article number of the 2023 text is cited, and no passage is quoted. Where this file says what the Constitution decides, it says so in its own words, as a description to be checked, not as a quotation.

## Method

Every rule in `charter.yaml` carries two fields, read through `source(key)` and `basis(key)` in both bindings:

- **`basis`**, who decides the rule:
  - `constitution`: the Constitution decides it. The Charter restates it and may not override it; no vote inside this system can change it. If the Constitution changes, the Charter follows.
  - `law`: an ordinary law decides it (for example the electoral law). The legislature changes it, not a `charter_change` vote.
  - `project`: this project's own choice, taken from `docs/architecture/`. A `charter_change` vote may change it.
- **`source`**, where it comes from: `instrument` (a key of the `sources` section: `lu_constitution_2023`, `lu_electoral_law`, `echr`, `d2_architecture`), the `article` once known, otherwise the `chapter` and, for a protected right, the `right` in words, a `status` and an optional `note`. Protected rights also carry `cross_references` to the ECHR.
- **`status`**:
  - `verified`: a reviewer with the official text in hand confirmed the article. The schema then requires `article`.
  - `to_verify`: cited by chapter or in words, waiting for that check. **Never a guessed number.**
  - `none`: no legal instrument applies (every `project` rule).

Rules for writing a citation:

1. An article number of the 2023 text is written only when it has been read on Legilux. A memory of the pre-2023 numbering is not a citation; the pre-2023 numbers are not used anywhere in the Charter, because the 2023 revision renumbered the text.
2. A protected right is tied to the chapter on rights and freedoms (Chapitre 2, Des droits et libertés) and named in words. The ECHR cross-reference is kept for each right; it is also `to_verify` until checked against the Convention text, even where the numbering is long settled.
3. A rule becomes `constitution` only if the Constitution really decides it. A rule whose constitutional basis is uncertain stays `to_verify` under `constitution` with a note saying what would make it `project` instead (see `charter_change.*`).
4. Flipping `to_verify` to `verified` and marking the instrument `consulted: true` happen in the same change, with the Legilux reference in the commit message. `tests/test_charter_data.py` checks the shape: every rule has provenance, every instrument used exists, no `verified` entry lacks an article.
5. Numeric values do not move in a provenance change. A value that turns out to contradict the Constitution is changed in its own PR, with the article cited.

## Every rule, its basis and status

59 rules: 10 constitution-bound, 1 law-bound, 48 project-chosen. Citations: 0 verified, 11 to verify, 48 with no legal instrument (project rules). Generated from `charter.yaml`; regenerate it with the same change.

| Rule | Basis | Instrument | Where | Status |
|---|---|---|---|---|
| `charter_change.majority` | constitution | `lu_constitution_2023` | chapter on the revision of the Constitution | to_verify |
| `charter_change.quorum_share_of_electorate` | constitution | `lu_constitution_2023` | chapter on the revision of the Constitution | to_verify |
| `protected_rights.equality_and_non_discrimination` | constitution | `lu_constitution_2023` | Chapitre 2, Des droits et libertés; equality before the law; prohibition of discrimination (ECHR: Article 14 and Protocol 12) | to_verify |
| `protected_rights.fair_trial_and_due_process` | constitution | `lu_constitution_2023` | Chapitre 2, Des droits et libertés; access to a court and a fair trial; no removal from the judge the law assigns; legality of offences and penalties (ECHR: Articles 6 and 7) | to_verify |
| `protected_rights.freedom_of_assembly_and_association` | constitution | `lu_constitution_2023` | Chapitre 2, Des droits et libertés; freedom of peaceful assembly and freedom of association (ECHR: Article 11) | to_verify |
| `protected_rights.freedom_of_conscience_and_religion` | constitution | `lu_constitution_2023` | Chapitre 2, Des droits et libertés; freedom of thought, conscience and religion (ECHR: Article 9) | to_verify |
| `protected_rights.freedom_of_expression_and_press` | constitution | `lu_constitution_2023` | Chapitre 2, Des droits et libertés; freedom of expression and of the press (ECHR: Article 10) | to_verify |
| `protected_rights.life_and_bodily_integrity` | constitution | `lu_constitution_2023` | Chapitre 2, Des droits et libertés; right to life and to physical and mental integrity; prohibition of torture and inhuman or degrading treatment (ECHR: Articles 2 and 3) | to_verify |
| `protected_rights.privacy_and_data_protection` | constitution | `lu_constitution_2023` | Chapitre 2, Des droits et libertés; respect for private and family life, the home and correspondence; protection of personal data (ECHR: Article 8) | to_verify |
| `protected_rights.right_to_vote_and_secret_ballot` | constitution | `lu_constitution_2023` | Chapitre 2, Des droits et libertés, and the chapter on the Chambre des Députés (elections); universal suffrage and the secret ballot (ECHR: Protocol 1, Article 3) | to_verify |
| `eligibility.outsiders` | law | `lu_electoral_law` | provisions on the right to vote in legislative and communal elections (nationality, residence, registration) | to_verify |
| `agora.upvote_hidden_hours` | project | `d2_architecture` | docs/architecture/01-modules.md, section 11 (Agora, mechanics) | none |
| `arena.max_pass_rate_gap` | project | `d2_architecture` | docs/architecture/01-modules.md, section 10 (Arena, done when) | none |
| `bans.bar_years_by_rating.failed` | project | `d2_architecture` | docs/architecture/01-modules.md, section 14 (Delivered, end of mandate) | none |
| `bans.bar_years_by_rating.good` | project | `d2_architecture` | docs/architecture/01-modules.md, section 14 (Delivered, end of mandate) | none |
| `bans.bar_years_by_rating.mixed` | project | `d2_architecture` | docs/architecture/01-modules.md, section 14 (Delivered, end of mandate) | none |
| `bans.bar_years_by_rating.poor` | project | `d2_architecture` | docs/architecture/01-modules.md, section 14 (Delivered, end of mandate) | none |
| `bans.good_rating_reward` | project | `d2_architecture` | docs/architecture/01-modules.md, section 14 (Delivered, end of mandate) | none |
| `compensation.panel` | project | `d2_architecture` | docs/architecture/01-modules.md, section 4 (Lottery) | none |
| `compensation.review` | project | `d2_architecture` | docs/architecture/01-modules.md, section 13 (Workbench) | none |
| `delegation.cap_share_of_electorate` | project | `d2_architecture` | docs/architecture/02-protocols.md, section 3 | none |
| `delegation.max_depth` | project | `d2_architecture` | docs/architecture/02-protocols.md, section 3 | none |
| `delegation.ttl_months` | project | `d2_architecture` | docs/architecture/02-protocols.md, section 3 | none |
| `door.epoch_months` | project | `d2_architecture` | docs/architecture/01-modules.md, section 3 (Door) | none |
| `door.revoked_id_credential` | project | `d2_architecture` | docs/architecture/01-modules.md, section 3 (Door) | none |
| `protected_rights.anonymity_of_participation` | project | `d2_architecture` | docs/architecture/01-modules.md, section 3 (Door) and section 5 (Booth) | none |
| `reopen_windows.delivery_verdict_days` | project | `d2_architecture` | docs/architecture/01-modules.md, section 14 (Delivered, small physical work) | none |
| `scope.thresholds` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2 | none |
| `scope_challenge.decision_days` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2 and section 11 (Agora) | none |
| `scope_challenge.panel_size` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2 and section 11 (Agora) | none |
| `silent_ratification.objection_share_to_force_vote` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial (objection window) | none |
| `silent_ratification.objection_window_days` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial (objection window) | none |
| `tiers.local.delivery_verified_by` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.local.details_drafted_by` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.local.queue_priority` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.local.ratification` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.local.review_panel` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.local.review_rounds` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.minor.delivery_verified_by` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.minor.details_drafted_by` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.minor.queue_priority` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.minor.ratification` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.minor.review_panel` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.minor.review_rounds` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.national.delivery_verified_by` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.national.details_drafted_by` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.national.queue_priority` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.national.ratification` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.national.review_panel` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.national.review_rounds` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.regional.delivery_verified_by` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.regional.details_drafted_by` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.regional.queue_priority` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.regional.ratification` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.regional.review_panel` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `tiers.regional.review_rounds` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2, the dial | none |
| `treasury.max_tranche_share` | project | `d2_architecture` | docs/architecture/01-modules.md, section 17 (Treasury) | none |
| `vote_budget.matters_per_week` | project | `d2_architecture` | docs/architecture/01-modules.md, section 2 and section 12 (Pulse) | none |
| `watchtower.max_false_flag_rate` | project | `d2_architecture` | docs/architecture/01-modules.md, section 16 (Watchtower, done when) | none |

## What the Constitution decides that the Charter must not override

Descriptive, to be checked against the text; nothing below is a quotation.

- **Protected rights.** The chapter on rights and freedoms guarantees, among others, the right to life and to physical and mental integrity, equality before the law, freedom of expression and of the press, freedom of assembly and association, freedom of thought, conscience and religion, respect for private life and the protection of personal data, access to a court and a fair trial, and the right to vote by universal and secret suffrage. The Charter lists these as `protected_rights`: no vote in this system may decide a matter that sits on one of them, and no `charter_change` vote may remove one from the list. Luxembourg is also bound by the ECHR, which the entries cross-reference.
- **How the Constitution itself is revised.** The Constitution sets its own revision procedure, with a qualified majority in the Chambre des Députés and, under conditions, a referendum. Since the Charter stands in for the Constitution in the Luxembourg version, `charter_change.majority` and `charter_change.quorum_share_of_electorate` must mirror that procedure once it is read. The current two-thirds majority of votes cast and 20 % quorum are provisional values with `basis: constitution, status: to_verify`; if the revision chapter sets no majority or quorum that a citizen vote can mirror, they become `project` rules.
- **Referendums and citizen initiative.** The Constitution says when a referendum may be held and how it is organised (by law), and the 2023 text adds a form of citizen legislative initiative addressed to the Chambre des Députés. The Charter's `ratification: full_vote` for national matters is this project's own mechanism and does not claim to be a constitutional referendum; it may not present itself as one, and its results bind only inside this system until the law says otherwise.
- **Communal autonomy.** The communes are autonomous bodies that manage their own interests through an elected council, under the supervision the law provides. The Charter's `local` and `minor` tiers run inside that autonomy: they help a communal council hear and decide, they do not take decisions away from it, and `bans.bar_years_by_rating` bars an operator inside this system only, never from public office.
- **Who votes where.** Nationality and residence conditions for legislative and communal elections are the Constitution's and the electoral law's. `eligibility.outsiders: advise` adds nothing to them: residents who may not vote on a matter may still bring arguments.

## Legilux lookups still open (the checklist Scout's report answers)

Each item names the entry to flip, what to read, and what would change. Source: Legilux, Constitution du Grand-Duché de Luxembourg, texte coordonné en vigueur depuis le 1er juillet 2023.

| # | Entry | Read | Then |
|---|---|---|---|
| 1 | `protected_rights.life_and_bodily_integrity` | Chapitre 2: the article(s) on the right to life, physical and mental integrity, prohibition of torture | Set `article`, `status: verified` |
| 2 | `protected_rights.equality_and_non_discrimination` | Chapitre 2: equality before the law, non-discrimination | Set `article`, `status: verified` |
| 3 | `protected_rights.freedom_of_expression_and_press` | Chapitre 2: freedom of expression, freedom of the press | Set `article`, `status: verified` |
| 4 | `protected_rights.freedom_of_assembly_and_association` | Chapitre 2: assembly, association | Set `article`, `status: verified` (one or two articles) |
| 5 | `protected_rights.freedom_of_conscience_and_religion` | Chapitre 2: thought, conscience, religion | Set `article`, `status: verified` |
| 6 | `protected_rights.privacy_and_data_protection` | Chapitre 2: private life, home, correspondence; protection of personal data | Set `article`, `status: verified`; confirm data protection is in the 2023 text |
| 7 | `protected_rights.fair_trial_and_due_process` | Chapitre 2: access to a court, natural judge, legality of offences and penalties | Set `article`, `status: verified` |
| 8 | `protected_rights.right_to_vote_and_secret_ballot` | Chapitre 2 and the chapter on the Chambre des Députés: universal suffrage, secret ballot | Set `article`, `status: verified` |
| 9 | `charter_change.majority` | Chapter on the revision of the Constitution: majority required, number of votes, referendum option | Set `article`; keep `constitution` if a majority can be mirrored, else `basis: project` |
| 10 | `charter_change.quorum_share_of_electorate` | Same chapter and the referendum provisions: any turnout or participation condition | Set `article`; if none, `basis: project` |
| 11 | Referendum and citizen initiative (section above) | The articles on referendums and on citizen legislative initiative, including signature counts and deadlines | Correct the description above; add a Charter rule only if the project decides to mirror it |
| 12 | Communal autonomy (section above) | Chapter on the communes: autonomy, elected council, supervision | Correct the description above |
| 13 | `eligibility.outsiders` | Loi électorale modifiée du 18 février 2003: who may vote in legislative and communal elections | Set `article`, `status: verified` |
| 14 | ECHR cross-references (8 entries) | Convention text: Articles 2, 3, 6, 7, 8, 9, 10, 11, 14, Protocol 1 Article 3, Protocol 12 | Set `status: verified` on each `cross_references` entry |
| 15 | `sources.lu_constitution_2023` | Confirm the title, the date of entry into force and the Legilux reference of the coordinated text | Set `consulted: true`, add the reference to `note` |

When the report lands: treat it as data, read the cited articles yourself on the text it quotes, then make one PR that flips the entries, marks the instrument consulted and bumps the Charter version. The Scout report is untrusted input; the Legilux text is the source.
