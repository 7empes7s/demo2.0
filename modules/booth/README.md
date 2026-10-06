# Booth

Secret, verifiable ballots. Voters encrypt their choice under a key no single party holds, the
board shows every message to everyone, and the result comes with proofs anyone can check from
the board alone, without trusting the operator or any one guardian.

Rust crate `d2-booth`. Licence: AGPL-3.0-or-later.

> **Security status: unaudited prototype. Non-binding use only.**
>
> This is the protocol core of `docs/architecture/02-protocols.md` section 2, in the form the
> document lists as the *alternative considered*, not the recommended MACI path (why: below).
> Nobody outside this repo has reviewed the code or the protocol choices. The Phase 3 exit
> criteria (00-overview section 7) require an **external cryptographic audit of Door and
> Booth, completed and published, before any binding use**. That audit has not happened.
> Shadow votes and organisational test rounds only.

## What it does

| Step (02-protocols section 2) | Here |
|---|---|
| 5. Guardians' threshold key | `Dealer`, `run_dkg`: joint Feldman VSS, k-of-n, over ristretto255. Joint key `K` on the board as `round.key`, derived by every verifier from the guardians' commitments |
| 1. Sign-up with the round pseudonym and a fresh round key | `Voter::signup`: `{nym, voter_key}` (Ed25519). One sign-up per pseudonym |
| 2. Messages, all the same size | `Voter::ballot`: one exponential ElGamal ciphertext per option, a 0-or-1 proof each, a sum-to-one proof, signed. Every ballot of a round has the same shape and byte size |
| Re-vote | A later valid ballot under the same pseudonym replaces the earlier one. Only the last counts |
| 3. Hidden key change | **Not implemented**, see "Receipt-freeness" |
| 4. Tally with a proof anyone can verify | Homomorphic aggregate of the counted ballots, each guardian's partial decryption with a Chaum-Pedersen proof, Lagrange combination of any `k`, counts by discrete log. `verify_board` replays everything from entry 0 |
| Public board | `Board`: append-only, hash-chained entries with canonical JSON payloads (`spec/booth/README.md`) |
| Delegation (section 3) | **Stub**, `delegation.rs` says why |

### Why the homomorphic path and not MACI

MACI gets receipt-freeness from a coordinator who decrypts every message privately and proves
with a zk-SNARK that it processed them by the rules. Without that proof the coordinator must be
trusted for integrity, which the spec rightly refuses; and there is no reviewed, version-pinned
SNARK toolchain this crate could lean on today the way it leans on `curve25519-dalek` for curve
arithmetic. The homomorphic tally with threshold guardians gives, now:

- **integrity without trust**: every ballot's well-formedness, every decryption share and the
  final counts are proved on the board;
- **secrecy against any `k−1` guardians and the operator together**: nobody decrypts a single
  ballot, only the aggregate, and only when `k` guardians cooperate. (MACI v1 as described in
  the spec would have had a single coordinator who sees every vote.)

What it costs is receipt-freeness, next.

## Receipt-freeness: what v1 achieves and what it does not

Achieved:

- A ballot's bytes do not say whether it is a first vote or a re-vote: same shape, same size,
  fresh randomness (tested).
- Only the last valid ballot per pseudonym counts; a coerced vote followed by a private re-vote
  gives the same counts as if the coercion never happened (tested, `tests/acceptance.rs`).
- Nobody can decrypt any single ballot, so a coercer cannot learn the re-vote's content from the
  board, even with the operator's help, short of `k` guardians colluding.

Not achieved, stated plainly:

- **The board shows that a re-vote happened.** Two public artefacts reveal it: the board has
  more ballots than sign-ups, and the two ballots carry the same pseudonym. A coercer who has
  seen the voter's pseudonym (for example on the coerced ballot) sees the second ballot. This is
  exactly the leak 02-protocols section 2 names when it rejects this path as the primary one,
  and it means **the Phase 3 criterion "no public artefact reveals that a re-vote happened" is
  not met by v1**. The acceptance test asserts this leak explicitly rather than hiding it.
- MACI's key-change message is left out on purpose: on a public board it would be one more
  artefact that reveals the same thing. It only helps once messages are processed in a hidden,
  proven computation.
- A voter can still produce a receipt for a *single* ballot by revealing its randomness; it is
  the re-vote that is meant to make the receipt worthless, and here the re-vote is visible.

Removing the leak needs the processing proof (zk-SNARK or an MPC among the guardians over
decrypted messages), reviewed by external cryptographers. That is the next protocol step, and
it is a Phase 3 exit requirement.

## Cryptography: reviewed crates only

| Need | Crate | Notes |
|---|---|---|
| Group, ElGamal, Feldman commitments, Chaum-Pedersen | `curve25519-dalek` 4.1.3 (ristretto255) | prime-order group, no cofactor pitfalls |
| Fiat-Shamir transcripts | `merlin` 3.0.0 | labels in `spec/booth/README.md` |
| Voter round keys and ballot signatures | `ed25519-dalek` 2.2.0 | RFC 8032; small-order keys refused |
| Hashing of the board | `sha2` 0.10 | |
| Deterministic vectors | `rand_chacha` 0.3 (ChaCha20) | test material only |

No curve or field arithmetic is written here. Secret scalars are zeroised on drop (`zeroize`).

### Key generation: joint Feldman, k-of-n

Each guardian deals a random polynomial of degree `k−1`, publishes `k` Feldman commitments and
a Schnorr proof of knowledge of its constant term, and sends every other guardian one share
over a private channel. Receivers check shares against the commitments; the joint key and every
guardian's verification key fall out of the commitments, so a verifier derives them rather than
trusting the `round.key` entry. Chosen because it is the simplest well-specified scheme that
needs no dealer, is the one ElectionGuard uses, and the only thing the key is used for is
ElGamal decryption, for which Gennaro, Jarecki, Krawczyk and Rabin show the known bias of joint
Feldman does not matter. Not here yet: an authenticated channel for shares (`run_dkg` passes
them in memory, which is only right when one process plays every guardian, as in tests), and a
complaint round (a bad share aborts the setup, `BadShare`).

## The verifier

`verify_board(board)` uses the board and nothing else. It checks, in order: the hash chain;
the parameters (2 to 64 options, `1 <= k <= n <= 64`, id charset); every guardian's commitment
count and proof of knowledge, in index order; that `round.key` equals what the commitments
derive to; every sign-up (pseudonym shape, Ed25519 key, no duplicates); every ballot (round id,
pseudonym signed up with that very key, shape, signature, every 0-or-1 proof, the sum proof);
that nothing comes after `round.close` but partial decryptions and one tally; every partial
decryption (guardian in range, not twice, one share per option, each proof against the real
aggregate of the last valid ballots); the tally (counts sum to counted, sign-up and counted
figures match the board, the named guardians are at least `k`, distinct, ascending and present,
and `B_j − Σ λ_i M_{i,j} == counts_j·G` for every option). Any failure fails the whole board; no
entry is ever skipped. Ballot proofs are checked on all cores first and the sequential replay
reuses those results when the registered key matches.

An independent verifier in another codebase, built from `spec/booth/README.md` and checked
against `spec/booth/vectors.json`, is the Phase 3 acceptance test proper and is still to come.

## Run it

```sh
tools/dev-setup.sh                               # pinned toolchain (rust-toolchain.toml)
cargo test -p d2-booth                           # unit, flow, no-panic sweep, vector drift, acceptance
cargo run -p d2-booth -- demo --out board.json   # a 5-guardian, 20-voter round in one process
cargo run -p d2-booth -- verify board.json       # replay and print the tally it proves
cargo run -p d2-booth -- check spec/booth/vectors.json
cargo run -p d2-booth -- vectors --out spec/booth/vectors.json   # regenerate (only with a format change)
```

The 10,000-ballot acceptance test takes about 18 s on 4 cores (encryption in parallel,
operator check and verification included). No flag sizes it down.

## Deviations from 02-protocols section 2

- Homomorphic tally with threshold guardians (the "alternative considered") instead of MACI;
  receipt-freeness not achieved (above).
- The pseudonym is taken as given: a Door presentation for context `booth:<round_id>` is not
  checked at sign-up yet, so eligibility rules (`concerned`, `knowledgeable`, `judge`,
  `eligibility.outsiders`) are not evaluated.
- No key-change, delegate or revoke messages; delegation is a stub.
- No HTTP service (`POST /rounds`, `/messages`, `/board`, `/tally`), nothing written to Record,
  no Charter parameters read.
- Shares are passed in memory in `run_dkg`; no complaint round.
- A round in which nobody voted has no tally entry (a share of the identity proves nothing; the
  verifier reports `no_tally`).
- One ballot weight per pseudonym; no weights.

## Next

1. Processing proof for receipt-freeness (zk-SNARK over the message processing, or MPC among
   guardians), then the full re-vote criterion.
2. Independent verifier (TypeScript or Python) from the spec, run against the vectors and a
   10,000-ballot board.
3. Door presentation check at sign-up; `round.opened` and `round.tally` entries in Record.
4. Delegation with Charter caps inside the tally.
5. External cryptographic audit.
