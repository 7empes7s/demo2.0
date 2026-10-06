# Changelog

## Unreleased

- Fix (review of PR #31): a voter's earlier (coerced) ballot could be replayed after its re-vote and "last counts" reinstated it. Ballots now carry a signed `ballot_seq` that is bound into the bit and sum proof transcripts and must strictly increase per pseudonym; exact copies of an accepted ballot (same signed digest) are refused too. New error code `ballot_replay`; `Voter::ballot_with_seq`.
- Canonical JSON refuses null, booleans and negative integers (spec section 2 already excluded them); `board::parse_board` refuses board files with a duplicate object key, and `d2-booth verify` uses it.
- Vectors: new `copy` mutation; must-fail cases for a replayed ballot, a duplicated ballot, an equal and a decreasing `ballot_seq` (both really signed) and an edited `ballot_seq` (29 cases).

## 0.1.0

- Protocol core of Booth (02-protocols section 2) as a homomorphic tally with threshold guardians, the document's "alternative considered"; unaudited, non-binding. Receipt-freeness is not achieved: the board shows that a pseudonym cast a second ballot (README "Receipt-freeness").
- k-of-n guardian key by joint Feldman VSS over ristretto255 with a Schnorr proof per constant term; `run_dkg` for one-process setups; joint and per-guardian keys derived from the commitments by every verifier.
- Ballots: exponential ElGamal per option, disjunctive Chaum-Pedersen 0-or-1 proofs, sum-to-one proof, transcripts bound to the round id and pseudonym, Ed25519 signature by the round key registered at sign-up. Last valid ballot per pseudonym counts.
- Board: append-only, hash-chained entries over canonical JSON; strict state machine shared by the operator (`Round`) and the verifier (`verify_board`); partial decryptions with Chaum-Pedersen proofs; counts by discrete log; ballot proofs verified in parallel.
- `d2-booth` CLI (`verify`, `demo`, `vectors`, `check`); `spec/booth/` wire format and deterministic vectors with 24 must-fail mutations and a drift test.
- Tests: unit, flow, no-panic sweep over every field and JSON type, Phase 3 re-vote test (with the admitted leak asserted) and a 10,000-ballot election verified from a JSON round trip of the board.
- Delegation (section 3) is a documented stub.
