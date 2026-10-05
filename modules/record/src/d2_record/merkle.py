"""RFC 9162 (RFC 6962) Merkle tree hashing, proof generation and proof verification.

Proof generation works over any store that returns the hash of a perfect, aligned subtree:
`subtree(level, index)` is the root of leaves [index * 2**level, (index + 1) * 2**level).
Every range the RFC recursion asks for is either such a subtree or splits into them, so a
proof costs O(log n) stored hashes for the perfect parts plus O(log n) to fold the right edge.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Sequence

Subtree = Callable[[int, int], bytes]

HASH_SIZE = 32


def leaf_hash(data: bytes) -> bytes:
    return hashlib.sha256(b"\x00" + data).digest()


def node_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(b"\x01" + left + right).digest()


def empty_root() -> bytes:
    return hashlib.sha256(b"").digest()


def _split(n: int) -> int:
    """The largest power of two strictly less than n (n >= 2)."""
    return 1 << ((n - 1).bit_length() - 1)


def range_hash(subtree: Subtree, start: int, end: int) -> bytes:
    """MTH(D[start:end]) where every left part of the RFC split is a perfect aligned subtree."""
    n = end - start
    if n <= 0:
        raise ValueError("empty range")
    if n & (n - 1) == 0 and start % n == 0:
        level = n.bit_length() - 1
        return subtree(level, start >> level)
    k = _split(n)
    return node_hash(range_hash(subtree, start, start + k), range_hash(subtree, start + k, end))


def root(subtree: Subtree, size: int) -> bytes:
    return empty_root() if size == 0 else range_hash(subtree, 0, size)


def inclusion_proof(subtree: Subtree, index: int, size: int) -> list[bytes]:
    """RFC 9162 section 2.1.3.1 PATH(index, D[0:size])."""
    if not 0 <= index < size:
        raise ValueError(f"index {index} not in tree of size {size}")
    proof: list[bytes] = []
    start, end, m = 0, size, index
    while end - start > 1:
        k = _split(end - start)
        if m < k:
            proof.append(range_hash(subtree, start + k, end))
            end = start + k
        else:
            proof.append(range_hash(subtree, start, start + k))
            start, m = start + k, m - k
    proof.reverse()
    return proof


def consistency_proof(subtree: Subtree, old: int, new: int) -> list[bytes]:
    """RFC 9162 section 2.1.4.1 PROOF(old, D[0:new])."""
    if not 0 < old <= new:
        raise ValueError(f"need 0 < from <= to, got from={old} to={new}")
    if old == new:
        return []
    proof: list[bytes] = []
    start, end, m, complete = 0, new, old, True
    while True:
        n = end - start
        if m == n:
            if not complete:
                proof.append(range_hash(subtree, start, end))
            break
        k = _split(n)
        if m <= k:
            proof.append(range_hash(subtree, start + k, end))
            end = start + k
        else:
            proof.append(range_hash(subtree, start, start + k))
            start, m, complete = start + k, m - k, False
    proof.reverse()
    return proof


def root_from_inclusion(index: int, size: int, leaf: bytes, proof: Sequence[bytes]) -> bytes:
    """RFC 9162 section 2.1.3.2: the root implied by an inclusion proof, or ValueError."""
    if not 0 <= index < size:
        raise ValueError("index out of range")
    fn, sn, r = index, size - 1, leaf
    for p in proof:
        if len(p) != HASH_SIZE:
            raise ValueError("bad hash length")
        if sn == 0:
            raise ValueError("proof too long")
        if fn & 1 or fn == sn:
            r = node_hash(p, r)
            while not fn & 1 and fn != 0:
                fn >>= 1
                sn >>= 1
        else:
            r = node_hash(r, p)
        fn >>= 1
        sn >>= 1
    if sn != 0:
        raise ValueError("proof too short")
    return r


def verify_inclusion(
    index: int, size: int, leaf: bytes, proof: Sequence[bytes], root_: bytes
) -> bool:
    try:
        return root_from_inclusion(index, size, leaf, proof) == root_
    except ValueError:
        return False


def verify_consistency(
    old: int, new: int, old_root: bytes, new_root: bytes, proof: Sequence[bytes]
) -> bool:
    """RFC 9162 section 2.1.4.2."""
    if not 0 < old <= new:
        return False
    if old == new:
        return not proof and old_root == new_root
    path = list(proof)
    if any(len(p) != HASH_SIZE for p in path):
        return False
    if old & (old - 1) == 0:
        path.insert(0, old_root)
    if not path:
        return False
    fn, sn = old - 1, new - 1
    while fn & 1:
        fn >>= 1
        sn >>= 1
    fr = sr = path[0]
    for c in path[1:]:
        if sn == 0:
            return False
        if fn & 1 or fn == sn:
            fr = node_hash(c, fr)
            sr = node_hash(c, sr)
            while not fn & 1 and fn != 0:
                fn >>= 1
                sn >>= 1
        else:
            sr = node_hash(sr, c)
        fn >>= 1
        sn >>= 1
    return sn == 0 and fr == old_root and sr == new_root


class MemoryTree:
    """A list-backed tree with the same incremental node layout as the SQLite log (for tests)."""

    def __init__(self) -> None:
        self.levels: list[list[bytes]] = [[]]

    @property
    def size(self) -> int:
        return len(self.levels[0])

    def append(self, leaf: bytes) -> None:
        level, h = 0, leaf
        self.levels[0].append(h)
        idx = len(self.levels[0]) - 1
        while idx & 1:
            h = node_hash(self.levels[level][idx - 1], h)
            level, idx = level + 1, idx >> 1
            if len(self.levels) == level:
                self.levels.append([])
            self.levels[level].append(h)

    def subtree(self, level: int, index: int) -> bytes:
        return self.levels[level][index]
