# Record

An append-only public log. Anyone can prove an entry was published, prove the log never rewrote its history, and check the log's signed state against a Bitcoin timestamp. Entries carry hashes only, never payloads, so a payload can be erased without breaking the log.

The format is specified in [`spec/record/README.md`](../../spec/record/README.md). [`modules/record-verify`](../record-verify) is an independent verifier in TypeScript, written from that spec alone; both pass the same vectors in `spec/record/vectors/`.

## Quick start

```
uv run d2-record keygen --name example.org/log --out log.key        # mode 600, never commit it
uv run d2-record keygen --name example.org/council --out council.key
uv run d2-record sign-entry --key council.key --type matter.created \
    --payload-hash sha256:<hex> --payload-uri https://example.org/m/1 > entry.json
uv run d2-record append --db log.db --entry entry.json               # {"seq": 0, "leaf_hash": ...}
uv run d2-record checkpoint --db log.db --key log.key > cp.txt
uv run d2-record prove-inclusion --db log.db --seq 0 > proof.json
uv run d2-record verify-inclusion --vkey "$(uv run d2-record vkey --key log.key)" \
    --checkpoint cp.txt --entry entry.json --proof proof.json
uv run d2-record serve --db log.db --key log.key --port 8080
```

`d2-record <command> --help` lists every option. Entry types come from `spec/record-types.json` (`--types` or `$D2_RECORD_TYPES` when the module is installed outside this repo).

## HTTP API

| Request | Response |
|---|---|
| `POST /entries` `{type, payload_hash, payload_uri, signer, signature}` | `201 {seq, leaf_hash}`; `400` if the body or `Content-Length` is malformed, the type is unknown, a field is malformed or the signature fails; `411` without `Content-Length`; `413` over 16 KiB; `503` on a storage error |
| `GET /entries/<seq>` | The entry |
| `GET /checkpoint` | The latest signed checkpoint (`text/plain` signed note); signs a new one first if the tree has grown |
| `GET /proof/inclusion?seq=&size=` | `{seq, size, leaf_hash, proof}` |
| `GET /proof/consistency?from=&to=` | `{from, to, proof}` |
| `GET /anchor?size=` | The OpenTimestamps receipt for the checkpoint at that size |
| `GET /healthz` | `{ok, size}` |

Hashes are standard base64. The server is the Python standard library's threaded HTTP server; one lock serializes writes in the process. Other processes (for example `d2-record append --db` on the live file) may append too: SQLite's write lock serializes them, and each append, checkpoint and `/healthz` re-reads the tree size from the database first.

## How it works

- **Tree:** RFC 9162 (RFC 6962) Merkle tree over SHA-256, leaf hash `SHA-256(0x00 || leaf)`, node hash `SHA-256(0x01 || left || right)`.
- **Storage:** one SQLite file (WAL, `synchronous=FULL`: an append is fsynced before it returns, so a power loss cannot undo entries that a signed checkpoint covers). `entries` holds the five entry fields; `nodes` holds every perfect, aligned subtree hash, keyed by (level, index), with the leaf hashes at level 0. `checkpoints` and `anchors` hold signed notes and `.ots` receipts.
- **Appends are O(log n):** an append writes the leaf plus one node per trailing 1-bit of its index (2 rows on average, at most log2 n + 1) and reads nothing: the right edge of the tree (one subtree per set bit of the size) is kept in memory. Batches are one transaction, all or nothing.
- **Proofs** read O(log n) stored subtree hashes for any tree size up to the current one, so old checkpoints stay provable.
- **Checkpoints** are C2SP signed notes with Ed25519 (`cryptography`): origin, tree size, base64 root, and a `timestamp <unix seconds>` extension line. Keys use the signed-note encodings (`PRIVATE+KEY+...` and `<name>+<id>+<key>`).

## Anchoring

```
uv run d2-record anchor --db log.db --out cp.ots              # submit the latest checkpoint
uv run d2-record upgrade-anchor --db log.db --out cp.ots      # a few hours later: fetch the Bitcoin path
uv run d2-record verify-anchor --checkpoint cp.txt --ots cp.ots --vkey <log key>
```

`anchor` submits `SHA-256(signed checkpoint note)` to the public OpenTimestamps calendars (`--calendar` to choose, repeatable) and stores the receipt in the log database. `upgrade-anchor` asks the calendars named in the receipt (only those in the allowed list) for the finished path. `verify-anchor` checks the receipt is for that checkpoint, walks it, and checks each Bitcoin attestation against the block's Merkle root from an Esplora API (`--esplora`, default blockstream.info; `--offline` to skip). It exits 0 when verified on Bitcoin, 3 when the receipt is valid but still pending, and 1 when anything is wrong. Receipts are standard detached `.ots` files over the checkpoint text, readable by the reference `ots` client.

The proof format is implemented here without dependencies; a round trip against the reference `opentimestamps` Python library (parse its receipts, and it parses ours, byte-identical) was checked by hand. Tests use a local fake calendar and a fake block explorer; there are no network tests.

## Benchmark

`uv run python modules/record/bench/bench_1m.py --n 1000000 --workdir <dir>` (a script, not a test).

Run once on 2026-10-05 in a cloud session (4 vCPU sandbox, Python 3.11, Node 22.22, one process):

| Step | Result |
|---|---|
| Sign 1,000,000 entries (client side, Ed25519) | 107.7 s |
| Append 1,000,000 entries, signature checked on each, batches of 10,000 | 132.7 s (7,539 appends/s; measured with `synchronous=NORMAL`, FULL adds one fsync per batch) |
| Wall time per 100,000 entries, first to last tenth | 24.6, 23.2, 23.7, 23.1, 23.8, 25.0, 24.4, 24.6, 23.6, 24.2 s (flat: no slowdown as the tree grows) |
| Database size | 406.5 MB |
| Build a proof (1,000 inclusion + 1,000 consistency, size 1,000,000) | 0.11 ms each; inclusion proofs average 20 hashes |
| Check them in Python (checkpoint signature, entry signature, proof) | 0.32 ms each |
| Check them in the TypeScript verifier (`--json` batch, Node start-up excluded) | 0.51 ms each; `ok: all 2000 cases hold` |

## Not done yet

- **Tiles** (`GET /tiles/...`, C2SP `tlog-tiles`) so mirrors can serve the log as static files. The `nodes` table already holds every tile hash.
- **Witnesses** (C2SP `tlog-witness`) co-signing checkpoints.
- **Signer roles:** `spec/record-types.json` lists types but not yet the keys allowed to sign each, so any valid signature is accepted for a known type. `charter.change` does not yet require a Booth tally proof.
- **Hourly anchoring** on a timer, and the first anchor verified against a real Bitcoin block (this sandbox cannot reach the calendars).
- **Operations:** no auth or rate limit on `POST /entries`; not deployed.

Licence: Apache-2.0.
