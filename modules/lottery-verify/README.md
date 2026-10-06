# lottery-verify

Independent verifier for Lottery draws. Give it a published transcript (pool, commitment, drand beacon) and it recomputes the pool root, checks the beacon's BLS signature, reruns the draw and compares the panel. Exit 0 when the draw reproduces, 1 otherwise.

Written from [`spec/lottery/README.md`](../../spec/lottery/README.md) alone; it shares no code with [`modules/lottery`](../lottery) (Python, `py_ecc`). BLS12-381 comes from [`@noble/curves`](https://github.com/paulmillr/noble-curves).

```
npm run verify -w @democracy2/lottery-verify -- --transcript transcript.json
npm run verify -w @democracy2/lottery-verify -- --transcript inputs.json --fetch     # no beacon: fetch the committed round from api.drand.sh
npm run verify -w @democracy2/lottery-verify -- --transcript t.json --declined <nym>  # the panel after declines
npm run verify -w @democracy2/lottery-verify -- member --root <hex> --size <n> --proof proof.json
```

Every success ends with `warning: commit time not anchored to Record; a backdated commitment cannot be detected`: transcripts do not yet cite their Record `draw.commit` entry (spec section 7, step 0). Input must be canonical (spec section 7, "Strict input"); numbers like `2634945.0` are rejected.

Only the League of Entropy mainnet chains are trusted; `--chain-info <file>` adds another (the tests use drand's walkthrough test chain this way).
