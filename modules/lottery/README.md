# Lottery

Verifiable sortition. An organiser commits to a pool of pseudonyms and to a drand round at least an hour in the future; when the round arrives, the panel is drawn from the beacon. Anyone holding the published pool, commitment and beacon reproduces the panel exactly, and nobody, including the organiser, could know it when committing, provided the commitment's Record entry predates the beacon. Verifiers do not check that entry yet (see "Not yet"), so every successful check prints a warning that the commit time is not anchored.

The format is specified in [`spec/lottery/README.md`](../../spec/lottery/README.md). [`modules/lottery-verify`](../lottery-verify) is an independent verifier in TypeScript, written from that spec; both pass the vectors in `spec/lottery/vectors/`.

## Quick start

```
uv run d2-lottery pool-root --pool pool.json                       # {"root": ..., "size": ...}
uv run d2-lottery commit --pool pool.json --purpose review-panel --context matter-42 \
    --size 5 --tier local > commitment.json                         # quicknet, first round >= 1 h away
# log commitment.json to Record as draw.commit, then wait for the round
uv run d2-lottery draw --commitment commitment.json --pool pool.json > transcript.json
uv run d2-lottery verify --transcript transcript.json               # ok: 5 selected from ... + warning
uv run d2-lottery panel --transcript transcript.json --declined <nym>  # verifies first; "anchored": false
uv run d2-lottery prove-member --pool pool.json --nym <nym>         # a member checks it was counted
```

`pool.json` is a list of `{"nym": ..., "strata": {"age": "18-34", ...}}`. Stratify with `--stratify-by age --quota 18-34=2 --quota 35-54=2 --quota 55-plus=1`. `--tier` checks the size against Charter's `tiers.<tier>.review_panel` (read through `d2_charter`). `draw` fetches the beacon from `api.drand.sh` (or `--drand-url`) unless `--beacon` is given, and verifies it either way.

## How it works

- **Pool:** RFC 9162 Merkle root over the members in pseudonym order; each leaf carries the pseudonym and its strata.
- **Commitment:** a line-based text naming the pool root and size, the drand chain and round, the panel size and the quotas. Its SHA-256 is the commitment hash.
- **Beacon:** verified in full: BLS12-381 signature under the chain's key (via `py_ecc`), and randomness = SHA-256(signature). Only the League of Entropy mainnet chains (quicknet, default) are trusted unless another is passed explicitly.
- **Draw:** SHA-256 counter-mode stream seeded by the commitment hash and the randomness; uniform indices by rejection sampling; a Fisher–Yates shuffle per stratum. The first `quota` of each stratum's order are selected, the rest are its replacements in order.
- **Declines:** the panel is the first `quota` non-declined entries per stratum, so replacements come from the same committed order and the result does not depend on the order declines arrive in.

## Library

```python
from d2_lottery import KNOWN_CHAINS, DrandClient, Pool, build, commit, panel, verify

pool = Pool(members)
chain = KNOWN_CHAINS["quicknet"]
c = commit(pool, purpose="review", context="m-42", size=5, committed_at=now, chain=chain)
beacon = DrandClient(chain, fetch=my_fetch).beacon(c.round)  # fetch(url) -> bytes, injectable
transcript = build(c, pool, chain, beacon)
verify(transcript)
```

## Not yet

- HTTP API (`POST /draws`, `GET /draws/{id}`, accept/decline) and writing `draw.commit` / `draw.result` to Record.
- Record anchoring in verification (spec section 7, step 0): until a transcript cites its `draw.commit` entry, `committed_at` is self-declared and a backdated commitment cannot be detected.
- LEXIMIN distributions for quotas over several attributes (v1 stratifies on one attribute).
- A recorded mainnet quicknet beacon in the fixtures (the quicknet scheme is tested with drand's walkthrough test chain).
