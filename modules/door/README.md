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
  it; `tests/flow.rs::malformed_input_is_an_error_not_a_panic` covers it. The same holds for
  the issuer key (`BBSplusPublicKey::from_bytes` reads 96 bytes unchecked; `IssuerKey::public_key`
  checks the length first) and the pseudonym (`BBSplusPseudonym::from_bytes` reads 48 bytes
  unchecked; a `Pseudonym` can only be built, or parsed from JSON, as lowercase hex of exactly
  48 bytes). `tests/no_panic.rs` feeds random content of every length from 0 to 299 bytes into
  every externally supplied byte or hex field of `verify`, `finalize`, `present`, `enrol` and the
  OPRF and checks nothing panics.
- Its `calculate_b` uses the base point `P1` where the blind-signatures draft uses `Q_1`
  (a comment credits the Grotto implementation). Interoperability with other BBS
  implementations is therefore not established; see "Deferred".

## Run it

```sh
tools/dev-setup.sh                         # installs the pinned toolchain (rust-toolchain.toml)
cargo test -p d2-door                      # unit, flow, HTTP service, two no-panic sweeps, vector drift
cargo run -p d2-door -- demo               # enrol the demo people, present in three contexts, verify
cargo run -p d2-door -- serve --issuer-key key-epoch1.json   # verifier service on 127.0.0.1:8092
cargo run -p d2-door -- check spec/door/vectors.json
cargo run -p d2-door -- vectors --out spec/door/vectors.json   # regenerate (only with a format change)
```

## Verifier service (`d2-door serve`)

So that modules in other languages can check presentations without linking this crate, `d2-door
serve` runs the verifier as a small HTTP service: standard library only (no HTTP framework), on
`127.0.0.1:8092` by default. Issuer public keys come from files, one `IssuerKey` JSON per epoch
(`--issuer-key` repeated); a key that does not decode or a second key for an epoch stops the
start.

| Request | Response |
|---|---|
| `POST /presentations/verify` `{presentation, context, challenge, epoch, require?}` | `200 {pseudonym, nym, disclosed, epoch}` |
| `GET /issuer-keys` | `200 {keys: [IssuerKey, ...]}` |
| `GET /healthz` | `200 {ok, epochs}` |

- `context` is the caller's own context, `challenge` the one-time value it issued (lowercase hex,
  1-64 bytes); the service does not remember challenges, the caller makes them single use.
- `epoch` is the **one** epoch the caller accepts for this context. The service never takes the
  epoch from the presentation, so a holder with credentials for two epochs cannot get two
  pseudonyms in one context through it.
- `require` is a `Disclosure` (`jurisdiction_levels`, `adult`, `epoch`); default nothing. The
  answer gives the disclosed values; policy on them (adult must be true, which jurisdiction) is
  the caller's.
- Errors are `{error, code}`: `422` with `epoch_mismatch`, `context_mismatch`,
  `challenge_mismatch`, `missing_disclosure`, `malformed` (proof length), `invalid_proof` or
  `unknown_epoch`; `400` with `invalid_body` (not the documented shape, unknown field, bad
  challenge or context) or `malformed` (a presentation field that does not parse, such as the
  pseudonym).
- Limits: head 8 KiB (`431`), body 64 KiB (`413`), `Content-Length` required (`411`),
  `Transfer-Encoding` refused (`501`), the whole request within 5 s (`408`), 32 connections at
  once (`503 busy`); every answer closes the connection.
- No panics: `tests/no_panic.rs::random_http_input_never_panics` feeds random bytes as whole
  requests and as bodies, truncated and bit-flipped valid requests, odd `Content-Length` values
  and request lines, and values of every JSON type in every body and presentation field.

Holder-side helpers for tests and development (mock identity provider only):
`d2-door dev-world --out <dir> --person <name>:<adult|minor>:<path>` writes a fresh issuer's
public key and one credential per person; `d2-door present --credential <file> --issuer-key
<file> --context <id> --challenge <hex> --levels <n> --adult` prints a presentation.

## Library API

```rust
use d2_door::*;

// Door
let mut door = Issuer::new(UniquenessKey::from_seed(seed), MemoryStore::new());
door.add_epoch(IssuerSecret::generate(1, "2026-01-01T00:00:00Z", "2026-12-31T23:59:59Z", &mut rng))?;   // refuses an existing epoch
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
- `tests/http.rs`: the verifier service: every answer of `POST /presentations/verify` (success,
  minor, other context, other challenge, unknown epoch, missing disclosure, tampered fields,
  unknown fields, bad challenge or context), request reading and every limit, a slow client
  getting `408` within the total deadline, key files, and a real round trip over TCP including
  the connection cap;
- `tests/no_panic.rs`: random input in every external field of the library, and in every part
  of an HTTP request to the service;
- `tests/vectors.rs`: `spec/door/vectors.json` still checks (40 checks), and regenerating gives
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
| Epoch validity dates | Carried in `IssuerKey`, not enforced by `verify` | Time is the caller's concern; the verifier selects the key by epoch number. A holder with credentials for two epochs has two pseudonyms per context, so a verifier must accept one epoch per context (see the Agora plan below). `Issuer::add_epoch` refuses a second key for an existing epoch, since replacing it would lock out everyone already enrolled in it |
| Step 3: `person_id` from the identity provider | `IdentityAssertion::check_person_id`, enforced by `Issuer::enrol`: a real provider's id must be exactly 13 ASCII digits (Luxembourg national identification number), a mock id `test-person-` and 4 digits; anything else is refused, nothing is trimmed or normalised | The OPRF input is the id byte for byte, so two spellings of one person would be two enrolments. Each real adapter must emit this canonical form; non-Luxembourg identifiers are out of scope for v1 |
| Session discarded; durable `u -> epoch` store | `MemoryStore` only | A durable store is needed before any deployment |

## Deferred

- Real identity providers (EUDI wallet, LuxTrust): need relying-party accounts.
- Threshold OPRF key and HSM; threshold escrow of `rid`; revocation accumulator; lost-device path.
- Zeroising secrets in memory. `IssuerSecret`, `UniquenessKey` and `Holder` keep their secrets in
  ordinary memory with no `zeroize` on drop, and `Credential` serialises `nym_secret` and `blind`
  to JSON (device-local by design). Needed together with the HSM work, before any deployment.
- Durable uniqueness store; enrolment over HTTP (`POST /enrol/start`, `POST /enrol/issue`); Record publication of issuer keys (the verifier reads them from files for now).
- A systemd unit for `d2-door serve` (`civic-door-verify.service`): needs the release binary built in CI and shipped, since Mulinux does not build; Agora is not deployed yet either.
- Epoch rollover for long-lived contexts: Agora accepts one epoch, so when it moves to the next epoch every holder gets new pseudonyms and could upvote an old idea again.
- Running the CFRG BBS fixtures. The published `zkryptium` crate does not ship its test fixtures (`autotests = false`), and this session could not reach the upstream repository, so no standard vectors were run. Because of the `calculate_b` deviation noted above, cross-implementation checks need their own work.
- WASM / UniFFI builds for the holder side in the citizen app.
- Full AGPL text in `LICENSE` (gnu.org was unreachable; the file carries the SPDX identifier and a pointer).

## Agora integration

Agora's `DoorNyms` (`modules/agora/src/d2_agora/identity.py`) is the Door-backed `NymSource`:

1. The app asks Agora for a one-time challenge (`GET /challenge`, 32 random bytes, 120 s, single
   use).
2. It calls `Credential::present(key, "agora:<jurisdiction_id>", challenge, Disclosure {
   jurisdiction_levels: depth of the idea's jurisdiction in Charter, adult: true, epoch: false })`
   and sends the `Presentation` JSON as `participant` in `POST /ideas` or
   `POST /ideas/<id>/upvote`.
3. Agora uses the challenge up, asks `d2-door serve` to verify against the one epoch it is
   configured for (`DOOR_EPOCH`), requires `adult` true and the disclosed path to start with the
   idea's jurisdiction path, and stores only `nym`.

Jurisdiction paths for Agora are Charter ids, root first, joined by `.`:
`lu.lu-canton-esch-sur-alzette.lu-commune-esch-sur-alzette` (`Charter.jurisdiction_path`). The
demo people and the vectors use short illustrative paths (`lu.esch`); a real identity adapter
must emit the Charter form.

The bridge is the HTTP service above rather than a PyO3 binding: one process, no Python build
step, and the call volume (one verification per post or upvote) is small.
