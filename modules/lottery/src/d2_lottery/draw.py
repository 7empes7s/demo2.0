"""Commit to a draw, then run it from a verified drand beacon. Spec: spec/lottery/README.md.

pool = Pool(members)
c = commit(pool, purpose="review", context="matter-42", size=5, committed_at=now,
           chain=KNOWN_CHAINS["quicknet"], tier="local")
# log c.text() to Record as draw.commit, wait for c.round, fetch and verify the beacon
result = run_draw(c, pool, randomness)
panel(result, declined={"nym-x"})  # replacements come from the same order
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from .drand import ChainInfo
from .pool import TOKEN, Pool

VERSION = "d2.lottery.draw/1"
SEED_TAG = b"d2.lottery.seed/1\n"
STREAM_TAG = b"d2.lottery.stream/1\n"
# docs/architecture/02-protocols.md section 5: the seed round comes at least an hour after commit.
MIN_SEED_DELAY_SECONDS = 3600
LABEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
HEX32 = re.compile(r"[0-9a-f]{64}")


class DrawError(ValueError):
    """A commitment or draw is malformed, inconsistent, or does not reproduce."""


def _uint(value: Any, what: str, minimum: int = 0) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise DrawError(f"{what} must be an integer >= {minimum}")
    return value


def _match(pattern: re.Pattern[str], value: Any, what: str) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise DrawError(f"bad {what} {value!r}")
    return value


@dataclass(frozen=True)
class Commitment:
    """Everything fixed before the seed exists. `text()` is what gets hashed and logged."""

    purpose: str
    context: str
    committed_at: int
    pool_root: str
    pool_size: int
    chain: str
    scheme: str
    round: int
    size: int
    stratify_by: str | None = None
    quotas: Mapping[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _match(LABEL, self.purpose, "purpose")
        _match(LABEL, self.context, "context")
        _uint(self.committed_at, "committed_at")
        _match(HEX32, self.pool_root, "pool_root")
        _uint(self.pool_size, "pool_size", 1)
        _match(HEX32, self.chain, "chain")
        _match(TOKEN, self.scheme, "scheme")
        _uint(self.round, "round", 1)
        _uint(self.size, "size", 1)
        if self.size > self.pool_size:
            raise DrawError(f"panel size {self.size} exceeds pool size {self.pool_size}")
        if not isinstance(self.quotas, Mapping):
            raise DrawError("quotas must be an object")
        if self.stratify_by is None:
            if self.quotas:
                raise DrawError("quotas need stratify_by")
        else:
            _match(TOKEN, self.stratify_by, "stratify_by")
            if not self.quotas:
                raise DrawError("stratify_by needs quotas")
            for value, n in self.quotas.items():
                _match(TOKEN, value, "stratum value")
                _uint(n, f"quota for {value}")
            if sum(self.quotas.values()) != self.size:
                raise DrawError(f"quotas sum to {sum(self.quotas.values())}, size is {self.size}")
        object.__setattr__(self, "quotas", dict(sorted(self.quotas.items())))

    @classmethod
    def from_dict(cls, raw: Any) -> Commitment:
        if not isinstance(raw, Mapping):
            raise DrawError("a commitment is an object")
        known = {f for f in cls.__dataclass_fields__}
        if set(raw) - known - {"version"}:
            raise DrawError(f"unknown commitment fields {sorted(set(raw) - known)}")
        if raw.get("version", VERSION) != VERSION:
            raise DrawError(f"unsupported version {raw.get('version')!r}")
        try:
            return cls(**{k: v for k, v in raw.items() if k != "version"})
        except TypeError as exc:
            raise DrawError(f"malformed commitment: {exc}") from exc

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": VERSION,
            "purpose": self.purpose,
            "context": self.context,
            "committed_at": self.committed_at,
            "pool_root": self.pool_root,
            "pool_size": self.pool_size,
            "chain": self.chain,
            "scheme": self.scheme,
            "round": self.round,
            "size": self.size,
            "stratify_by": self.stratify_by,
            "quotas": dict(self.quotas),
        }

    def text(self) -> str:
        lines = [
            VERSION,
            f"purpose {self.purpose}",
            f"context {self.context}",
            f"committed-at {self.committed_at}",
            f"pool {self.pool_root}",
            f"pool-size {self.pool_size}",
            f"chain {self.chain}",
            f"scheme {self.scheme}",
            f"round {self.round}",
            f"size {self.size}",
            f"stratify-by {self.stratify_by or '-'}",
            *(f"quota {value} {n}" for value, n in self.quotas.items()),
        ]
        return "".join(line + "\n" for line in lines)

    def hash(self) -> bytes:
        return hashlib.sha256(self.text().encode("ascii")).digest()

    def check_chain(self, chain: ChainInfo) -> None:
        """The chain is the committed one and the round comes late enough to be unpredictable."""
        if chain.hash != self.chain or chain.scheme != self.scheme:
            raise DrawError("chain info does not match the committed chain and scheme")
        earliest = self.committed_at + MIN_SEED_DELAY_SECONDS
        if chain.round_time(self.round) < earliest:
            raise DrawError(
                f"round {self.round} is produced before committed_at + {MIN_SEED_DELAY_SECONDS}s"
            )

    def groups(self, pool: Pool) -> list[tuple[str | None, int, list[str]]]:
        """(stratum value, quota, nyms in canonical order) per stratum, strata in byte order."""
        if pool.root_hex != self.pool_root or len(pool) != self.pool_size:
            raise DrawError("pool does not match the committed root and size")
        if self.stratify_by is None:
            return [(None, self.size, [m.nym for m in pool.members])]
        by_value: dict[str, list[str]] = {}
        for m in pool.members:
            value = m.strata.get(self.stratify_by)
            if value is None:
                raise DrawError(f"{m.nym} has no {self.stratify_by}")
            if value not in self.quotas:
                raise DrawError(f"no quota for {self.stratify_by}={value}")
            by_value.setdefault(value, []).append(m.nym)
        out = []
        for value, quota in self.quotas.items():
            nyms = by_value.get(value, [])
            if not nyms:
                raise DrawError(f"quota for {self.stratify_by}={value} but nobody has it")
            if quota > len(nyms):
                raise DrawError(f"quota {quota} for {value} exceeds its {len(nyms)} members")
            out.append((value, quota, nyms))
        return out


def panel_size_range(tier: str) -> tuple[int, int]:
    """Charter's review panel size for a tier (tiers.<tier>.review_panel)."""
    from d2_charter import param

    raw = param(f"tiers.{tier}.review_panel")
    return raw["min"], raw["max"]


def commit(
    pool: Pool,
    *,
    purpose: str,
    context: str,
    size: int,
    committed_at: int,
    chain: ChainInfo,
    round: int | None = None,
    tier: str | None = None,
    stratify_by: str | None = None,
    quotas: Mapping[str, int] | None = None,
) -> Commitment:
    """Build a commitment. Without `round`, takes the first round at least an hour away."""
    if tier is not None:
        lo, hi = panel_size_range(tier)
        if not lo <= size <= hi:
            raise DrawError(f"a {tier} panel has {lo} to {hi} members, asked for {size}")
    if round is None:
        round = chain.first_round_at_or_after(committed_at + MIN_SEED_DELAY_SECONDS)
    c = Commitment(
        purpose=purpose,
        context=context,
        committed_at=committed_at,
        pool_root=pool.root_hex,
        pool_size=len(pool),
        chain=chain.hash,
        scheme=chain.scheme,
        round=round,
        size=size,
        stratify_by=stratify_by,
        quotas=dict(quotas or {}),
    )
    c.check_chain(chain)
    c.groups(pool)  # every quota is satisfiable before anything is logged
    return c


class Stream:
    """SHA-256 in counter mode: block i = SHA-256(STREAM_TAG || seed || uint64be(i))."""

    def __init__(self, seed: bytes) -> None:
        if len(seed) != 32:
            raise DrawError("seed must be 32 bytes")
        self._seed = seed
        self._counter = 0
        self._buf = b""

    def u64(self) -> int:
        if not self._buf:
            block = STREAM_TAG + self._seed + self._counter.to_bytes(8, "big")
            self._buf = hashlib.sha256(block).digest()
            self._counter += 1
        word, self._buf = self._buf[:8], self._buf[8:]
        return int.from_bytes(word, "big")

    def below(self, n: int) -> int:
        """Uniform integer in [0, n) by rejection sampling: no modulo bias."""
        if n < 1:
            raise DrawError("range must be at least 1")
        limit = (1 << 64) - ((1 << 64) % n)
        while True:
            x = self.u64()
            if x < limit:
                return x % n


def seed(commitment: Commitment, randomness: bytes) -> bytes:
    if len(randomness) != 32:
        raise DrawError("drand randomness must be 32 bytes")
    return hashlib.sha256(SEED_TAG + commitment.hash() + randomness).digest()


def run_draw(commitment: Commitment, pool: Pool, randomness: bytes) -> dict[str, Any]:
    """Shuffle every stratum with one stream; the first `quota` of each are the panel.

    The rest of each stratum's order is its replacement list, in order.
    """
    stream = Stream(seed(commitment, randomness))
    groups = []
    for value, quota, nyms in commitment.groups(pool):
        order = list(nyms)
        for i in range(len(order) - 1):
            j = i + stream.below(len(order) - i)
            order[i], order[j] = order[j], order[i]
        groups.append({"stratum": value, "quota": quota, "order": order})
    return {
        "commitment_hash": commitment.hash().hex(),
        "groups": groups,
        "selected": [nym for g in groups for nym in g["order"][: g["quota"]]],
    }


def panel(result: Mapping[str, Any], declined: Iterable[str] = ()) -> dict[str, Any]:
    """The panel after declines: per stratum, the first `quota` of its order nobody declined.

    The answer does not depend on the order declines arrive in. `short` counts seats a stratum
    cannot fill because its whole order declined.
    """
    out = set(declined)
    members, short = [], 0
    for g in result["groups"]:
        taken = [nym for nym in g["order"] if nym not in out][: g["quota"]]
        members.extend(taken)
        short += g["quota"] - len(taken)
    return {"members": members, "short": short}
