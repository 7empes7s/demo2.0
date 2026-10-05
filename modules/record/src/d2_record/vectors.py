"""Build the shared test vectors in spec/record/vectors/d2-log.json.

    uv run python -m d2_record.vectors --out spec/record/vectors/d2-log.json

Everything is deterministic (fixed seeds, fixed timestamps; Ed25519 signing is deterministic),
so the file only changes when the formats change. The keys below are public test keys.
"""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
from pathlib import Path

from .entry import sign_entry
from .merkle import MemoryTree, consistency_proof, inclusion_proof, root
from .note import Checkpoint, Signer

LOG_KEY = Signer("example.org/d2-record-test", hashlib.sha256(b"d2 test log key").digest())
OTHER_KEY = Signer("example.org/d2-record-test", hashlib.sha256(b"d2 other key").digest())
ENTRY_KEY = Signer("example.org/d2-test-signer", hashlib.sha256(b"d2 test entry key").digest())
TYPES = ("matter.created", "briefing.published", "round.tally", "spend", "wall.entry")
SIZE = 13
T0 = 1_790_000_000


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def _flip(b64: str) -> str:
    raw = bytearray(base64.b64decode(b64))
    raw[0] ^= 1
    return _b64(bytes(raw))


def build() -> dict:
    entries = []
    for i in range(SIZE):
        payload = f"test payload {i}".encode()
        entry = sign_entry(
            ENTRY_KEY,
            TYPES[i % len(TYPES)],
            "sha256:" + hashlib.sha256(payload).hexdigest(),
            f"https://example.org/payloads/{i}",
        )
        entries.append(entry)
    tree = MemoryTree()
    for e in entries:
        tree.append(e.leaf_hash())
    checkpoints = {
        str(n): Checkpoint(LOG_KEY.name, n, root(tree.subtree, n), T0 + n).sign(LOG_KEY)
        for n in range(1, SIZE + 1)
    }
    inclusion = [
        {
            "seq": i,
            "size": n,
            "leaf_hash": _b64(tree.subtree(0, i)),
            "proof": [_b64(p) for p in inclusion_proof(tree.subtree, i, n)],
        }
        for n in range(1, SIZE + 1)
        for i in range(n)
    ]
    consistency = [
        {"from": m, "to": n, "proof": [_b64(p) for p in consistency_proof(tree.subtree, m, n)]}
        for n in range(1, SIZE + 1)
        for m in range(1, n + 1)
    ]

    def inc(seq: int, size: int) -> dict:
        proof = next(p for p in inclusion if p["seq"] == seq and p["size"] == size)
        return {
            "kind": "inclusion",
            "checkpoint": checkpoints[str(size)],
            "entry": entries[seq].to_dict(),
            "proof": copy.deepcopy(proof),
        }

    def con(m: int, n: int) -> dict:
        proof = next(p for p in consistency if p["from"] == m and p["to"] == n)
        return {
            "kind": "consistency",
            "old": checkpoints[str(m)],
            "new": checkpoints[str(n)],
            "proof": copy.deepcopy(proof),
        }

    invalid = []

    def bad(reason: str, case: dict) -> None:
        invalid.append({"reason": reason, **case})

    c = inc(5, 13)
    c["proof"]["proof"][1] = _flip(c["proof"]["proof"][1])
    bad("a proof hash is altered", c)
    c = inc(5, 13)
    c["proof"]["seq"] = 6
    c["proof"].pop("leaf_hash")
    bad("the proof is claimed for another position", c)
    c = inc(5, 13)
    c["proof"]["proof"].append(c["proof"]["proof"][0])
    bad("the proof has an extra hash", c)
    c = inc(12, 13)
    c["proof"]["proof"].pop()
    bad("the proof is missing a hash", c)
    c = inc(3, 8)
    c["entry"]["payload_uri"] = "https://example.org/payloads/other"
    c["proof"].pop("leaf_hash")
    bad("the entry was edited after signing", c)
    c = inc(3, 8)
    c["entry"]["payload_hash"] = "sha256:" + "00" * 32
    c["proof"].pop("leaf_hash")
    bad("the entry's payload hash was swapped", c)
    c = inc(3, 8)
    c["checkpoint"] = Checkpoint.verify(checkpoints["8"], LOG_KEY.verifier).sign(OTHER_KEY)
    bad("the checkpoint is signed by another key with the same name", c)
    c = inc(3, 8)
    c["checkpoint"] = c["checkpoint"].replace("\n8\n", "\n9\n", 1)
    c["proof"]["size"] = 9
    bad("the checkpoint body was edited after signing", c)
    c = inc(3, 8)
    c["checkpoint"] = checkpoints["9"]
    bad("the proof is for another tree size", c)
    c = con(6, 13)
    c["proof"]["proof"][0] = _flip(c["proof"]["proof"][0])
    bad("a consistency hash is altered", c)
    c = con(6, 13)
    c["proof"]["proof"].pop()
    bad("the consistency proof is missing a hash", c)
    c = con(4, 13)
    c["proof"]["proof"].insert(0, c["proof"]["proof"][0])
    bad("the consistency proof has an extra hash", c)
    c = con(5, 9)
    c["old"], c["new"] = c["new"], c["old"]
    bad("old and new checkpoints are swapped", c)
    c = con(7, 13)
    c["new"] = checkpoints["12"]
    bad("the new checkpoint does not match the proof", c)

    return {
        "description": (
            "Record log vectors: entries, signed checkpoints (C2SP signed-note), inclusion and "
            "consistency proofs in the HTTP API format, and cases that must fail. Hashes are "
            "standard base64. Generated by `python -m d2_record.vectors`; test keys are public."
        ),
        "vkey": LOG_KEY.verifier.encode(),
        "entries": [e.to_dict() for e in entries],
        "leaf_data_0": entries[0].leaf_data().decode(),
        "checkpoints": checkpoints,
        "inclusion": inclusion,
        "consistency": consistency,
        "invalid": invalid,
    }


def render() -> str:
    return json.dumps(build(), indent=1, ensure_ascii=False) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    Path(parser.parse_args().out).write_text(render(), encoding="utf-8")


if __name__ == "__main__":
    main()
