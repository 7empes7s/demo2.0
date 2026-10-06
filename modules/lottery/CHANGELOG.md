# Changelog

## 0.1.0

- Pool commitment: RFC 9162 Merkle root over pseudonyms and strata, member inclusion proofs.
- Commitments to a future drand round (at least an hour away), panel size checked against Charter.
- Full drand beacon verification (BLS12-381, quicknet and default chains) with an injectable fetch.
- Draws: SHA-256 counter-mode stream, rejection sampling, Fisher–Yates per stratum; replacements from the same order.
- `d2-lottery` CLI and shared vectors in `spec/lottery/vectors/`.
