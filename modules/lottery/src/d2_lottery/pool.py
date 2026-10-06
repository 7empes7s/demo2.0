"""The pool: the opted-in pseudonyms of a draw's context, committed as one Merkle root.

Format: spec/lottery/README.md section 2. The tree is RFC 9162 (the same hashing as Record),
implemented here so the module depends on spec only.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

NYM = re.compile(r"[A-Za-z0-9+/=_.:-]{1,256}")
TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}")
HASH = re.compile(r"[0-9a-f]{64}")
MEMBER_TAG = b"d2.lottery.member/1\n"


class PoolError(ValueError):
    """The pool, or a proof about it, is malformed or does not hold."""


def _int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _full(pattern: re.Pattern[str], value: Any) -> bool:
    return isinstance(value, str) and pattern.fullmatch(value) is not None


@dataclass(frozen=True)
class Member:
    nym: str
    strata: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not _full(NYM, self.nym):
            raise PoolError(f"bad pseudonym {self.nym!r}")
        if not isinstance(self.strata, Mapping):
            raise PoolError("strata must be an object")
        for key, value in self.strata.items():
            if not _full(TOKEN, key) or not _full(TOKEN, value):
                raise PoolError(f"bad stratum {key!r}={value!r} for {self.nym}")
        object.__setattr__(self, "strata", dict(sorted(self.strata.items())))

    @classmethod
    def from_dict(cls, raw: Any) -> Member:
        if not isinstance(raw, Mapping) or set(raw) - {"nym", "strata"} or "nym" not in raw:
            raise PoolError("a member is {nym, strata?}")
        return cls(raw["nym"], raw.get("strata", {}))

    def to_dict(self) -> dict[str, Any]:
        return {"nym": self.nym, "strata": dict(self.strata)}

    def leaf_data(self) -> bytes:
        lines = [f"{k}={v}\n" for k, v in self.strata.items()]
        return MEMBER_TAG + (self.nym + "\n" + "".join(lines)).encode("ascii")


def leaf_hash(data: bytes) -> bytes:
    return hashlib.sha256(b"\x00" + data).digest()


def node_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(b"\x01" + left + right).digest()


def _split(n: int) -> int:
    return 1 << ((n - 1).bit_length() - 1)


def _mth(leaves: list[bytes]) -> bytes:
    if len(leaves) == 1:
        return leaves[0]
    k = _split(len(leaves))
    return node_hash(_mth(leaves[:k]), _mth(leaves[k:]))


class Pool:
    """Members in canonical order: ascending by pseudonym (ASCII, so bytewise)."""

    def __init__(self, members: Iterable[Member | Mapping[str, Any]]) -> None:
        parsed = [m if isinstance(m, Member) else Member.from_dict(m) for m in members]
        parsed.sort(key=lambda m: m.nym)
        if not parsed:
            raise PoolError("the pool is empty")
        for a, b in zip(parsed, parsed[1:], strict=False):
            if a.nym == b.nym:
                raise PoolError(f"pseudonym {a.nym} appears twice")
        self.members: list[Member] = parsed
        self._leaves = [leaf_hash(m.leaf_data()) for m in parsed]
        self.root: bytes = _mth(self._leaves)

    def __len__(self) -> int:
        return len(self.members)

    @property
    def root_hex(self) -> str:
        return self.root.hex()

    def index(self, nym: str) -> int:
        for i, m in enumerate(self.members):
            if m.nym == nym:
                return i
        raise PoolError(f"{nym} is not in the pool")

    def inclusion_proof(self, nym: str) -> dict[str, Any]:
        """RFC 9162 PATH(index, D[0:n]) so a member can check its own pseudonym was counted."""
        index = self.index(nym)
        proof: list[str] = []
        leaves, m = self._leaves, index
        while len(leaves) > 1:
            k = _split(len(leaves))
            if m < k:
                proof.append(_mth(leaves[k:]).hex())
                leaves = leaves[:k]
            else:
                proof.append(_mth(leaves[:k]).hex())
                leaves, m = leaves[k:], m - k
        proof.reverse()
        member = self.members[index]
        return {"member": member.to_dict(), "index": index, "size": len(self), "proof": proof}

    def to_list(self) -> list[dict[str, Any]]:
        return [m.to_dict() for m in self.members]


def check_inclusion(root_hex: str, size: int, proof: Mapping[str, Any]) -> None:
    """RFC 9162 section 2.1.3.2. Raises PoolError unless the member is in the tree.

    `size` comes from the commitment: the root alone does not fix the tree size.
    """
    try:
        member = Member.from_dict(proof["member"])
        index, path = proof["index"], proof["proof"]
        if not isinstance(path, list) or not all(_full(HASH, h) for h in path):
            raise PoolError("proof hashes are 32 bytes of lowercase hex")
        hashes = [bytes.fromhex(h) for h in path]
    except (KeyError, TypeError) as exc:
        raise PoolError(f"malformed inclusion proof: {exc}") from exc
    if not _int(proof.get("size")) or proof["size"] != size:
        raise PoolError(f"proof is for a pool of {proof.get('size')}, the commitment says {size}")
    if not (_int(index) and _int(size) and 0 <= index < size):
        raise PoolError("index out of range")
    fn, sn, r = index, size - 1, leaf_hash(member.leaf_data())
    for p in hashes:
        if sn == 0:
            raise PoolError("proof too long")
        if fn & 1 or fn == sn:
            r = node_hash(p, r)
            if not fn & 1:
                while fn and not fn & 1:
                    fn >>= 1
                    sn >>= 1
        else:
            r = node_hash(r, p)
        fn >>= 1
        sn >>= 1
    if sn != 0 or r.hex() != root_hex:
        raise PoolError("member is not in the pool with that root")
