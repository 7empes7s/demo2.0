"""d2-docket snapshot --out data/lu-chd.json"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import snapshot
from .fetch import Fetcher


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="d2-docket")
    sub = parser.add_subparsers(dest="command", required=True)
    snap = sub.add_parser("snapshot", help="fetch the Chamber agenda and its dossiers")
    snap.add_argument("--out", type=Path, required=True)
    snap.add_argument("--max-items", type=int, default=40)
    snap.add_argument("--delay", type=float, default=1.0, help="seconds between requests")
    args = parser.parse_args(argv)

    data = snapshot.build(Fetcher(delay=args.delay), max_items=args.max_items)
    snapshot.write(data, args.out)
    counts = {k: len(data[k]) for k in ("items", "meetings", "errors")}
    print("{items} items, {meetings} meetings, {errors} errors".format(**counts))
    return 0 if data["items"] else 1


if __name__ == "__main__":
    sys.exit(main())
