"""d2-docket snapshot --out data/docket.json [--sources chd,esch]"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import snapshot
from .fetch import Fetcher


def sources_arg(value: str) -> tuple[str, ...]:
    names = tuple(s.strip() for s in value.split(",") if s.strip())
    unknown = [s for s in names if s not in snapshot.SOURCES]
    if not names or unknown:
        raise argparse.ArgumentTypeError(
            f"unknown source(s) {', '.join(unknown) or '(none)'}; "
            f"choose from {','.join(snapshot.SOURCES)}"
        )
    return names


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="d2-docket")
    sub = parser.add_subparsers(dest="command", required=True)
    snap = sub.add_parser("snapshot", help="fetch the agendas, items and documents of each source")
    snap.add_argument("--out", type=Path, required=True)
    snap.add_argument(
        "--sources",
        type=sources_arg,
        default=snapshot.SOURCES,
        help="comma-separated: chd (Chamber of Deputies), esch (Esch-sur-Alzette). Default: both",
    )
    snap.add_argument("--max-items", type=int, default=40, help="Chamber dossiers to fetch")
    snap.add_argument(
        "--esch-past-sessions",
        type=int,
        default=1,
        help="Esch council sessions before today to include, besides every upcoming one",
    )
    snap.add_argument("--delay", type=float, default=1.0, help="seconds between requests")
    args = parser.parse_args(argv)

    data = snapshot.build(
        Fetcher(delay=args.delay),
        max_items=args.max_items,
        sources=args.sources,
        esch_past_sessions=args.esch_past_sessions,
    )
    snapshot.write(data, args.out)
    counts = {k: len(data[k]) for k in ("items", "meetings", "errors")}
    print("{items} items, {meetings} meetings, {errors} errors".format(**counts))
    return 0 if data["items"] else 1


if __name__ == "__main__":
    sys.exit(main())
