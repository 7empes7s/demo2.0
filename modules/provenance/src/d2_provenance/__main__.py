"""d2-provenance: grade claims from the command line, serve the API, or score a labelled set.

  d2-provenance grade --docket snapshot.json "claim text" [--context ITEM_ID] [--why]
  d2-provenance serve --docket snapshot.json [--host 127.0.0.1] [--port 8090]
  d2-provenance eval  --labels labels.json [--docket snapshot.json]

Exit codes: 0 ok, 1 eval below its bar, 2 bad input, 3 no record mentions the claim.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .corpus import load
from .evaluate import evaluate
from .grader import Grader, NoRecord


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="d2-provenance")
    sub = p.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("grade", help="grade one claim")
    g.add_argument("--docket", required=True, help="Docket snapshot JSON")
    g.add_argument("--context", help="Docket item id the claim is about")
    g.add_argument("--why", action="store_true", help="also print the rule that decided")
    g.add_argument("text")
    s = sub.add_parser("serve", help="run the HTTP API")
    s.add_argument("--docket", required=True)
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8090)
    e = sub.add_parser("eval", help="score the checker on a labelled set")
    e.add_argument("--labels", required=True)
    e.add_argument("--docket", help="snapshot; default: the one the labels file names")
    args = p.parse_args(argv)

    try:
        if args.cmd == "eval":
            labels_path = Path(args.labels)
            labels = json.loads(labels_path.read_text(encoding="utf-8"))
            docket = Path(args.docket) if args.docket else labels_path.parent / labels["docket"]
            report = evaluate(Grader(load(docket)), labels)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0 if report["passed"] else 1
        grader = Grader(load(args.docket))
    except (OSError, ValueError, KeyError) as exc:
        print(f"d2-provenance: {exc}", file=sys.stderr)
        return 2

    if args.cmd == "serve":
        from .server import make_server

        server = make_server(grader, args.host, args.port)
        print(f"d2-provenance on http://{args.host}:{server.server_address[1]}", file=sys.stderr)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        return 0

    try:
        out = grader.grade(args.text, args.context)
        if args.why:
            out = {**out, "why": grader.verdict(args.text, args.context).reasons}
    except NoRecord:
        print("d2-provenance: no record mentions this claim", file=sys.stderr)
        return 3
    except ValueError as exc:
        print(f"d2-provenance: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
