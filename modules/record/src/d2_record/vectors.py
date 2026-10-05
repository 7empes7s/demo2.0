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

from .entry import Entry, sign_entry
from .merkle import MemoryTree, consistency_proof, inclusion_proof, root
from .note import SIG_PREFIX, Checkpoint, Signer, sign_note

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

    # A fork: a properly signed checkpoint of the same size over a different tree, so the
    # sizes match and only the RFC 9162 consistency check can catch it.
    fork = MemoryTree()
    for i, e in enumerate(entries):
        fork.append(entries[0].leaf_hash() if i == 10 else e.leaf_hash())
    c = con(6, 13)
    c["new"] = Checkpoint(LOG_KEY.name, SIZE, root(fork.subtree, SIZE), T0 + SIZE).sign(LOG_KEY)
    bad("the new checkpoint is a fork of the same size", c)

    # Signed-note and checkpoint encoding. Each note is otherwise valid for inc(3, 8).
    body8 = Checkpoint.verify(checkpoints["8"], LOG_KEY.verifier).body()
    sig_line = checkpoints["8"][len(body8) + 1 :]
    sig_name, sig_b64 = sig_line[len(SIG_PREFIX) : -1].split(" ")
    short = _b64(base64.b64decode(sig_b64)[:-4])
    for reason, note in (
        ("the checkpoint is not signed", body8),
        ("the checkpoint has an empty signature block", body8 + "\n"),
        ("a signature line has the wrong prefix", body8 + "\n- " + sig_line[len(SIG_PREFIX) :]),
        ("a signature line has no space", body8 + "\n" + SIG_PREFIX + sig_name + sig_b64 + "\n"),
        ("the signature is truncated", body8 + "\n" + SIG_PREFIX + sig_name + " " + short + "\n"),
        ("the tree size has a leading zero", sign_note(body8.replace("\n8\n", "\n08\n"), LOG_KEY)),
        ("the checkpoint has no timestamp", sign_note(body8.rsplit("timestamp", 1)[0], LOG_KEY)),
        ("the checkpoint origin is not the key name", sign_note("x" + body8, LOG_KEY)),
    ):
        c = inc(3, 8)
        c["checkpoint"] = note
        bad(reason, c)

    # Entries that are signed and really in the tree, but not in canonical form. Each sits
    # alone in a properly signed one-entry tree, so only the entry checks can reject it.
    def alone(entry: Entry) -> dict:
        note = Checkpoint(LOG_KEY.name, 1, entry.leaf_hash(), T0).sign(LOG_KEY)
        proof = {"seq": 0, "size": 1, "leaf_hash": _b64(entry.leaf_hash()), "proof": []}
        return {"kind": "inclusion", "checkpoint": note, "entry": entry.to_dict(), "proof": proof}

    good = entries[0]
    vkey = ENTRY_KEY.verifier.encode()
    kid = ENTRY_KEY.verifier.id.hex()
    for reason, entry in (
        (
            "the payload hash ends in a newline",
            sign_entry(ENTRY_KEY, good.type, good.payload_hash + "\n", good.payload_uri),
        ),
        (
            "the payload URI ends in a newline",
            sign_entry(ENTRY_KEY, good.type, good.payload_hash, good.payload_uri + "\n"),
        ),
        ("the entry type is empty", sign_entry(ENTRY_KEY, "", good.payload_hash, good.payload_uri)),
        (
            "the entry type has a space",
            sign_entry(ENTRY_KEY, "matter created", good.payload_hash, good.payload_uri),
        ),
        (
            "the signer key has surrounding whitespace",
            Entry(**{**good.to_dict(), "signer": " " + vkey + "\n"}),
        ),
        (
            "the signer key id is upper case",
            Entry(**{**good.to_dict(), "signer": vkey.replace(kid, kid.upper())}),
        ),
    ):
        bad(reason, alone(entry))

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
