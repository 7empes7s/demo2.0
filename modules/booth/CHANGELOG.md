# Changelog

## 0.1.0

- Protocol core of Booth (02-protocols section 2) as a homomorphic tally with threshold guardians, the document's "alternative considered"; unaudited, non-binding. Receipt-freeness is not achieved: the board shows that a pseudonym cast a second ballot (README "Receipt-freeness").
- k-of-n guardian key by joint Feldman VSS over ristretto255 with a Schnorr proof per constant term; `run_dkg` for one-process setups; joint and per-guardian keys derived from the commitments by every verifier.
- Ballots: exponential ElGamal per option, disjunctive Chaum-Pedersen 0-or-1 proofs, sum-to-one proof, transcripts bound to the round id and pseudonym, Ed25519 signature by the round key registered at sign-up. Last valid ballot per pseudonym counts.
- Board: append-only, hash-chained entries over canonical JSON; strict state machine shared by the operator (`Round`) and the verifier (`verify_board`); partial decryptions with Chaum-Pedersen proofs; counts by discrete log; ballot proofs verified in parallel.
- `d2-booth` CLI (`verify`, `demo`, `vectors`, `check`); `spec/booth/` wire format and deterministic vectors with 24 must-fail mutations and a drift test.
- Tests: unit, flow, no-panic sweep over every field and JSON type, Phase 3 re-vote test (with the admitted leak asserted) and a 10,000-ballot election verified from a JSON round trip of the board.
- Delegation (section 3) is a documented stub.
