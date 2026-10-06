"""Lottery: verifiable sortition. Commit to a pool and a future drand round, then draw.

Spec: spec/lottery/README.md. A third party reproduces any draw from the published
transcript (pool, commitment, beacon) with `d2-lottery verify` or `lottery-verify`.
"""

from .drand import (
    KNOWN_CHAINS,
    Beacon,
    BeaconError,
    ChainInfo,
    DrandClient,
    verify_beacon,
)
from .draw import (
    MIN_SEED_DELAY_SECONDS,
    Commitment,
    DrawError,
    Stream,
    commit,
    panel,
    panel_size_range,
    run_draw,
    seed,
)
from .pool import Member, Pool, PoolError, check_inclusion
from .transcript import build, verify

__all__ = [
    "KNOWN_CHAINS",
    "MIN_SEED_DELAY_SECONDS",
    "Beacon",
    "BeaconError",
    "ChainInfo",
    "Commitment",
    "DrandClient",
    "DrawError",
    "Member",
    "Pool",
    "PoolError",
    "Stream",
    "build",
    "check_inclusion",
    "commit",
    "panel",
    "panel_size_range",
    "run_draw",
    "seed",
    "verify",
    "verify_beacon",
]
