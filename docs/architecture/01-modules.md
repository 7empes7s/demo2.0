# Democracy2.0: module specs (v0, 2026-10-05)

One section per module. Each lists: what it is alone, who pays for it alone, API surface, the data it owns, what it depends on, and when it is done. Entity names refer to [03-data-model.md](03-data-model.md); protocols to [02-protocols.md](02-protocols.md). Licence and phase are in the [catalogue](00-overview.md#3-module-catalogue-what-is-sold-what-is-published).

All APIs are HTTP+JSON described in `spec/openapi/<module>.yaml`, authenticated with either an anonymous credential presentation (citizens), a named role key (public actors) or a service key (module to module). All events are signed CloudEvents delivered by webhook; public facts are also written to Record.

---

## Layer 0: trust core

### 1. Record: append-only public log
- **Alone:** a verifiable public-records service. Any council, NGO or company can prove what it published and when, and prove it never edited it.
- **Customer alone:** public bodies and auditors (hosted log + witnesses).
- **API:**
  - `POST /entries` `{type, payload_hash, payload_uri, signer, signature}` → `{seq, leaf_hash}`
  - `GET /checkpoint` → latest signed tree head + witness co-signatures + anchor proof
  - `GET /proof/inclusion?seq=&size=` , `GET /proof/consistency?from=&to=`
  - `GET /tiles/...` static tiles so mirrors can serve the log as plain files
- **Owns:** `RecordEntry`, `Checkpoint`, `Anchor`. Payloads live in object storage, addressed by hash; the log stores hashes only (so personal data can be erased from storage without breaking the log).
- **Depends on:** nothing.
- **Rules:** entry types are registered in `spec/record-types.json` with the roles allowed to sign each. `charter.change` entries require a Booth tally proof.
- **Done when:** independent verifier CLI (separate codebase) validates proofs; three witnesses run by different organisations co-sign; anchors verify on Bitcoin.

### 2. Charter + Scope: rules of the game
- **Alone:** a library and data format for "constitution as data" any organisation can use for its own bylaws.
- **Charter** is a versioned data file (`charter/charter.yaml`, JSON Schema validated). It holds every tunable rule: scope-tier thresholds, panel sizes, delegation caps, vote budget, ban lengths, reopen windows, protected rights (matters no vote may decide). Every module reads it through the same library and logs the Charter version it acted under.
- **Scope** computes a matter's affected population from jurisdiction and topic, then its tier: `national | regional | local | minor`. Rules are mechanical and public; a proposer's label is input only, never output. Contesting a tier opens a `ScopeChallenge` decided by a small Lottery panel.
- **The dial (defaults, all in Charter):**

| Tier | Queue priority | Details drafted by | Review panel | Delivery verified by | Ratification |
|---|---|---|---|---|---|
| national | 1 | citizens vote details | 50–100 certified reviewers, 2 rounds | expert panel drawn by Lottery | full vote |
| regional | 2 | citizens vote details | 15–30 | expert panel | full vote |
| local | 3 | operator drafts | 5–9 | local crowd, photo proof | local vote |
| minor | 4 | operator drafts | 3 | local crowd, photo proof | silent ratification (objection window) |

- **API:** library only (`charter` crate + TS/Python bindings): `tier(matter)`, `param(key, at_version)`, `is_protected(matter)`.
- **Done when:** the same matter gives the same tier in all three bindings (shared test vectors); a Charter edit without a valid tally proof is rejected by Record.

### 3. Door: state ID in, anonymous credential out
- **Alone:** "one real human, one account, nobody knows who" for any organisation: polls, unions, DAOs, surveys, forums.
- **Flow:** citizen presents EUDI wallet (OpenID4VP) or LuxTrust once → Door checks uniqueness with a keyed hash of the national ID → issues a blind-signed BBS credential carrying only coarse attributes (jurisdiction path, adult, enrolment epoch) → forgets the session. Details in [02-protocols.md §1](02-protocols.md#1-door-identity-at-the-door-only).
- **API:**
  - `POST /enrol/start` → wallet presentation request
  - `POST /enrol/issue` `{presentation, blinded_commitment}` → `{blind_signature}`
  - `GET /issuer-keys` (per epoch)
  - verifier library: `verify(presentation, context)` → `{valid, pseudonym_for_context, attributes}`
- **Owns:** `UniquenessEntry` (keyed hash → epoch only). No table links a person to a credential.
- **Depends on:** Record (issuer key publication, per-epoch enrolment counts).
- **Done when:** the Phase 2 sybil and unlinkability tests pass; a credential works offline for presentation; re-enrolment in a new epoch invalidates the old one without revealing which old one it was.

### 4. Lottery: verifiable sortition
- **Alone:** a tool citizens' assembly organisers can use to prove their draw was fair.
- **Flow:** commit to the pool (Merkle root of pseudonyms + strata attributes) and to a future drand round → when the round arrives, run the published selection algorithm (stratified, LEXIMIN-style so every pool member's chance is as equal as quotas allow) → publish selected pseudonyms. Selected people learn privately through their pseudonym inbox.
- **API:** `POST /draws` `{purpose, pool_root, strata_quotas, size, drand_round}`; `GET /draws/{id}` (inputs, result, verification transcript); `POST /draws/{id}/accept|decline` (pseudonymous).
- **Owns:** `Draw`, `PoolCommitment`.
- **Depends on:** Record, drand, Door (pseudonyms).
- **Done when:** a third party reproduces any draw from public inputs; the operator cannot learn the drand value before committing.

### 5. Booth: ballots and liquid delegation
- **Alone:** elections-as-a-service for associations, unions, co-ops and party primaries, with coercion resistance most e-voting tools lack.
- **Properties:** secret, receipt-free (re-vote, last counts, key change hides it), end-to-end verifiable, threshold tally keys held by plural guardians. Delegation is topic-specific, revocable any time, capped, and processed inside the tally so it stays private while per-delegate totals are public. Details in [02-protocols.md §2–3](02-protocols.md#2-booth-ballots).
- **API:**
  - `POST /rounds` (by Workbench/Agora/Charter, signed) `{matter_id, options, eligibility_rule, opens_at, closes_at, guardians}`
  - `POST /rounds/{id}/messages` `{ciphertext, credential_presentation}` (vote, re-vote, key change, delegate, revoke; all look identical on the wire)
  - `GET /rounds/{id}/board` (public bulletin board)
  - `GET /rounds/{id}/tally` → results + proof + guardian signatures
  - `GET /delegates/{public_id}/totals?topic=` (published per epoch)
- **Owns:** `VoteRound`, `BoardMessage`, `Tally`, `DelegateTotal`.
- **Depends on:** Door, Record, Charter.
- **Done when:** Phase 3 acceptance criteria pass, including the independent verifier and the external audit.

---

## Layer 1: knowledge

### 6. Docket: official sources, normalized
- **Alone:** an API of bills, council agendas, minutes, budgets and votes, normalized across sources. Useful to journalists, NGOs, civic-tech and researchers.
- **Sources first:** Chambre des Députés (Luxembourg), Legilux, Esch-sur-Alzette council and participation.esch.lu, national budget. Each source is a plugin with a fixture-tested parser.
- **API:** `GET /items?jurisdiction=&type=&since=`, `GET /items/{id}` (structured fields + original document + content hash), webhook `docket.item.updated`.
- **Owns:** `SourceItem`, `SourceDocument` (content-addressed, with fetch time).
- **Depends on:** nothing.
- **Done when:** each source plugin has recorded fixtures and a daily freshness check; every item keeps its original file and hash.

### 7. Commons: the argument library
- **Alone:** the open, citable corpus of the strongest arguments real people have made on each matter (like Polis or Community Notes, for policy).
- **How arguments rank:** bridging-based. An argument rises when people from different opinion clusters rate it as strong, not when many people of one side like it. This answers "who ranks which arguments rise": a public algorithm that rewards cross-camp agreement and is hard to brigade. Alternate rankers can be plugged in and chosen by the user; all are open and logged.
- **API:** `POST /arguments` (anonymous credential), `POST /arguments/{id}/ratings`, `GET /matters/{id}/arguments?stance=&ranker=`, `GET /rankers`.
- **Owns:** `Argument`, `ArgumentRating`, `Cluster`, `RankerVersion`.
- **Depends on:** Door (one human, one rating), Provenance (attach grades to factual claims inside arguments).
- **Done when:** a brigade simulation (one cluster mass-rating its own side) does not move rankings beyond a set tolerance; dataset exports nightly.

### 8. Provenance: claim grading
- **Alone:** a fact-check API: send a claim, get 🟢 solid / 🟡 contested or unclear / 🔴 flatly false, each with the records it rests on.
- **Method:** retrieval over Docket + open statistics + court and registry records; the grade is a function of what the records say, shown with them. It never issues opinions on values. Plural: other checkers can publish grades through the same schema, and clients show disagreement between checkers.
- **API:** `POST /claims/grade` `{text, context}` → `{grade, evidence[], checker_id, model_version}`; `GET /checkers`.
- **Owns:** `Claim`, `Grade`, `Evidence`.
- **Depends on:** Docket.
- **Done when:** on a labelled set of 500 claims, 🔴 precision ≥ 95% (a false 🔴 is the costly error); every grade has at least one resolvable source.

### 9. Symmetry: bias audit for persuasive AI
- **Alone:** an open benchmark and harness any AI vendor or regulator can run to see whether a model argues equally hard in every direction.
- **Method:** paired scenarios (same matter, user lands on yes vs no, varied demographics and wording); the system under test produces its pushback; blind raters and judge models score strength; report the gap per topic and overall. Every Companion release and every Commons ranker change runs it, and results go to Record.
- **API:** CLI + `POST /runs` `{target_endpoint, suite_version}` → report.
- **Owns:** `Suite`, `Run`, `Report`.
- **Done when:** the gap metric is stable across reruns (test-retest within 1 point); suite published with versioning.

### 10. Arena: proof of judgment
- **Alone:** a game. Short real historical decisions (a zoning call, a supply chain, a budget cut) that went surprisingly well or badly; you reason about why, with varied contexts so recall doesn't help. Doubles as civic education with yearly topic tracks.
- **Two products in one engine:**
  - **Comprehension checks** for a matter's briefing (the "knowledgeable" route): questions drafted by the panel, signed off by advocates of each option, random variants per person, unlimited retakes, no public record.
  - **Certification** for responsibility-bearers (delegates, reviewers): many scenarios over time per domain; reasoning graded by automated scoring plus Lottery-drawn peer review for open answers.
- **Output:** anonymous, non-transferable badges bound to the holder's credential (`passed check for matter X`, `certified domain Y`), presentable without revealing identity. Honorary shield ranks are display only and carry no extra vote weight.
- **API:** `GET /scenarios/next?domain=`, `POST /attempts`, `POST /badges/issue` (blind), quiz authoring endpoints for panels.
- **Owns:** `Scenario`, `Attempt` (pseudonymous, retained only as aggregates), `QuizPool`, `BadgeIssuance`.
- **Depends on:** Door.
- **Done when:** pass rates are monitored by age band, language and region (from opt-in coarse attributes) and a gap above the Charter threshold opens a redesign task; the scenario pool rotates so no single answer guide covers more than 10% of live items.

---

## Layer 2: civic process

### 11. Agora: the agenda forum
- **Alone:** a participatory-budgeting and idea platform for municipalities, positioned against Decidim-type tools: one human one upvote, no bot farms, priority by scope, accountable proposers.
- **Mechanics:** post ideas with an anonymous credential (pseudonym per matter area); upvotes are one per credential; ranking = scope tier first, then upvotes, with scores hidden for the first 24 h to stop early snowballing; proposer accountability: when an idea reaches national attention, the proposer's track record (pseudonymous, persistent per proposer) is rated.
- **API:** `POST /ideas`, `POST /ideas/{id}/upvote`, `GET /queue?jurisdiction=`, `POST /ideas/{id}/promote` (to a matter, by rule).
- **Owns:** `Idea`, `Upvote`, `ProposerRecord`.
- **Depends on:** Door, Scope, Record, Lottery (agenda panels).
- **Done when:** Phase 2 Agora criteria pass.

### 12. Pulse: the weekly list
- **Alone:** none meaningful; it is the glue in the citizen app. Published so anyone can check that routing is neutral.
- **Mechanics:** downloads the public matter list for the citizen's jurisdictions and builds the weekly list **on the device**: concerned (jurisdiction match), knowledgeable (opted-in topics + comprehension badge), judge (Lottery inbox). Applies the weekly vote budget; everything else defaults to the citizen's delegates. The server never learns what a citizen cares about.
- **API:** client library; server side is only `GET /matters/active?jurisdiction=` (cacheable, public).
- **Done when:** a network trace of the client shows no request that depends on the citizen's interests.

### 13. Workbench: proposals, review, ratification
- **Alone:** a proposal-management tool for public bodies: draft, review, ratify, with an audit trail regulators accept.
- **Flow:** operator turns an upvoted matter into a concrete proposal (options, costs, trade-offs, budget lines, contractors) → Lottery draws certified reviewers (size from tier) → reviewers file findings → operator revises → tier decides whether details are voted (national/regional) or the draft is ratified as a whole → Booth round → `proposal.ratified` in Record. Operators cannot pick reviewers and cannot edit after ratification.
- **API:** `POST /proposals`, `PUT /proposals/{id}` (versions), `POST /proposals/{id}/submit-review`, `POST /reviews/{id}/findings`, `POST /proposals/{id}/ratify` (opens Booth round).
- **Owns:** `Proposal`, `ProposalVersion`, `BudgetLine`, `Review`, `Finding`.
- **Depends on:** Lottery, Arena badges, Booth, Charter, Record.
- **Done when:** Phase 4 Workbench criterion passes.

### 14. Delivered: did it happen
- **Alone:** a city service where the public confirms work was done (FixMyStreet with proof), plus a KPI tracker for any organisation.
- **Small, physical work:** in-app camera captures before and after with C2PA manifest, GPS and time; image hash and perceptual hash checked against reuse; local crowd (credential with that jurisdiction) votes done / not done / done badly; the verdict stays reopenable for the Charter window.
- **Big, slow work:** KPIs agreed and logged at mandate start (outcome measures, not counts of things built); expert panel drawn by Lottery interprets results; independent context report attached.
- **End of mandate:** results published; Lottery-drawn rating panel plus a citizen Booth round; graded consequences from Charter (bar for N years, auto-shortlist and bonus for good results).
- **API:** `POST /tasks`, `POST /tasks/{id}/evidence`, `POST /tasks/{id}/verdict` (Booth-backed for local crowd), `POST /mandates/{id}/kpis`, `GET /mandates/{id}/scorecard`.
- **Owns:** `DeliveryTask`, `Evidence`, `Verdict`, `Mandate`, `KPI`, `KPIResult`, `Rating`.
- **Depends on:** Record, Booth, Lottery, Charter.
- **Done when:** Phase 4 photo criteria pass.

### 15. Wall: the accountability record
- **Alone:** a public, permanent record per official that journalists and voters can cite.
- **Contents:** promises, votes cast as a public actor, proposals drafted, KPIs and results, ratings, official findings (courts, investigation bodies), asset and interest declarations, recusals, cooling-off periods. Only verified facts and official findings; every entry links to its Record entry and source. Right of reply and appeal on every entry.
- **Checks:** declarations compared with public registries (companies, land); unexplained-wealth gaps raised as a flag to the investigating body, never published as a verdict.
- **API:** `GET /officials/{id}`, `GET /officials/{id}/timeline`, `POST /entries` (role-signed by source bodies), `POST /entries/{id}/reply`, `POST /entries/{id}/appeal`.
- **Owns:** `Official`, `WallEntry`, `Declaration`, `Reply`, `Appeal`.
- **Depends on:** Record, Delivered, Provenance.
- **Done when:** no entry can be created without a source and Record link; replies render beside entries everywhere they appear.

### 16. Watchtower: flags, not verdicts
- **Alone:** an analysis toolkit for election observers and auditors.
- **Methods:** on public aggregate tallies only (never individual ballots): district results far from neighbours with similar profiles, turnout spikes, last-hour patterns; on Treasury: price outliers against comparable contracts, contractor concentration, split purchases under thresholds. Output is a `Flag` sent to a human investigation queue.
- **Hall of fame:** every clean landslide is surfaced nationally as a good idea worth copying. Scrutiny follows publicity; how a winner reacts to the spotlight is itself observed.
- **API:** `GET /flags`, `POST /flags/{id}/status` (investigation body only), `GET /hall-of-fame`.
- **Owns:** `Flag`, `Investigation`, `Feature` (hall of fame item).
- **Depends on:** Record, Booth tallies, Treasury.
- **Done when:** on synthetic data with planted anomalies, recall ≥ 90% at a false-flag rate agreed in Charter; no flag is public before an investigation status exists (protects innocent local heroes).

### 17. Treasury: money that waits for proof
- **Alone:** a public-spending ledger for cities with conditional disbursement.
- **Mechanics:** a ratified proposal's budget splits into tranches; each tranche names an unlock condition (a Delivered verdict or KPI result). Every spend is logged with payee and amount. Watchtower reads it live. The actual payment still runs through the city's normal finance system; Treasury issues the signed release authorization.
- **API:** `POST /budgets/{proposal_id}/tranches`, `POST /tranches/{id}/release` (checks condition in Record), `POST /spends`, `GET /budgets/{id}`.
- **Owns:** `Tranche`, `Spend`, `ReleaseAuthorization`.
- **Depends on:** Delivered, Record, Workbench.
- **Done when:** Phase 5 criterion passes.

---

## Layer 3: apps

### 18. Companion (citizen app)
- **Alone (Phase 1):** the wedge. Explains bills, candidates and local decisions at the depth the user chooses; records the user's gut position; argues the strongest case against wherever the user landed, using Commons arguments; grades factual claims with Provenance; lets the user voice their view and have it challenged.
- **In the full system:** the same app gains Pulse (weekly list), Booth client (vote, delegate, revoke, scan a delegate's QR subscribe link), Agora, Arena and the Lottery inbox. Standalone mode needs no credential.
- **Guardrails:** prompts, model version and the Commons ranker are logged per answer (hash to Record); Symmetry gates every release; the app never recommends an option.
- **Monetization:** free tier has all information features; paid tier sells convenience (voice mode, unlimited depth, personal history and topic tracks); institutional licences for schools and newsrooms.
- **Done when:** Phase 1 criteria pass.

### Consoles
Operator, panel, reviewer and investigator consoles share one app (`apps/console`) with role-based screens. Public actors sign actions with named keys (hardware key or passkey); every signature is logged.
