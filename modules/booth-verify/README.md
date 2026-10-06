# Booth verifier

An independent check of a Booth board: it replays every entry and prints the tally the board
proves, or the spec's error code. It was written in Python from
[`spec/booth/README.md`](../../spec/booth/README.md) and
[`spec/booth/vectors.json`](../../spec/booth/vectors.json) alone. It shares no code with
`modules/booth` (Rust), and its author did not read that crate's source or tests.

```
uv run d2-booth-verify board.json            # ok: <round>, N counted of M sign-ups, guardians ...
uv run d2-booth-verify board.json --json     # {"ok": true, "tally": {...}} or {"ok": false, "error": ...}
uv run d2-booth-verify board.json --jobs 1   # ballot proofs on one core (default: all cores)
```

Exit 0: the board proves the printed tally. Exit 1: it does not, and the output starts
`fail: <code>` with one of the spec's codes (`chain_broken`, `malformed`, `params`,
`out_of_order`, `proof_failed`, `bad_signature`, `duplicate_signup`, `not_signed_up`,
`ballot_replay`, `below_threshold`, `tally_mismatch`, `no_tally`). Exit 2: the file could not
be read. The spec defines no CLI or exit codes; these follow `modules/record-verify`.

## What is implemented here, and from what

| Piece | Here |
|---|---|
| ristretto255 and scalars | pure Python from RFC 9496 (`ristretto.py`), checked against its test vectors. Not libsodium: PyNaCl does not expose `crypto_core_ristretto255_*`, and a system libsodium is not guaranteed on CI |
| Merlin transcripts | pure Python STROBE-128 over a Keccak-f[1600] written here (`merlin.py`), checked against SHA3-256 and Merlin's published test vector |
| Ed25519 | PyNaCl (libsodium) `verify`; the small-order key check at sign-up is done here |
| SHA-256, canonical JSON, the board | `hashlib`; `canonical.py` and `verify.py`, section by section of the spec |
| Must-fail mutations | `vectors.py`, from section 6 |

Ballot proofs are checked in parallel on all cores before the sequential replay, which reuses
those results; the outcome and error code do not depend on `--jobs` (tested).

## Evidence

- `spec/booth/vectors.json`: the board verifies to `{"signups":6,"counted":6,"counts":[3,1,2],"guardians_used":[1,3]}`,
  and all 29 must-fail boards fail with exactly the recorded code (`tests/test_vectors.py`).
- The Rust `d2-booth demo` board (5 guardians, 20 voters) verifies to the same tally the Rust
  CLI prints, `[7, 7, 6]` with guardians 1, 2, 4 (run once by hand, not in CI: CI has no
  Rust-made board other than the vectors).
- **10,000 ballots.** The Rust CLI cannot write a large board (`demo` is fixed at 20 voters
  and the 10,000-ballot Rust test keeps its board in memory), so `testgen.py` builds one from
  the spec with a public seed, and the Rust verifier checks it as a black box:

  ```
  uv run python -m d2_booth_verify.testgen --voters 10000 --revotes 100 --out board10k.json
  ./target/release/d2-booth verify board10k.json     # Rust: exit 0, yes 3333, no 3334, abstain 3333
  uv run d2-booth-verify board10k.json               # this verifier: exit 0, same tally
  ```

  Run of 2026-10-06 on a 4-core cloud session: 10,000 voters, 100 re-votes (10,100 ballots),
  5 guardians, threshold 3, 20,112 entries, 31.9 MB. Generation 68 s; Rust verify 6.0 s;
  this verifier 102 s wall (4 processes), exit 0, tally `[3333, 3334, 3333]`, 10,000 counted of
  10,000 sign-ups, guardians 1, 2, 3: equal to the script's expected counts and to the Rust
  verifier's output. CI runs the same path on a 24-voter board (`tests/test_generated.py`).

  Caveat: this board is made by this package, so its agreement with the Rust verifier shows
  that both read the spec the same way; a large board made by the Rust code would be stronger
  evidence. That needs a `d2-booth demo --voters N` (or an export from the 10,000-ballot test).

## Spec gaps found

Each was resolved by a reasonable reading, not by reading the Rust code. All 29 vectors agree
with these readings, so where a vector exercises the point the reading is confirmed.

1. **Check order inside a ballot is only partly given.** Section 3.5 orders the five steps, but
   not where shape checks (hex length, point and scalar decoding) sit. Here: field set and
   types first (`malformed`), then step 1, then decoding of every point and scalar
   (`malformed`), then the signature. A ballot whose point is not a valid encoding is therefore
   `malformed`, not `bad_signature`.
2. **Order check before shape check.** The vectors need `out_of_order` for a partial
   decryption relabelled `ballot` after close, and `malformed` for a sign-up relabelled
   `ballot` before close: so the state machine is checked before the payload. The spec does
   not say so.
3. **Whole-board phases.** "Chain first, then replay" is implied by the vectors
   (`seq_edited`, `hash_edited`), not stated. Here: JSON and envelope shape, then the whole
   chain, then the replay.
4. **`params` versus `malformed`** in `round.params`: here, wrong types, unknown fields and a
   wrong `schema` are `malformed`; range and charset violations are `params`. No vector
   exercises `params`.
5. **Unknown `kind`** has no stated code; here `malformed`. A `guardian.commitment` with the
   wrong index is `out_of_order`.
6. **Invalid Ed25519 key at sign-up** (non-canonical, not on the curve, small order) has no
   stated code; here `malformed`. Whether non-canonical key encodings are refused (libsodium
   does, some Ed25519 libraries do not) and whether signature verification is "strict"
   (small-order `R`) is not stated; this verifier uses libsodium's rules.
7. **Empty round.** Section 3.7 says a round with no counted ballot "has no tally", but not
   which code a `partial.decryption` or `tally` entry in such a round gets; here `no_tally`.
8. **Tally check order** for `signups`/`counted` versus `counts` is listed but not ordered;
   here counts length and sum first, then the sign-up and counted figures, then
   `guardians_used` ascending and distinct, at least `k` (`below_threshold`), then present.
9. **Not stated**: whether option labels must be distinct; whether two sign-ups may share a
   `voter_key`; whether `matter_id` has a charset. This verifier accepts all three.
10. **No CLI or exit codes** are specified, and the Rust CLI cannot produce a large board
    (above).

## Not yet

- A Rust-made 10,000-ballot board (needs the Rust CLI to export one).
- Door presentations at sign-up: not on the board in v1, so not checked.

Licence: Apache-2.0.
