# Democracy2.0: shared data model (v0, 2026-10-05)

These are the contracts in `spec/schemas/*.json`. Each entity has exactly one owning module (the only one that writes it). Others read through the owner's API or via Record. IDs are ULIDs; anything citizen-related is a per-context pseudonym, never a person.

## Identity and roles

| Entity | Owner | Key fields | Public? |
|---|---|---|---|
| `IssuerKey` | Door | epoch, bbs_public_key, valid_from, valid_to | yes (Record) |
| `UniquenessEntry` | Door | oprf_key_u, epoch, enc_revocation_handle | no; never leaves Door |
| `RevocationAccumulator` | Door | epoch, value, updated_at | yes |
| `PublicActor` | Charter registry | id, name, roles[] (operator, delegate, reviewer, panelist, guardian, investigator), signing_keys[] | yes |
| `Pseudonym` | (derived, not stored centrally) | context_id, nym | appears only inside the context that derived it |

## Geography and rules

| Entity | Owner | Key fields |
|---|---|---|
| `Jurisdiction` | Charter | id, parent_id, kind (country, region, commune, district), name{lang}, population, geometry |
| `Topic` | Charter | id, parent_id, name{lang} |
| `CharterVersion` | Charter | version, params (JSON), protected_rights[], adopted_by_round_id, record_seq |
| `ScopeChallenge` | Agora (rules in Charter `scope_challenge.*`) | idea_id, proposed_jurisdiction_id, panel draw (pool, commitment, transcript), votes, outcome (jurisdiction, tier recomputed by Scope) |

## Agenda and deliberation

| Entity | Owner | Key fields |
|---|---|---|
| `Idea` | Agora | id, jurisdiction_id, topic_ids[], text{lang}, proposer_nym, created_at, upvote_count (hidden first 24 h) |
| `ProposerRecord` | Agora | proposer_nym (persistent per proposer area), ideas_raised, ratings |
| `Matter` | Agora (created on promotion) | id, idea_id?, source (agora, docket, operator), jurisdiction_id, topic_ids[], scope_tier, charter_version, status (drafting, review, deliberation, voting, ratified, executing, verifying, closed) |
| `Option` | Workbench | id, matter_id, text{lang}, cost_estimate, tradeoffs, author_role |
| `Briefing` | Workbench | id, matter_id, panel_draw_id, version, content_uri, content_hash |
| `QuizPool` | Arena | briefing_id, items[] (question, answers, correct), signoffs[] (one per option's advocates), published_after_vote |
| `Argument` | Commons | id, matter_id, stance_option_id, text, source_refs[], author_nym, cluster_id |
| `ArgumentRating` | Commons | argument_id, rater_nym, strong (bool), rater_cluster |
| `RankerVersion` | Commons | id, algorithm, params, code_hash |

## Knowledge

| Entity | Owner | Key fields |
|---|---|---|
| `SourceItem` | Docket | id, source, jurisdiction_id, type (bill, agenda, minutes, budget, vote), title{lang}, status, dates, document_ids[] |
| `SourceDocument` | Docket | id, url, fetched_at, sha256, mime, storage_uri |
| `Claim` | Provenance | id, text, context_ref |
| `Grade` | Provenance | claim_id, checker_id, grade (green, yellow, red), evidence[] (source_document_id, excerpt, locator), model_version |
| `SymmetryReport` | Symmetry | target, suite_version, gap_overall, gap_by_topic, raters, record_seq |

## Selection

| Entity | Owner | Key fields |
|---|---|---|
| `Draw` | Lottery | id, purpose, context_id, pool_root, distribution_hash, strata_quotas, size, drand_round, selected_nyms[] |
| `Badge` | Arena | (held by the citizen as a credential attribute; Arena keeps only issuance counts) |

## Voting

| Entity | Owner | Key fields |
|---|---|---|
| `VoteRound` | Booth | id, matter_id, class (ordinary, ratification, detail, constitution, verdict, rating), options[], eligibility_rule, opens_at, closes_at, coordinator_key, guardians[] |
| `BoardMessage` | Booth | round_id, seq, ciphertext, ephemeral_key |
| `Tally` | Booth | round_id, results{option: weight}, turnout, delegated_share, proof_uri, guardian_sigs[] |
| `DelegateTotal` | Booth | delegate_actor_id, topic_id, epoch, follower_count, capped (bool) |

## Execution and accountability

| Entity | Owner | Key fields |
|---|---|---|
| `Proposal` | Workbench | id, matter_id, operator_actor_id, current_version, status |
| `ProposalVersion` | Workbench | proposal_id, version, options[], budget_lines[], contractors[], content_hash |
| `Review` | Workbench | proposal_id, version, draw_id, reviewer_nym, findings[] (severity, line_ref, text) |
| `Mandate` | Delivered | id, actor_id, role, jurisdiction_id, starts, ends |
| `KPI` | Delivered | id, mandate_id, outcome_definition, baseline, target, method, agreed_record_seq |
| `KPIResult` | Delivered | kpi_id, value, context_report_uri, expert_draw_id |
| `DeliveryTask` | Delivered | id, proposal_id, geofence, window, status |
| `Evidence` | Delivered | id, task_id, phase (before, after), media_uri, sha256, phash, c2pa_manifest, captured_at, lat, lon |
| `Verdict` | Delivered | task_id, round_id, outcome (done, not_done, done_badly), final_at (after reopen window) |
| `Rating` | Delivered | mandate_id, panel_draw_id, citizen_round_id, outcome, consequence (from Charter) |
| `WallEntry` | Wall | id, actor_id, kind (promise, vote, proposal, kpi, rating, finding, declaration, recusal), source_ref, record_seq, created_at |
| `Declaration` | Wall | actor_id, period, assets[], interests[], registry_checks[] |
| `Reply` / `Appeal` | Wall | entry_id, actor_id, text, status |
| `Tranche` | Treasury | id, proposal_id, amount, currency, unlock_condition (verdict_id or kpi_id), status |
| `Spend` | Treasury | id, tranche_id, payee, amount, invoice_hash, paid_at |
| `Flag` | Watchtower | id, kind (tally_anomaly, budget_anomaly, enrolment_anomaly), subject_ref, statistic, status (open, investigating, cleared, confirmed) |
| `Feature` | Watchtower | matter_id, reason (clean_landslide), published_at |

## Record entry types (`spec/record-types.json`)

`charter.change` · `issuer.key` · `enrolment.count` · `revocation.update` · `matter.created` · `matter.tier` · `draw.commit` · `draw.result` · `briefing.published` · `quiz.published` · `round.opened` · `round.tally` · `delegate.totals` · `proposal.version` · `review.filed` · `proposal.ratified` · `kpi.agreed` · `kpi.result` · `evidence.added` · `verdict.final` · `rating.final` · `wall.entry` · `tranche.released` · `spend` · `flag.status` · `release.binary` · `release.escrow` · `companion.release` (prompt set, model version, ranker version, Symmetry report)

## Privacy boundary

| Never stored anywhere | Stored only inside one module | Public |
|---|---|---|
| Link between a person and a credential; how any citizen voted; which delegate a citizen follows; which matters a citizen cares about (Pulse runs on device) | Door: who enrolled (keyed hash only). Arena: attempt aggregates. Commons: argument author pseudonyms. | Everything public actors do; all tallies, totals, drafts, reviews, spends, evidence; every rule and algorithm version |
