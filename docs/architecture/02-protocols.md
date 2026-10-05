# Democracy2.0: trust protocols (v0, 2026-10-05)

The parts where a design mistake cannot be patched later. Everything here needs review by independent cryptographers before any binding use (Phase 3 exit criterion). Standards are named so reviewers can check against them instead of against our prose.

---

## 0. Threat model

| Adversary | Wants | Main defense |
|---|---|---|
| The state (or whoever issues ID) | Link people to votes; switch off opponents | ID used once at enrolment; credential unlinkable; issuer keys and enrolment counts public; revocation only bites at the next epoch |
| Us, the operator | Same, or quietly tilt outcomes | Integrity proved by math (tally proofs, Record), not trust; privacy keys split among plural guardians; open source + reproducible builds + escrow |
| A buyer (a government customer) | A backdoor, a tweak to what surfaces, deanonymization | AGPL trust core (modified service must publish source); Record logs every ranker/model/Charter version; escrow makes capture pointless |
| Local strongman / employer | Coerce a few hundred people | Re-voting with hidden key change (receipt-freeness); revocable private delegation; Watchtower aggregate flags + hall-of-fame spotlight |
| Bot farms, brigades | Fake agenda and argument popularity | One credential per human per context; bridging ranking; scope-first queue |
| Insiders on panels | Steer briefings or reviews | Lottery selection nobody can predict; adversarial sign-off on quizzes; review by randomly drawn certified reviewers |
| Operators (elected executors) | Hidden power over "how", treasury | Workbench ratification before money moves; Treasury tranches unlock on verified delivery; every contract and spend on Record; Wall |

---

## 1. Door: identity at the door only

Goal: each adult resident gets one anonymous credential per epoch; nobody, including Door, can link a credential or its use to the person.

**Enrolment**
1. Citizen's app generates a random secret `s` (in the phone's secure element where available, behind PIN or biometric).
2. App requests an OpenID4VP presentation from the EUDI wallet (or a LuxTrust login) with the minimum attributes: unique person identifier, age-over-18, residence commune.
3. Door computes the uniqueness key `u = OPRF_K(person_id)`. `K` is a threshold OPRF key held by k-of-n independent key holders (v1: one HSM-held key, upgraded in Phase 5). The threshold matters because Luxembourg's 13-digit matricule is structured and brute-forceable if a single key leaks.
4. If `u` already has a credential for this epoch, enrolment is refused (or goes to the lost-device path).
5. App sends a blinded commitment to `(s, jurisdiction_path, adult, epoch, rid)`; Door returns a **blind BBS signature** (IRTF CFRG BBS + blind-signatures drafts). Door never sees `s` or the final credential.
6. Door stores only `u → epoch` and an **escrowed revocation handle** `Enc_T(rid)` encrypted to a threshold key `T`. It then discards the session.

**Use**
- Every presentation is a BBS zero-knowledge proof revealing only the attributes a context needs (for example "lives in Esch", "adult").
- Each context (an Agora area, a Booth round, a Commons matter) gets a **per-context pseudonym** `nym = H(context_id)^s` (CFRG BBS per-verifier-linkability draft). Same person, same context → same pseudonym, so one upvote or one sign-up per context. Different contexts are unlinkable.
- Revocation: a revoked `rid` is added to a public accumulator; every presentation proves non-membership in zero knowledge. Revealing `rid` deanonymizes nothing, because `rid` never appears in presentations.

**Lost or stolen phone:** re-enrol; k-of-n holders of `T` decrypt only that person's `rid` and revoke it; a new credential is issued. A thief's copy stops working at the next presentation.

**State revokes the underlying ID:** the credential survives until the epoch ends (default 12 months, Charter `door.epoch_months`). This is deliberate: a state cannot switch off a voter mid-epoch.

**Public on Record:** issuer public keys per epoch, enrolment count per commune per day (to detect mass fake enrolment), revocation accumulator updates.

**Known limits, logged honestly:**
- Door learns who enrolled (not which credential). A citizen worried about even that needs the in-person web-of-trust door, which is a later module.
- If the state issues fake identities, Door cannot tell. Watchtower watches enrolment counts against population.

---

## 2. Booth: ballots

Goal: secret, receipt-free, end-to-end verifiable, with no single party able to see votes.

**Recommended v1: MACI-style protocol** (Minimal Anti-Collusion Infrastructure, Privacy & Scaling Explorations).
1. **Sign-up:** voter presents the credential for context `round_id` (pseudonym prevents double sign-up) and registers a fresh round key `pk₀`. The state tree gets leaf `(pk₀, weight 1)`.
2. **Messages:** every action is one encrypted message to the round's coordinator key: vote, re-vote, change key, delegate (topic, delegate id), revoke delegation. All are the same size and look identical on the public board.
3. **Receipt-freeness:** a coerced voter can show the coercer a vote signed with `pk₀`, then later send a private key change to `pk₁` and a new vote. Messages signed by the old key after the change are silently invalid. The coercer cannot tell which happened.
4. **Tally:** after close, the coordinator processes messages in order and publishes the result with a **zk-SNARK proof** that processing and counting followed the rules. Anyone can verify the proof against the public board.
5. **Guardians:** the coordinator's decryption key is created by distributed key generation among t-of-n guardians drawn from plural bodies (opposition, academia, civil society, us). No single guardian can decrypt.

**Honest limit of v1:** in standard MACI the party that runs processing sees decrypted messages. With guardian-split keys, processing must run either as a joint computation among guardians or inside a setup where t guardians cooperate per round. v1 (non-binding shadow votes) runs with a single coordinator and states that privacy depends on it; integrity is already trustless. **Removing that privacy dependency is a Phase 3 exit requirement** (threshold processing, for example MPC over the message decryption, reviewed by external cryptographers).

**Alternative considered:** ElectionGuard-style homomorphic tally with threshold guardians. Better privacy story out of the box, but re-voting needs the board to link successive ballots to the same pseudonym, so a coercer who sees the voter's pseudonym learns that a re-vote happened. Rejected as the primary path for that reason; kept as a fallback for simple organisational elections where coercion risk is low.

**Eligibility rules** are evaluated at sign-up from credential attributes and Charter: `concerned` (jurisdiction match), `knowledgeable` (matter badge from Arena, used for routing and for matters Charter marks as badge-open), `judge` (Lottery selection proof). Default `eligibility.outsiders = advise`: people outside the affected area cannot vote but can contribute arguments.

---

## 3. Booth: liquid delegation

- **Delegates are public actors.** A delegate registers a public key per topic and votes publicly. Their followers' choice to follow is private.
- **Subscribe link / QR:** encodes only `(delegate_id, topic)`. Scanning opens the app, which sends an encrypted delegate message. The link carries no follower data; the server sees nothing it could use as a receipt.
- **Revocation:** one tap sends an encrypted revoke. Same coercion shield as re-voting: a forced subscription is undone privately the moment the coercer leaves.
- **Resolution at tally:** for each voter and matter, a direct vote wins; otherwise the delegate's public vote on that matter's topic is used; otherwise abstain.
- **Depth:** 1 by default (a delegate cannot pass on delegated weight). Avoids hidden chains and super-delegates. Charter `delegation.max_depth`.
- **Caps:** the tally circuit counts followers per delegate per topic and applies Charter `delegation.cap` (default: 1% of the round's electorate). Weight beyond the cap is not counted for that delegate; affected followers are told in-app to vote directly or choose another delegate. Per-delegate follower totals are published per epoch, so accountability works without revealing who follows whom.
- **Decay:** delegations expire after Charter `delegation.ttl_months` (default 12) unless renewed, so they never become sticky representation.

---

## 4. Record: the public log

Why not a blockchain: the system needs append-only history that anyone can verify and mirror, with one known writer per entry type. A transparency log gives exactly that with no consensus, no token and no gas. A public chain is used only for what it is uniquely good at: an external timestamp nobody controls.

- **Log format:** tile-based Merkle tree (C2SP `tlog-tiles`), checkpoints as signed notes (C2SP `signed-note`). Static tiles mean any mirror can serve the full log as plain files.
- **Witnesses:** independent organisations run witnesses (C2SP `tlog-witness`) that co-sign each checkpoint only if it is consistent with the last one they saw. A split view (showing different histories to different people) is detected as soon as two witnesses disagree.
- **Anchoring:** every hour the latest checkpoint hash is timestamped with OpenTimestamps (Bitcoin). Optional second anchor on a public L2 later.
- **Entries store hashes, not payloads.** Payloads sit in content-addressed storage. Personal data (for example a photo with a face) can be deleted for GDPR without breaking the chain; the hash remains as proof something was published.
- **Signing roles:** `spec/record-types.json` lists each entry type and the keys allowed to sign it (module service key, public actor key, panel key). `charter.change` additionally requires a Booth tally proof for a constitution-class round (Charter `charter.change_threshold`, default two-thirds of votes cast with a quorum).

---

## 5. Lottery: verifiable sortition

1. **Pool commitment:** the list of opted-in pseudonyms for the draw's context, each with strata attributes (from credential attributes and opt-in self-declaration), is hashed into a Merkle root and logged.
2. **Distribution commitment:** the stratified selection algorithm (LEXIMIN, Flanigan et al., *Nature* 2021, which maximises the minimum selection chance under quotas) produces a probability distribution over panels. Because LP solvers are not reliably deterministic, the **computed distribution itself** is published and logged before the seed exists.
3. **Seed:** a drand round number at least one hour after both commitments. Nobody can predict it.
4. **Draw:** deterministic sampling from the committed distribution with the drand value. Anyone can recompute it.
5. **Notification:** selected pseudonyms are published; each client checks locally whether one is its own. Acceptance and decline are pseudonymous; replacements come from the same committed distribution.

Used for: agenda and briefing panels, certified reviewers, KPI rating panels, scope challenges, Arena peer review, Watchtower investigation juries.

---

## 6. Source escrow: the dead man's switch

Makes "we will open-source it if anyone tries to capture it" a technical fact instead of a promise.

1. Every release of a held module is built reproducibly. The binary hash is logged.
2. The source archive is encrypted with a fresh key. The ciphertext and its hash are published and logged.
3. The key is protected two ways:
   - **Trustees:** split with Shamir k-of-n among trustees in different jurisdictions, released on the published trigger conditions (sale to a buyer who demands a backdoor, a court order to deanonymize, the project being shut down).
   - **Time lock:** also encrypted to a future drand round with timelock encryption (drand `tlock`). Each new release sets a new date. If the project stops releasing (killed, captured, founder coerced), the last escrowed source decrypts itself on that date with no human involved.
4. Anyone can later check that the released source builds the binaries that were shipped.

**Parameter for Marouane:** the time-lock horizon. A short one (12 months) means held code is effectively open with a delay. A long one (60 months) protects revenue but leaves a longer window of capture. Default proposed: 24 months.

---

## 7. Coercion and integrity summary

| Attack | Where it is stopped |
|---|---|
| "Show me your vote" | Re-vote with hidden key change (Booth §2) |
| "Scan my delegate's QR in front of me" | Private revocation (Booth §3) |
| Mass fake identities | Door uniqueness + public enrolment counts + Watchtower |
| Strongman controls a district | Watchtower aggregate flag → human investigation; hall-of-fame spotlight; external briefing as information, not votes |
| Rigged AI companion | Symmetry gate per release; arguments come from Commons; prompts and versions logged |
| Hidden ranking power | Bridging ranker, open and versioned; user-selectable alternatives |
| Operator rewrites history | Record + witnesses + anchors |
| Rule changes by insiders | Charter changes need a constitution-class Booth proof |
| Fake delivery photos | C2PA manifest, geofence, time window, perceptual-hash reuse check, reopen window |
