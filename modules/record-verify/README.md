# Record verifier

An independent check of Record's proofs, in a different language from the log itself. It was written from [`spec/record/README.md`](../../spec/record/README.md) alone and shares no code with `modules/record`. It needs only Node 22 (no dependencies at runtime).

```
node --experimental-strip-types src/cli.ts inclusion   --vkey <key or file> --checkpoint cp.txt --entry entry.json --proof proof.json
node --experimental-strip-types src/cli.ts consistency --vkey <key or file> --old old.txt --new new.txt --proof proof.json
node --experimental-strip-types src/cli.ts --json case.json --vkey <key or file>
```

It exits 0 when the proof holds and 1 otherwise, printing `ok: ...` or `fail: <reason>`.

| Check | What it proves |
|---|---|
| `inclusion` | The checkpoint is signed by the log's key; the entry's own Ed25519 signature verifies; the entry is the leaf at `seq` of the tree the checkpoint commits to (RFC 9162 section 2.1.3.2) |
| `consistency` | Both checkpoints are signed by the log's key and come from the same log; the newer tree contains the older one unchanged (RFC 9162 section 2.1.4.2) |

`--json` takes one case, `{"kind": "inclusion", "checkpoint", "entry", "proof"}` or `{"kind": "consistency", "old", "new", "proof"}`, or a batch `{"cases": [...]}` where every case must hold and there is at least one. The log key always comes from `--vkey`: a proof bundle cannot vouch for itself, so a `vkey` field inside the input is never used, and if one is present it must be the same key. The `ok:` line names the key that was used. Proofs are the JSON that Record's `GET /proof/...` endpoints return.

Tests run the RFC 6962 reference vectors and the Record vectors in `spec/record/vectors/`, including 29 cases that must fail.

Licence: Apache-2.0.
