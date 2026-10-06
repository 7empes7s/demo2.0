"""d2-booth-verify <board.json> [--jobs N] [--json]: replay a Booth board, print its tally."""

from __future__ import annotations

import argparse
import json
import os
import sys

from .errors import BoardError
from .verify import verify_bytes


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="d2-booth-verify",
        description="Independent verifier for Booth boards (spec/booth/README.md). "
        "Exit 0: the board proves the printed tally. Exit 1: it does not (spec error code). "
        "Exit 2: the file could not be read.",
    )
    ap.add_argument("board", help="board JSON file ({'schema': 'd2.booth.board/1', ...})")
    ap.add_argument(
        "--jobs",
        type=int,
        default=os.cpu_count() or 1,
        help="processes for ballot proofs (default: all cores)",
    )
    ap.add_argument("--json", action="store_true", help="print one JSON object instead")
    args = ap.parse_args(argv)
    try:
        with open(args.board, "rb") as f:
            data = f.read()
    except OSError as e:
        print(f"error: cannot read {args.board}: {e.strerror}", file=sys.stderr)
        return 2
    try:
        tally = verify_bytes(data, jobs=max(1, args.jobs))
    except BoardError as e:
        if args.json:
            print(json.dumps({"ok": False, "error": e.code, "seq": e.seq, "detail": e.detail}))
        else:
            where = f" at entry {e.seq}" if e.seq is not None else ""
            print(f"fail: {e.code}{where}: {e.detail}")
        return 1
    if args.json:
        out = {"ok": True, "round_id": tally.round_id, "options": tally.options}
        out["tally"] = tally.as_spec()
        print(json.dumps(out))
    else:
        used = ", ".join(str(g) for g in tally.guardians_used)
        print(
            f"ok: {tally.round_id}, {tally.counted} counted of {tally.signups} sign-ups, "
            f"guardians {used}"
        )
        for label, count in zip(tally.options, tally.counts, strict=True):
            print(f"  {label}: {count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
