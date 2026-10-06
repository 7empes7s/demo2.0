"""d2-lottery: commit to a draw, run it, and verify a published one.

    d2-lottery pool-root --pool pool.json
    d2-lottery commit --pool pool.json --purpose review-panel --context matter-42 --size 5 \
        [--tier local] [--stratify-by age --quota 18-34=2 --quota 35-54=2 --quota 55-plus=1] \
        [--chain quicknet|default] [--round N] [--now UNIX] > commitment.json
    d2-lottery draw --commitment commitment.json --pool pool.json [--beacon beacon.json] \
        > transcript.json
    d2-lottery verify --transcript transcript.json [--chain-info walkthrough.json]
    d2-lottery panel --transcript transcript.json [--declined nym-a --declined nym-b] \
        [--chain-info walkthrough.json]
    d2-lottery prove-member --pool pool.json --nym nym-a

Without --beacon, `draw` fetches the round from api.drand.sh (or --drand-url) and verifies it.
`verify` and `panel` reproduce the draw first; `panel` refuses a transcript that does not verify.
Both warn that the commit time is not yet anchored to Record (spec section 7, step 0).
Exit codes: 0 ok, 1 the check failed, 2 bad usage.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from .drand import DEFAULT_URL, KNOWN_CHAINS, Beacon, BeaconError, ChainInfo, DrandClient
from .draw import Commitment, DrawError, commit, panel
from .pool import Pool, PoolError
from .transcript import UNANCHORED_WARNING, build, verify


def _read(path: str) -> Any:
    text = sys.stdin.read() if path == "-" else Path(path).read_text("utf-8")
    return json.loads(text)


def _chain_for(commitment: Commitment, extra: str | None) -> ChainInfo:
    chains = {c.hash: c for c in KNOWN_CHAINS.values()}
    if extra:
        info = ChainInfo.from_dict(_read(extra))
        chains[info.hash] = info
    if commitment.chain not in chains:
        raise DrawError(f"chain {commitment.chain} is not trusted; pass --chain-info")
    return chains[commitment.chain]


def _quotas(items: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for item in items:
        value, sep, n = item.partition("=")
        if not sep or not n.isdigit():
            raise DrawError(f"--quota takes value=count, got {item!r}")
        out[value] = int(n)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="d2-lottery", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("pool-root", help="Merkle root and size of a pool")
    p.add_argument("--pool", required=True)

    p = sub.add_parser("prove-member", help="inclusion proof for one pseudonym")
    p.add_argument("--pool", required=True)
    p.add_argument("--nym", required=True)

    p = sub.add_parser("commit", help="commit to a pool and a future drand round")
    p.add_argument("--pool", required=True)
    p.add_argument("--purpose", required=True)
    p.add_argument("--context", required=True)
    p.add_argument("--size", type=int, required=True)
    p.add_argument("--tier", help="check the size against Charter's review panel range")
    p.add_argument("--stratify-by")
    p.add_argument("--quota", action="append", default=[], help="value=count, repeatable")
    p.add_argument("--chain", choices=sorted(KNOWN_CHAINS), default="quicknet")
    p.add_argument("--round", type=int, help="default: first round at least an hour away")
    p.add_argument("--now", type=int, help="commit time (unix seconds); default: now")

    p = sub.add_parser("draw", help="run a committed draw once its round exists")
    p.add_argument("--commitment", required=True)
    p.add_argument("--pool", required=True)
    p.add_argument("--beacon", help="beacon JSON; default: fetch it")
    p.add_argument("--chain-info", help="trust this extra chain (drand /info JSON)")
    p.add_argument("--drand-url", default=DEFAULT_URL)

    p = sub.add_parser("verify", help="reproduce a published draw")
    p.add_argument("--transcript", required=True)
    p.add_argument("--chain-info", help="trust this extra chain (drand /info JSON)")

    p = sub.add_parser("panel", help="verify a published draw, then the panel after declines")
    p.add_argument("--transcript", required=True)
    p.add_argument("--declined", action="append", default=[])
    p.add_argument("--chain-info", help="trust this extra chain (drand /info JSON)")

    args = parser.parse_args(argv)
    try:
        out = _run(args)
    except (DrawError, PoolError, BeaconError, OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    if out is not None:
        print(out if isinstance(out, str) else json.dumps(out, indent=2))
    return 0


def _run(args: argparse.Namespace) -> Any:
    if args.cmd == "pool-root":
        pool = Pool(_read(args.pool))
        return {"root": pool.root_hex, "size": len(pool)}
    if args.cmd == "prove-member":
        return Pool(_read(args.pool)).inclusion_proof(args.nym)
    if args.cmd == "commit":
        pool = Pool(_read(args.pool))
        c = commit(
            pool,
            purpose=args.purpose,
            context=args.context,
            size=args.size,
            committed_at=args.now if args.now is not None else int(time.time()),
            chain=KNOWN_CHAINS[args.chain],
            round=args.round,
            tier=args.tier,
            stratify_by=args.stratify_by,
            quotas=_quotas(args.quota),
        )
        return {**c.to_dict(), "commitment_hash": c.hash().hex()}
    if args.cmd == "draw":
        raw = _read(args.commitment)
        raw.pop("commitment_hash", None)
        c = Commitment.from_dict(raw)
        pool = Pool(_read(args.pool))
        chain = _chain_for(c, args.chain_info)
        if args.beacon:
            beacon = Beacon.from_dict(_read(args.beacon))
        else:
            beacon = DrandClient(chain, args.drand_url).beacon(c.round)
        return build(c, pool, chain, beacon)
    if args.cmd == "verify":
        c, result = _verified(args)
        return (
            f"ok: {len(result['selected'])} selected from {c.pool_size} (round {c.round})\n"
            + UNANCHORED_WARNING
        )
    if args.cmd == "panel":
        _, result = _verified(args)
        print(UNANCHORED_WARNING, file=sys.stderr)
        return {**panel(result, args.declined), "anchored": False}
    raise AssertionError(args.cmd)


def _verified(args: argparse.Namespace) -> tuple[Commitment, dict[str, Any]]:
    """Reproduce the transcript's draw; raises unless it verifies."""
    t = _read(args.transcript)
    if not isinstance(t, dict):
        raise DrawError("the transcript is an object")
    c = Commitment.from_dict(t.get("commitment"))
    chain = _chain_for(c, args.chain_info)
    return c, verify(t, {chain.hash: chain})


if __name__ == "__main__":
    sys.exit(main())
