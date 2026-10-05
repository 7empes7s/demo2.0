# Lottery draw format, v1

What an independent verifier needs to reproduce a Lottery draw. `modules/lottery` (Python) runs draws; `modules/lottery-verify` (TypeScript) was written from this page alone. Both test against `vectors/`.

A draw has three published parts: the **pool** (the opted-in pseudonyms), the **commitment** (logged before the seed exists), and the **beacon** (the drand round the commitment named). Anyone holding those three recomputes the panel. Nothing else is needed: no operator key, no server.

All hex is lowercase. All text is ASCII. Integers are decimal with no leading zeros.

## 1. Tokens

| Name | Pattern (whole string) |
|---|---|
| pseudonym | `[A-Za-z0-9+/=_.:-]{1,256}` |
| token (stratum key, stratum value, scheme) | `[A-Za-z0-9][A-Za-z0-9._:-]{0,63}` |
| label (purpose, context) | `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}` |
| hash | 64 lowercase hex digits |

## 2. Pool

A member is a pseudonym and zero or more strata (key → value, both tokens). Pseudonyms are unique within a pool; a pool has at least one member.

```
leaf data = "d2.lottery.member/1\n" nym "\n" { key "=" value "\n" }    strata sorted by key (bytewise)
```

**Canonical order:** members sorted by pseudonym, bytewise ascending. The input order never matters.

**Pool root:** the RFC 9162 section 2.1 Merkle tree hash (the tree Record uses, `spec/record/README.md` section 2) over the leaf data in canonical order:

```
leaf hash = SHA-256(0x00 || leaf data)
node hash = SHA-256(0x01 || left || right)
MTH(D[n]) = node hash(MTH(D[0:k]), MTH(D[k:n]))   k = largest power of two < n
```

A member checks that it was counted with an RFC 9162 inclusion proof `{member, index, size, proof}` (proof hashes in hex, leaf to root), verified with section 2.1.3.2 against the committed root. The verifier must also check `size` equals the committed `pool-size`, because the root alone does not fix the tree size.

## 3. Commitment

The commitment fixes every input except the randomness. It is these lines, each ending `\n`:

```
d2.lottery.draw/1
purpose <label>
context <label>
committed-at <unix seconds>
pool <pool root hash>
pool-size <members in the pool, >= 1>
chain <drand chain hash>
scheme <drand scheme id>
round <drand round, >= 1>
size <panel size, 1..pool-size>
stratify-by <token, or "-" for none>
quota <value> <count>          one line per stratum, sorted by value bytewise; none when "-"
```

`commitment hash = SHA-256(commitment text)`.

Rules a verifier checks:
- With `stratify-by -` there are no quota lines and the pool is one stratum with quota `size`.
- Otherwise there is at least one quota line, quotas sum to `size`, every member has the `stratify-by` key, every member's value has a quota line, every quota line's value is held by at least one member, and no quota exceeds the members holding that value. A quota may be 0.
- **Timing:** the round must be produced at least 3600 seconds after `committed-at` (`round time >= committed-at + 3600`, section 4), so nobody can know the seed when committing. `committed-at` is checked against the time Record logged the `draw.commit` entry.

JSON form (in transcripts): `{version: "d2.lottery.draw/1", purpose, context, committed_at, pool_root, pool_size, chain, scheme, round, size, stratify_by: token|null, quotas: {value: count}}`. Unknown fields are rejected.

## 4. drand beacon

Supported chains (the chain hash is what the commitment names):

| Chain | Hash | Scheme | Period | Genesis |
|---|---|---|---|---|
| quicknet (default for new draws) | `52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971` | `bls-unchained-g1-rfc9380` | 3 s | 1692803367 |
| default | `8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce` | `pedersen-bls-chained` | 30 s | 1595431050 |

Public keys are in `modules/lottery/src/d2_lottery/drand.py` and `modules/lottery-verify/src/drand.ts`, both checked by recomputing the hash:

```
chain hash = SHA-256(uint32be(period) || uint64be(genesis_time) || public key bytes || group hash bytes
                     || beacon_id bytes if beacon_id != "default")
round time = genesis_time + (round - 1) * period
```

A verifier trusts only these League of Entropy chains unless its user explicitly adds another (tests use drand's `walkthrough` test chain this way). A chain the draw's operator runs could be made to sign anything.

A beacon is `{round, randomness, signature, previous_signature?}` (hex). It is valid when all of these hold:

1. `round` equals the committed round.
2. `randomness = SHA-256(signature bytes)`.
3. The BLS12-381 signature verifies under the chain's public key:

| Scheme | Message | Signature | Public key | Hash-to-curve DST |
|---|---|---|---|---|
| `bls-unchained-g1-rfc9380` | `SHA-256(uint64be(round))` | G1, 48 bytes compressed | G2, 96 bytes | `BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_` |
| `pedersen-bls-chained` | `SHA-256(previous_signature \|\| uint64be(round))` | G2, 96 bytes | G1, 48 bytes | `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_` |

Points are ZCash-compressed; reject points not on the curve, outside the prime-order subgroup, or at infinity. Hash to curve is RFC 9380 `hash_to_curve` (random oracle, SSWU). Check `e(H(m), pk) = e(sig, g2)` for signatures on G1, `e(pk, H(m)) = e(g1, sig)` for signatures on G2. An unchained beacon has no `previous_signature`.

Fetching is not part of verification: `GET <relay>/<chain hash>/public/<round>` on any drand relay returns the beacon, and an implementation must verify it as above before use, whoever served it.

## 5. Draw

```
seed     = SHA-256("d2.lottery.seed/1\n" || commitment hash (32 bytes) || randomness (32 bytes))
block(i) = SHA-256("d2.lottery.stream/1\n" || seed || uint64be(i))      i = 0, 1, 2, ...
```

The stream is block(0) || block(1) || ...; `u64()` reads the next 8 bytes as a big-endian unsigned integer.

`below(n)` for `n >= 1` returns a uniform integer in `[0, n)` by rejection sampling, with no modulo bias:

```
limit = 2^64 - (2^64 mod n)
repeat: x = u64(); if x < limit: return x mod n
```

`below(1)` still reads one word.

**Shuffle.** Take the strata in quota-line order (bytewise by value), or the single stratum when unstratified. One stream serves all strata, in that order. For each stratum, list its members' pseudonyms in canonical order as `a[0..m-1]` and run a forward Fisher–Yates shuffle:

```
for i = 0 .. m-2:  j = i + below(m - i);  swap a[i], a[j]
```

The shuffled list is the stratum's **order**. Its first `quota` entries are selected; the rest, in order, are its replacement list.

**Result** (JSON): `{commitment_hash, groups: [{stratum: value|null, quota, order: [nym...]}], selected: [nym...]}` where `selected` is each group's first `quota`, groups in order.

## 6. Notification and replacements

Selected pseudonyms are published in the result. Each citizen's app checks locally whether one of its own per-context pseudonyms is listed; nothing is sent to the person.

Acceptance and decline are pseudonymous. With a set `D` of declined pseudonyms, the panel is, for each stratum, the first `quota` entries of its order that are not in `D`. A replacement therefore comes from the same stratum and the same committed stream, and the panel does not depend on the order in which declines arrive. If a stratum runs out, its missing seats are reported as `short` and are not filled from another stratum.

## 7. Transcript and verification

A transcript is `{commitment, pool, chain_info?, beacon, result?}` with `pool` a list of `{nym, strata}`. To verify:

1. Parse the commitment (section 3) and pool (section 2); recompute the pool root and size and compare.
2. Look up the trusted chain by the commitment's chain hash and check its scheme matches; if `chain_info` is present it must equal that chain.
3. Check the timing rule (section 3).
4. Verify the beacon (section 4) for the committed round.
5. Run the draw (section 5) and compare with `result` when present.

## 8. Vectors

| File | What it pins |
|---|---|
| `vectors/beacons.json` | Real recorded drand beacons and where each came from: League of Entropy mainnet `default` round 2634945, and round 38 of drand's `walkthrough` test chain (scheme `bls-unchained-g1-rfc9380`, as quicknet) |
| `vectors/draws.json` | Pool leaf data, root and every inclusion proof; stream outputs (`u64` and `below`, as decimal strings) for two seeds; three full transcripts with their commitment text and seed; a replacement case; and 15 transcripts that must fail |

`draws.json` is generated by `uv run python -m d2_lottery.vectors --out spec/lottery/vectors/draws.json`; a test fails when it drifts. Pools in it are synthetic.

## 9. Not in v1

- **LEXIMIN.** 02-protocols section 5 calls for a committed LEXIMIN distribution over panels when quotas cross several attributes. v1 stratifies on one attribute with uniform selection inside each stratum, which needs no solver and is exact. A multi-attribute version will commit the computed distribution (a list of panels with probabilities) in the commitment and sample one panel with `below` over a cumulative integer weight.
- **Mainnet quicknet fixture.** The recorded quicknet-scheme beacon comes from drand's test chain; a mainnet quicknet round should be added when a session with access to a drand relay records one.
