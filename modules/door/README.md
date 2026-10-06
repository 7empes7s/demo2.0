# Door

State identity in, anonymous credential out. A person proves who they are **once**; Door hands
back a credential that says only "one adult resident of this place, this year" and that cannot
be linked back to the person, by anyone, Door included. Every context (an Agora area, a Booth
round, a Commons matter) sees the same person as one stable pseudonym and different contexts
cannot be joined.

Rust crate `d2-door`, the first Rust module in the repo. Licence: AGPL-3.0-or-later.

> **Security status: unaudited prototype. Do not use for anything binding.**
>
> This is the protocol core of `docs/architecture/02-protocols.md` section 1 with a **mock
> identity provider**. Nobody outside this repo has reviewed the code. The BBS library it uses
> describes itself as "an experimental implementation for research purposes". The deviations
> from the protocol document are listed [below](#deviations-from-02-protocols-section-1); the
> external audit the roadmap requires before any binding use (00-overview section 7, Phase 3)
> has not happened.

## What it does

| Step (02-protocols section 1) | Here |
|---|---|
| 1. App draws a secret `s` | `Holder::new` |
| 2. EUDI wallet or LuxTrust presentation | `MockIdProvider` (fixtures). Real providers are deferred, see below |
| 3. `u = OPRF_K(person_id)` | `UniquenessKey` (RFC 9497 OPRF, ristretto255, single key) |
| 4. Refuse a second credential for `u` in the epoch | `UniquenessStore` (`MemoryStore` in v1) |
| 5. Blind BBS signature over the committed `s` and the coarse attributes | `Holder::commit` then `Issuer::enrol` then `Holder::finalize`. Door never sees `s` |
| 6. Store `u -> epoch` and the revocation handle, discard the rest | `UniquenessEntry` |
| Use: BBS proof disclosing only what the context needs, per-context pseudonym | `Credential::present` and `verify` |

Attributes a credential carries: `jurisdiction_path` (Charter path such as `lu.esch`, one
BBS message per level so a presentation can disclose a prefix), `adult`, `epoch`, and the
revocation handle `rid` (never disclosed). Nothing else.

Pseudonyms: `pseudonym = hash_to_curve(context_id) * nym_secret` (the per-verifier-linkability
draft), published as the compressed G1 point and as a short text form `nym-` + 26 base32
characters of its SHA-256, the shape Agora already stores.

## Cryptography: reviewed crates only

| Need | Crate | Standard |
|---|---|---|
| BBS signatures and proofs, BLS12-381 | `zkryptium` 0.7.1 | draft-irtf-cfrg-bbs-signatures-12 |
| Blind issuance (Door never sees `s`) | `zkryptium` (`bbsplus_blind`) | draft-irtf-cfrg-bbs-blind-signatures-02 |
| Per-context pseudonyms bound to the proof | `zkryptium` (`bbsplus_nym`) | draft-irtf-cfrg-bbs-per-verifier-linkability-03 |
| Uniqueness key | `voprf` 0.5.0 | RFC 9497, ristretto255-SHA512 |

No curve arithmetic is written here. Ciphersuite: `BBS_BLS12381G1_XMD:SHA-256_SSWU_RO_`.

Two things found while integrating `zkryptium`, both guarded in this crate:

- Its byte parsers (`BBSplusPoKSignature::from_bytes`, `BBSplusCommitment::from_bytes`)
  index into the input without checking its length, so a short proof or commitment panics.
  `proof_verify_with_nym` also derives the number of undisclosed messages from the proof
  length with unchecked subtraction. Door computes the exact expected length
  (`proof_len(disclosed)`, `COMMITMENT_LEN`) and refuses anything else before the library sees
  it; `tests/flow.rs::malformed_input_is_an_error_not_a_panic` covers it.
- Its `calculate_b` uses the base point `P1` where the blind-signatures draft uses `Q_1`
  (a comment credits the Grotto implementation). Interoperability with other BBS
  implementations is therefore not established; see "Deferred".

## Run it

```sh
tools/dev-setup.sh                         # installs the pinned toolchain (rust-toolchain.toml)
cargo test -p d2-door                      # 20 unit and integration tests, plus the vector drift test
cargo run -p d2-door -- demo               # enrol the demo people, present in three contexts, verify
cargo run -p d2-door -- check spec/door/vectors.json
cargo run -p d2-door -- vectors --out spec/door/vectors.json   # regenerate (only with a format change)
```

## Library API

```rust
use d2_door::*;

// Door
let mut door = Issuer::new(UniquenessKey::from_seed(seed), MemoryStore::new());
door.add_epoch(IssuerSecret::generate(1, "2026-01-01T00:00:00Z", "2026-12-31T23:59:59Z", &mut rng));
let key: IssuerKey = door.issuer_key(1).unwrap().clone();        // publish on Record

// Holder, enrolment
let holder = Holder::new(&mut rng);
let commit = holder.commit()?;                                    // send commit.commitment
let issuance = door.enrol(&assertion, 1, &commit.commitment, &mut rng)?;   // or EnrolError::AlreadyEnrolled
let credential = holder.finalize(&key, &issuance, &commit.blind)?;

// Holder, use
let wants = Disclosure { jurisdiction_levels: 2, adult: true, epoch: false };
let presentation = credential.present(&key, "agora:lu.esch", challenge, &wants)?;

// Verifier
let v: Verified = verify(&key, &presentation, "agora:lu.esch", challenge, &wants)?;
v.pseudonym.nym();                 // "nym-..." stable for this holder in agora:lu.esch
v.disclosed.jurisdiction_path;     // Some("lu.esch")
v.disclosed.adult;                 // Some(true)
```

`verify` fails with one of `EpochMismatch`, `ContextMismatch`, `ChallengeMismatch`,
`MissingDisclosure`, `Malformed` or `InvalidProof`, checked in that order, so a replay or a
wrong key is named as such rather than as a bad proof. The verifier decides policy: it asks for
`adult` and reads the value; a minor's credential can disclose `adult=false` but can never prove
`adult=true` (`tests/flow.rs::a_minor_cannot_claim_to_be_adult`).

All types serialise to JSON (`IssuerKey`, `Issuance`, `Credential`, `Presentation`,
`Verified`); byte strings are lowercase hex.

## Tests and vectors

`cargo test -p d2-door` runs:

- unit tests: message layout, prefix disclosure, base32, OPRF direct vs blinded path, store;
- `tests/flow.rs`: one enrolment per `u` per epoch (second device refused, next epoch allowed);
  Door never receives `s`; same context gives the same pseudonym with a fresh proof; different
  contexts and different people give different pseudonyms and share no proof bytes; replay to
  another context or challenge fails, with and without editing the fields; wrong epoch key and
  another Door's key fail; tampered disclosure, pseudonym swap and flipped proof bits fail;
  `adult=false` cannot claim adult; disclosure is minimal (nothing about Esch leaks when only the
  country is disclosed); malformed input is an error, never a panic; JSON round trips;
- `tests/vectors.rs`: `spec/door/vectors.json` still checks (36 checks), and regenerating gives
  the same deterministic parts and case list.

The vectors are **generated by this code** from public test seeds and say so in the file. They
are not fixtures from another implementation. Format: `spec/door/README.md`.

## Deviations from 02-protocols section 1

Honest list, in protocol order. Each is a gap to close, not a design change.

| Protocol | v1 | Why / what it takes |
|---|---|---|
| Step 2: EUDI wallet (OpenID4VP, SD-JWT VC) or LuxTrust | `MockIdProvider` with fixture people | Both need a relying-party registration (an ask for Marouane). The `IdentityProvider` trait is the seam |
| Step 3: `K` is a threshold OPRF key held k-of-n, in an HSM for v1 | One key derived from a 32-byte seed held in process memory | The blinded path (`BlindedPerson` / `UniquenessKey::blind_evaluate`) is implemented and tested, so the key holder can be moved out of Door; threshold evaluation is a Phase 5 item in the protocol too |
| Step 4: refuse, "or go to the lost-device path" | Refuse only | Lost-device re-enrolment needs the revocation escrow below |
| Step 5: holder commits to `(s, jurisdiction_path, adult, epoch, rid)` | Holder commits to `s` only; the four attributes are signer-known messages | Door learns all four from the identity assertion anyway and must check them against it, so committing them hides nothing from Door. The attributes are still bound into the same signature and selectively disclosable. Revisit if the holder should ever carry attributes Door must not see |
| Step 5: "Door never sees `s` or the final credential" | Door never sees `s`. Door does see the signature value it produced, which is the signature inside the credential | That is how the blind-signatures draft works; proofs are zero-knowledge of the signature, so knowing it does not help link presentations. The final `nym_secret = s + Door's entropy` is unknown to Door |
| Step 6: `Enc_T(rid)` escrowed to a threshold key `T` | `rid` stored in the clear in `UniquenessEntry.revocation_handle` | Threshold encryption not built. Knowing `rid` links nothing (it never appears in a presentation), but one Door operator could revoke anyone alone. Field is named for what it is |
| Use: revocation accumulator and non-membership proofs | None | `RevocationAccumulator` not implemented; no presentation proves non-revocation |
| Use: `nym = H(context_id)^s` | `nym = hash_to_curve(context_id) * (s + e)` with Door's entropy `e` | The per-verifier-linkability draft's construction; same properties, and neither side picks the secret alone |
| Public on Record: issuer keys, enrolment counts, accumulator updates | `Issuer::issuer_keys()` and `UniquenessStore::count` exist; nothing is written to Record | Record integration is a separate PR |
| Epoch validity dates | Carried in `IssuerKey`, not enforced by `verify` | Time is the caller's concern; the verifier selects the key by epoch number |
| Session discarded; durable `u -> epoch` store | `MemoryStore` only | A durable store is needed before any deployment |

## Deferred

- Real identity providers (EUDI wallet, LuxTrust): need relying-party accounts.
- Threshold OPRF key and HSM; threshold escrow of `rid`; revocation accumulator; lost-device path.
- Durable uniqueness store; HTTP API (`POST /enrol/start`, `POST /enrol/issue`, `GET /issuer-keys`); Record publication.
- Running the CFRG BBS fixtures. The published `zkryptium` crate does not ship its test fixtures (`autotests = false`), and this session could not reach the upstream repository, so no standard vectors were run. Because of the `calculate_b` deviation noted above, cross-implementation checks need their own work.
- WASM / UniFFI builds for the holder side in the citizen app.
- Full AGPL text in `LICENSE` (gnu.org was unreachable; the file carries the SPDX identifier and a pointer).

## Intended integration with Agora (next PR)

Agora's `NymSource` (`modules/agora/src/d2_agora/identity.py`) takes `(participant, context_id)`
and returns a `nym-...` string; v1 ships `KeyedNyms`, which enforces one upvote per nym but not
one per human. The Door-backed replacement:

1. The citizen app holds a `Credential` and asks Agora for a one-time challenge for the
   context `agora:<jurisdiction>`.
2. It calls `Credential::present(key, context, challenge, Disclosure { jurisdiction_levels: depth of the idea's jurisdiction, adult: true, epoch: false })` and sends the `Presentation` JSON as the `participant` value.
3. A `DoorNyms` implementation of `NymSource` calls `verify` with the epoch's `IssuerKey`
   (from `GET /issuer-keys`, later from Record), checks that the disclosed jurisdiction equals
   the idea's and that `adult` is true, consumes the challenge, and returns `pseudonym.nym()`.
   The format is the one `KeyedNyms` already produces, so Agora's tables do not change.
4. Agora's `participant` validation (`[A-Za-z0-9_-]{16,128}`) is replaced by presentation
   parsing; nothing of the presentation is stored, only the nym.

Since Agora is Python, the simplest bridge is a small Rust `d2-door verify` HTTP endpoint on
loopback (one systemd unit, health endpoint), or a PyO3 binding if the call volume warrants it.
Decide in that PR.
