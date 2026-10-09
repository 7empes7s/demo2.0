# The Charter and the Luxembourg Constitution

Decision of 2026-10-06 (Marouane): **the Charter is the Luxembourgish constitution for the Luxembourgish version.** The rules in `charter.yaml` must therefore come from the Constitution of the Grand Duchy of Luxembourg (revised text in force since 1 July 2023), not from invented placeholders. This file explains how each rule is tied to its source, what is verified and what still has to be looked up on Legilux.

**What was read (2026-10-09).** The 2023 text, in the Chambre des Députés edition *Constitution en 3 langues* of 21 April 2023 ([PDF](https://www.chd.lu/sites/default/files/2023-04/Constitution_en%203%20langues.pdf)): the text in force since 1 July 2023, 12 chapters, Articles 1 to 132, French text authoritative as published in the Journal officiel. One later revision is taken into account: on 16 June 2026 the Chambre adopted an alinéa on the freedom to have an abortion in Article 15, paragraph 3; it renumbers nothing. The Legilux coordinated text itself refuses automated access, so its page was not read; if Legilux shows any other revision after June 2026, re-check the entries it touches. The ECHR article headings were read in the Council of Europe's English text ([PDF](https://www.echr.coe.int/documents/d/echr/convention_ENG)).

Every Constitution citation in the Charter is now `verified` with its article. Only `eligibility.outsiders` (the electoral law, not yet read) stays `to_verify`. Where this file says what the Constitution decides, it says so in its own words, not as a quotation.

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
2. A protected right cites the article(s) of the 2023 text that guarantee it, with the chapter and the right in words. Most sit in Chapitre II (Des droits et libertés), but not all: the vote is in Chapitres IV and IX, fair proceedings in Chapitre VII. The ECHR cross-reference is kept for each right and checked against the Convention text like any other citation.
3. A rule becomes `constitution` only if the Constitution really decides it. A rule whose constitutional basis is uncertain stays `to_verify` under `constitution` with a note saying what would make it `project` instead (see `charter_change.*`).
4. Flipping `to_verify` to `verified` and marking the instrument `consulted: true` happen in the same change, with the reference of the text read in the commit message. `tests/test_charter_data.py` checks the shape: every rule has provenance, every instrument used exists, no `verified` entry lacks an article.
5. Numeric values do not move in a provenance change. A value that turns out to contradict the Constitution is changed in its own PR, with the article cited.

## Every rule, its basis and status

59 rules: 9 constitution-bound, 1 law-bound, 49 project-chosen. Citations: 9 verified, 1 to verify, 49 with no legal instrument (project rules). Generated from `charter.yaml`; regenerate it with the same change.

| Rule | Basis | Instrument | Where | Status |
|---|---|---|---|---|
| `charter_change.majority` | constitution | `lu_constitution_2023` | Article 131 (Chapitre XI, De la révision de la Constitution) | verified |
| `protected_rights.equality_and_non_discrimination` | constitution | `lu_constitution_2023` | Article 15, paragraphs 1 and 2 (Chapitre II, Des droits et libertés, section 3 (Des libertés publiques)); equality before the law; prohibition of discrimination (ECHR: Article 14 and Protocol 12) | verified |
| `protected_rights.fair_trial_and_due_process` | constitution | `lu_constitution_2023` | Articles 18, 19 and 110 (Chapitre II, Des droits et libertés, and Chapitre VII, De la Justice, section 4 (Des garanties du justiciable)); access to a court and a fair trial; no removal from the judge the law assigns; legality of offences and penalties (ECHR: Articles 6 and 7) | verified |
| `protected_rights.freedom_of_assembly_and_association` | constitution | `lu_constitution_2023` | Articles 25 and 26 (Chapitre II, Des droits et libertés, section 3 (Des libertés publiques)); freedom of peaceful assembly and freedom of association (ECHR: Article 11) | verified |
| `protected_rights.freedom_of_conscience_and_religion` | constitution | `lu_constitution_2023` | Articles 14 and 24 (Chapitre II, Des droits et libertés, sections 2 and 3); freedom of thought, conscience and religion (ECHR: Article 9) | verified |
| `protected_rights.freedom_of_expression_and_press` | constitution | `lu_constitution_2023` | Article 23 (Chapitre II, Des droits et libertés, section 3 (Des libertés publiques)); freedom of expression and of the press (ECHR: Article 10) | verified |
| `protected_rights.life_and_bodily_integrity` | constitution | `lu_constitution_2023` | Articles 12 and 13 (Chapitre II, Des droits et libertés, section 2 (Des droits fondamentaux)); right to physical and mental integrity; prohibition of torture and inhuman or degrading treatment; no death penalty; human dignity (ECHR: Articles 2 and 3) | verified |
| `protected_rights.privacy_and_data_protection` | constitution | `lu_constitution_2023` | Articles 20, 21, 30 and 31, and Article 15, paragraph 4 (Chapitre II, Des droits et libertés, section 3 (Des libertés publiques)); respect for private and family life, the home and correspondence; protection of personal data (ECHR: Article 8) | verified |
| `protected_rights.right_to_vote_and_secret_ballot` | constitution | `lu_constitution_2023` | Articles 63 and 122 (Chapitre IV, De la Chambre des Députés, and Chapitre IX, Des communes); universal suffrage and the secret ballot (ECHR: Protocol 1, Article 3) | verified |
| `eligibility.outsiders` | law | `lu_electoral_law` | provisions on the right to vote in legislative and communal elections (nationality, residence, registration) | to_verify |
| `agora.upvote_hidden_hours` | project | `d2_architecture` | docs/architecture/01-modules.md, section 11 (Agora, mechanics) | none |
| `arena.max_pass_rate_gap` | project | `d2_architecture` | docs/architecture/01-modules.md, section 10 (Arena, done when) | none |
| `bans.bar_years_by_rating.failed` | project | `d2_architecture` | docs/architecture/01-modules.md, section 14 (Delivered, end of mandate) | none |
| `bans.bar_years_by_rating.good` | project | `d2_architecture` | docs/architecture/01-modules.md, section 14 (Delivered, end of mandate) | none |
| `bans.bar_years_by_rating.mixed` | project | `d2_architecture` | docs/architecture/01-modules.md, section 14 (Delivered, end of mandate) | none |
| `bans.bar_years_by_rating.poor` | project | `d2_architecture` | docs/architecture/01-modules.md, section 14 (Delivered, end of mandate) | none |
| `bans.good_rating_reward` | project | `d2_architecture` | docs/architecture/01-modules.md, section 14 (Delivered, end of mandate) | none |
| `charter_change.quorum_share_of_electorate` | project | `d2_architecture` | docs/architecture/02-protocols.md, section 4 (Record, signing roles) | none |
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

Descriptive, checked against the 2023 text; nothing below is a quotation.

- **Protected rights.** Chapitre II (Des droits et libertés) guarantees, among others, human dignity (Art. 12), physical and mental integrity with no torture and no death penalty (Art. 13), freedom of thought, conscience and religion (Art. 14) and of worship (Art. 24), equality before the law and non-discrimination (Art. 15), private life (Art. 20), the home (Art. 21), freedom of opinion and of the press (Art. 23), peaceful assembly (Art. 25), association (Art. 26), communications (Art. 30) and personal data (Art. 31). Access to the judge the law assigns (Art. 18) and no penalty without law (Art. 19) are there too; fair proceedings are in Chapitre VII (Art. 110). The vote itself is in Chapitre IV: direct, universal, compulsory and secret (Art. 63), and the same for communal councils (Art. 122, Chapitre IX). The 2023 text names no right to life as such; the Charter's `life_and_bodily_integrity` relies on Articles 12 and 13 and on ECHR Article 2. The Charter lists these as `protected_rights`: no vote in this system may decide a matter that sits on one of them, and no `charter_change` vote may remove one from the list. Luxembourg is also bound by the ECHR, which the entries cross-reference.
- **How the Constitution itself is revised (Art. 131, Chapitre XI).** The Chambre des Députés adopts a revision in the same words in two votes at least three months apart, each with at least two thirds of the votes, proxies not counted. Within two months of the first vote, more than a quarter of the deputies or 25,000 registered electors can ask for a referendum; it replaces the second vote and the revision passes with a majority of valid votes. Article 130 adds that no provision may be suspended. The Charter's `charter_change.majority` (two thirds of votes cast) mirrors the Chambre's threshold and stays `basis: constitution`. Article 131 sets no turnout condition, so `charter_change.quorum_share_of_electorate` (20 %) is now `basis: project`, as its earlier note foresaw. **Open for Marouane:** the Constitution's popular route is a simple majority after a two-thirds vote of the deputies; keeping two thirds for a citizen vote is stricter than that route. Changing the value is its own PR.
- **Referendums and citizen initiative.** The Chambre may decide to hold a referendum in the cases, under the conditions and with the effects the law sets (Art. 80). The 2023 text adds a citizen legislative initiative (Art. 79): a reasoned proposal presented by at least 125 electors and supported by at least 12,500 electors is heard by the Chambre in public session, under rules set by law. The Charter's `ratification: full_vote` for national matters is this project's own mechanism and does not claim to be a constitutional referendum; it may not present itself as one, and its results bind only inside this system until the law says otherwise.
- **Communal autonomy (Chapitre IX).** Communes are autonomous territorial bodies with legal personality (Art. 121), each run by a council elected directly by universal suffrage and secret vote (Art. 122), under supervision the law organises; the Government in council may dissolve a council (Art. 127). The Charter's `local` and `minor` tiers run inside that autonomy: they help a communal council hear and decide, they do not take decisions away from it, and `bans.bar_years_by_rating` bars an operator inside this system only, never from public office.
- **Who votes where.** To vote for the Chambre one must be Luxembourgish and 18 (Art. 64); the law may give political rights to non-Luxembourgers (Art. 10). The details, including communal voting by residents, are the electoral law's. `eligibility.outsiders: advise` adds nothing to them: residents who may not vote on a matter may still bring arguments.

## Lookups still open

| # | Entry | Read | Then |
|---|---|---|---|
| 1 | `eligibility.outsiders` | Loi électorale modifiée du 18 février 2003: who may vote in legislative and communal elections | Set `article`, `status: verified`, mark `lu_electoral_law` consulted |
| 2 | `sources.lu_constitution_2023` | The Legilux coordinated text, by hand in a browser: its ELI reference and any revision after June 2026 | Add the reference to `note`; re-check any entry a later revision touches |
| 3 | Rights not on the list | Chapitre II also guarantees, for example, asylum (Art. 32), education (Art. 33), property (Art. 36) and the limits on any restriction of public liberties (Art. 37) | Marouane decides which, if any, join `protected_rights` |

The earlier 15-item checklist is closed except these: items 1 to 12, 14 and most of 15 were answered from the text above. A Scout report on the same question, if it lands, is untrusted input; the official text is the source.
