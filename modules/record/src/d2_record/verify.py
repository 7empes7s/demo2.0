"""Client-side checks: an entry is in a signed checkpoint; one checkpoint extends another."""

from __future__ import annotations

import base64

from . import merkle
from .entry import Entry, EntryError
from .note import Checkpoint, Verifier


class VerifyError(ValueError):
    pass


def _b64(value: object, what: str) -> bytes:
    if not isinstance(value, str):
        raise VerifyError(f"{what} must be a base64 string")
    try:
        return base64.b64decode(value, validate=True)
    except ValueError as exc:
        raise VerifyError(f"{what} is not standard base64") from exc


def _hashes(items: object) -> list[bytes]:
    if not isinstance(items, list):
        raise VerifyError("proof hashes must be a list")
    return [_b64(h, f"proof hash {i}") for i, h in enumerate(items)]


def _count(value: object, what: str) -> int:
    # JSON true/false are ints in Python; the spec's counts are numbers only.
    if type(value) is not int or value < 0:
        raise VerifyError(f"{what} must be a whole number")
    return value


def _proof(proof: object) -> dict:
    if not isinstance(proof, dict):
        raise VerifyError("proof must be a JSON object")
    return proof


def _checkpoint(note: str, verifier: Verifier) -> Checkpoint:
    try:
        return Checkpoint.verify(note, verifier)
    except ValueError as exc:
        raise VerifyError(f"checkpoint: {exc}") from exc


def check_inclusion(note: str, verifier: Verifier, entry: object, proof: object) -> Checkpoint:
    """Raise VerifyError unless `entry` (signature included) is at proof['seq'] in `note`."""
    cp = _checkpoint(note, verifier)
    try:
        parsed = Entry.from_dict(entry)
        parsed.check(None)
    except EntryError as exc:
        raise VerifyError(f"entry: {exc}") from exc
    proof = _proof(proof)
    size = _count(proof.get("size"), "proof size")
    if size != cp.size:
        raise VerifyError(f"proof is for size {size}, checkpoint is {cp.size}")
    seq = _count(proof.get("seq"), "proof seq")
    if "leaf_hash" in proof and _b64(proof["leaf_hash"], "leaf_hash") != parsed.leaf_hash():
        raise VerifyError("leaf hash in proof does not match the entry")
    if not merkle.verify_inclusion(
        seq, cp.size, parsed.leaf_hash(), _hashes(proof.get("proof")), cp.root
    ):
        raise VerifyError("inclusion proof does not lead to the checkpoint root")
    return cp


def check_consistency(old_note: str, new_note: str, verifier: Verifier, proof: object) -> None:
    old, new = _checkpoint(old_note, verifier), _checkpoint(new_note, verifier)
    if old.origin != new.origin:
        raise VerifyError("checkpoints are from different logs")
    proof = _proof(proof)
    sizes = (_count(proof.get("from"), "proof from"), _count(proof.get("to"), "proof to"))
    if sizes != (old.size, new.size):
        raise VerifyError("proof sizes do not match the checkpoints")
    if not merkle.verify_consistency(
        old.size, new.size, old.root, new.root, _hashes(proof.get("proof"))
    ):
        raise VerifyError("consistency proof does not hold")
