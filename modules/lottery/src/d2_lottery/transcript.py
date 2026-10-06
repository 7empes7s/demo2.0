"""The published record of a draw, and the check anyone can run on it (spec section 6)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .drand import KNOWN_CHAIN_HASHES, Beacon, BeaconError, ChainInfo, verify_beacon
from .draw import Commitment, DrawError, run_draw
from .pool import Pool, PoolError

# Spec section 7, step 0. Until transcripts cite their Record draw.commit entry, `committed_at`
# is self-declared, so every successful verification says so.
UNANCHORED_WARNING = (
    "warning: commit time not anchored to Record; a backdated commitment cannot be detected"
)


def build(commitment: Commitment, pool: Pool, chain: ChainInfo, beacon: Beacon) -> dict[str, Any]:
    """Verify the beacon, run the draw, and return the transcript to publish."""
    commitment.check_chain(chain)
    randomness = verify_beacon(chain, beacon, commitment.round)
    return {
        "commitment": commitment.to_dict(),
        "pool": pool.to_list(),
        "chain_info": chain.to_dict(),
        "beacon": beacon.to_dict(),
        "result": run_draw(commitment, pool, randomness),
    }


def verify(transcript: Mapping[str, Any], trusted_chains: Mapping[str, ChainInfo] | None = None):
    """Recompute everything from the commitment, pool and beacon; raise DrawError on mismatch.

    `trusted_chains` maps chain hash to chain info. It defaults to the League of Entropy mainnet
    chains: a draw seeded from any other chain is rejected, since its operator could sign it.
    Returns the recomputed result.
    """
    trusted = KNOWN_CHAIN_HASHES if trusted_chains is None else trusted_chains
    try:
        commitment = Commitment.from_dict(transcript["commitment"])
        pool = Pool(transcript["pool"])
        beacon = Beacon.from_dict(transcript["beacon"])
        chain = trusted.get(commitment.chain)
        if chain is None:
            raise DrawError(f"chain {commitment.chain} is not a trusted drand chain")
        if "chain_info" in transcript and not chain.matches(transcript["chain_info"]):
            raise DrawError("chain_info differs from the trusted chain")
        commitment.check_chain(chain)
        randomness = verify_beacon(chain, beacon, commitment.round)
        result = run_draw(commitment, pool, randomness)
    except (PoolError, BeaconError, KeyError, TypeError) as exc:
        raise DrawError(str(exc)) from exc
    if "result" in transcript and transcript["result"] != result:
        raise DrawError("published result differs from the recomputed draw")
    return result
