"""Client-side checks: an entry is in a signed checkpoint; one checkpoint extends another."""

from __future__ import annotations

import base64

from . import merkle
from .entry import Entry, EntryError
from .note import Checkpoint, Verifier


class VerifyError(ValueError):
    pass


def _hashes(items: object) -> list[bytes]:
    if not isinstance(items, list):
        raise VerifyError("proof must be a list")
    return [base64.b64decode(h, validate=True) for h in items]


def _checkpoint(note: str, verifier: Verifier) -> Checkpoint:
    try:
        return Checkpoint.verify(note, verifier)
    except ValueError as exc:
        raise VerifyError(f"checkpoint: {exc}") from exc


def check_inclusion(note: str, verifier: Verifier, entry: dict, proof: dict) -> Checkpoint:
    """Raise VerifyError unless `entry` (signature included) is at proof['seq'] in `note`."""
    cp = _checkpoint(note, verifier)
    try:
        parsed = Entry.from_dict(entry)
        parsed.check(None)
    except EntryError as exc:
        raise VerifyError(f"entry: {exc}") from exc
    if proof.get("size") != cp.size:
        raise VerifyError(f"proof is for size {proof.get('size')}, checkpoint is {cp.size}")
    if "leaf_hash" in proof and base64.b64decode(proof["leaf_hash"]) != parsed.leaf_hash():
        raise VerifyError("leaf hash in proof does not match the entry")
    seq = proof.get("seq")
    if not isinstance(seq, int):
        raise VerifyError("proof has no seq")
    if not merkle.verify_inclusion(
        seq, cp.size, parsed.leaf_hash(), _hashes(proof["proof"]), cp.root
    ):
        raise VerifyError("inclusion proof does not lead to the checkpoint root")
    return cp


def check_consistency(old_note: str, new_note: str, verifier: Verifier, proof: dict) -> None:
    old, new = _checkpoint(old_note, verifier), _checkpoint(new_note, verifier)
    if old.origin != new.origin:
        raise VerifyError("checkpoints are from different logs")
    if (proof.get("from"), proof.get("to")) != (old.size, new.size):
        raise VerifyError("proof sizes do not match the checkpoints")
    if not merkle.verify_consistency(
        old.size, new.size, old.root, new.root, _hashes(proof["proof"])
    ):
        raise VerifyError("consistency proof does not hold")
