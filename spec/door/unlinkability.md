# Door unlinkability: automated test results (Phase 2)

The Phase 2 acceptance line (`docs/architecture/00-overview.md` section 7) reads: "the Door
operator, given its full database and all Agora logs, cannot link any credential to an identity
better than chance (red-team report)". This file covers the **automated part** only. It is
not the red-team report, and it does not replace the external audit the roadmap requires
before any binding use.

Tests:

- `modules/door/tests/unlinkability.rs`: the harness (Rust; runs in `tools/check.sh`).
- `modules/agora/tests/test_door.py::test_agora_keeps_the_nym_and_nothing_else_of_a_presentation`:
  runs Agora against a real `d2-door serve` and checks that Agora keeps less than the harness
  gives its attacker.
- `modules/door/tests/acceptance.rs`: the Sybil half of the acceptance (1,000 attempts, 100
  duplicates, exactly 900 credentials).

## 1. Setup

- **People:** 200 synthetic adult residents. They are spread over the Charter jurisdictions in
  proportion to the real populations in `charter/data/lu-jurisdictions.json` (largest
  remainder), so small areas get few people, as they would in a real pilot. Each person
  enrols for real: a fresh holder secret, a blind commitment, Door's OPRF uniqueness check, a
  blind BBS signature, and the holder's finalisation.
- **Activity:** each person acts in each Agora area that contains their address
  (`agora:<jurisdiction id>`, disclosing exactly that many levels plus `adult`) with
  probability 0.6, at least once. With probability 0.25 they act there a second time (a post
  and an upvote, say). This gives 365 presentations in 15 contexts (country, 12 cantons and 2
  communes), all verified as Agora's Door check would verify them.
- **The attacker gets more than either side keeps:**
  - Door: for every enrolment, the identity (person id, address, adult flag), `u`, the
    holder's commitment, the blind signature Door produced, Door's share of the pseudonym
    secret, and `rid` in binary, in hex, as the `rid=<hex>` message, and as the BBS message
    scalar under each of the library's three API ids. Door's store keeps only `u`, the epoch
    and `rid`. The rest assumes Door logged every enrolment in full.
  - Agora: every presentation in full (proof, pseudonym point, disclosed attributes,
    context, challenge) as JSON and as decoded bytes. Agora actually keeps the `nym` and the
    idea or upvote row; the Agora test above checks that its database and log records hold no
    32-character run of any proof, pseudonym point or challenge, and no disclosed path.
- **Order:** the Agora log is shuffled. Timing is out of scope (section 4).

## 2. What "chance" means here

A presentation in `agora:<area>` discloses the area. Even a perfect scheme leaves the attacker
able to guess uniformly among the enrolled adults of that area, so for presentation *j* with an
anonymity set of size *n_j*, chance success is *1/n_j*. The expected number of chance links
is *E = Σ 1/n_j*, with variance *Σ p(1−p)*. Each attack passes if its successes are at most
*E + 4.5·sd + 1*, a one-sided margin with a false alarm rate of about 3 in a million per
attack under a normal approximation (for the cross-context attack, where *E* is about 1, the
exact tail is closer to 1 in 25,000; still negligible). With 365 trials, that bound sits about 4.5 percentage points above chance. An attack
that links more often than that fails the test.

The **control** shows the attacks would catch a link if there were one. It plants a leak (each
presentation also carries the credential's signature, as a naive "show the credential" design
would) and the same attacks must link at least 95% of entries.

## 3. Results

From a `cargo test -p d2-door --test unlinkability -- --nocapture` run. The person set and
activity are fixed by a seed. Proof randomness is fresh on every run, so the similarity line
varies between runs. Three runs gave 4, 12 and 12 for that line, and every other number was
the same each time.

| Attack | Trials | Linked | Chance (E) | Bound | Result |
|---|---|---|---|---|---|
| 0. Attributes only: uniform guess in the anonymity set (the baseline) | 365 | 8 (2.2%) | 13.3 (3.6%) | 29.6 | at chance |
| 1. Door's bytes in Agora's log: any 8-byte run of `u`, commitment, signature, Door's entropy, `rid` or `rid` scalars, or any 16-character run of their hex, in a presentation's bytes or JSON | 365 | 16 (4.4%), **0 byte matches** | 13.3 | 29.6 | at chance |
| 2. Byte-pair similarity: pick the enrolee whose Door material shares the most 2-byte pairs with the presentation | 365 | 4 to 12 | 13.3 | 29.6 | at chance |
| 3. `rid` in the clear: any `rid` hex in any presentation JSON | 365 x 200 | **0** | 0 | 0 | none |
| 4. Proof randomness reuse (Agora alone): any 8-byte run shared by two presentations' proofs | 365 | **0 shared runs** | 0 | 0 | none |
| 5. Same holder across contexts: for a nym in an inner area (e.g. a commune), find the same person's nym in an enclosing area (canton, country) by equal pseudonym or nym, otherwise by byte-pair similarity | 212 | 1 to 2, **0 equal pseudonyms** | 1.2 | 7.1 | at chance |
| Within one context (by design: one nym per person per area) | 64 repeat actions | 64 of 64 | n/a | n/a | linked, as intended |
| Control: planted signature leak, attacks 1 and 2 | 365 | 365 and 365 | | | detected |

Also asserted: one pseudonym per (holder, context) and none shared between holders or
contexts; every presentation verifies.

Runtime: about 15 s for the harness (200 enrolments, 365 presentations and verifications), and
about 20 s for the Sybil test (1,000 full enrolments), in the dev profile (`opt-level = 1`).
Compiling the dependencies at `opt-level = 3` did not make it faster (20.6 s), so the profile
is unchanged.

**What this shows:** in this implementation, nothing Door holds appears in what Agora sees, and
proofs share no bytes with each other. Pseudonyms do not repeat across contexts, and simple
statistical attacks link no better than the disclosed area allows. **What it does not show:**
that BBS proofs are zero-knowledge, or that pseudonyms are unlinkable under DDH. Those are
properties of the cryptography, taken from the IRTF drafts and the `zkryptium` library (itself
unaudited, and with the `calculate_b` deviation noted in `spec/door/README.md`). A cleverer
algebraic attack is the red team's and the auditor's job.

## 4. What remains for the human red team

The cryptography can be perfect and these still link people. Each needs a person with an
attacker's mindset, not a unit test.

1. **Timing.** Agora stores `created_at` on every idea and upvote. If Door logs enrolment
   times (v1 has no durable store and no log line, but a production deployment will log
   something), "enrolled at 10:02, first upvote at 10:03" links people in small areas.
   Countermeasures to evaluate: no timestamps in Door logs, coarse timestamps in Agora, and
   advice in the app to wait before first use. The harness shuffles the log, so it does not
   measure this.
2. **Network metadata.** IP address, TLS session, user agent and request timing at Caddy, at
   Agora and at Door, and Cloudflare in front of all of them. The same client IP at enrolment
   and at an upvote links the two outright. Both services run on one host (Mulinux), under
   one operator. Needs a review of what every proxy and service logs, retention, and whether
   the app should go through a relay.
3. **Small anonymity sets.** The best any attack can do is the anonymity set, so the set
   itself must be large. A presentation in `agora:<area>` hides its author among the
   **enrolled adults** of that area, not among its residents. From the Charter populations
   (residents, all ages, rounded; minors make the real set smaller):

   | Area | Residents | Set at 1% enrolled | at 10% | at 50% |
   |---|---|---|---|---|
   | Vianden canton | 5,800 | 58 | 580 | 2,900 |
   | Wiltz canton | 19,700 | 197 | 1,970 | 9,850 |
   | Esch-sur-Alzette commune | 37,000 | 370 | 3,700 | 18,500 |
   | Luxembourg City | 134,700 | 1,347 | 13,470 | 67,350 |
   | Luxembourg | 672,050 | 6,720 | 67,205 | 336,025 |

   - **Early pilots are small.** In the harness, Vianden got 2 of the 200 enrolees, so each of
     their actions there had a 1-in-2 chance of being attributed. In a pilot where only a few
     people in a commune have enrolled, everyone there is close to identified, and with one
     enrolee they are identified outright.
   - **The Charter data lists only 2 of Luxembourg's communes.** Communes are the level
     Agora's local matters use, and several are much smaller than any canton (to confirm
     against STATEC; the data file says it must be refreshed).
   - **The active set is smaller still.** The effective set for one upvote is the people who
     acted in that area in a given window. Three upvotes on one commune idea in an hour hide
     their authors among three, not among the commune.

   Needs a rule before any pilot, for example a minimum enrolled count per area before Agora
   accepts actions there (Door publishes counts per commune already in the protocol), or
   coarser contexts for small communes.
4. **Content and style.** The text of ideas, the topics a person cares about, and writing style
   are identifying whatever the credential does.
5. **Door's other data.** In v1, `rid` is stored in the clear, there is one OPRF key, and there
   is no durable store. The deviations table in `modules/door/README.md` lists each one. Once a
   durable store and logs exist, the red team must re-check what they hold.
6. **Collusion with the identity provider.** EUDI or LuxTrust sees the enrolment time and the
   person. Combined with item 1, that is the same timing attack from the other side.

## 5. Reproduce

```sh
cargo test -p d2-door --test unlinkability -- --nocapture   # prints the table above
cargo test -p d2-door --test acceptance -- --nocapture      # Sybil: 1000 attempts, 900 credentials
uv run pytest -q modules/agora/tests/test_door.py -k keeps_the_nym
```
