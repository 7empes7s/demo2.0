"""d2-commons: build the argument library, read it, or serve it.

  d2-commons ingest --out library.json [--docket snapshot.json]
                    [--page URL=FILE ...]       recorded participation project pages
                    [--fetch]                   fetch the project pages the snapshot lists
                    [--generated-at ISO-8601]
  d2-commons arguments --library library.json MATTER_ID [--stance yes|no|...]
  d2-commons serve --library library.json [--host 127.0.0.1] [--port 8091]

Exit codes: 0 ok, 2 bad input.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from . import ingest, library


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="d2-commons")
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("ingest", help="build the library from Esch-sur-Alzette's public sources")
    i.add_argument("--out", required=True)
    i.add_argument("--docket", help="Docket snapshot JSON (council votes)")
    i.add_argument("--page", action="append", default=[], metavar="URL=FILE")
    i.add_argument("--fetch", action="store_true", help="fetch project pages, 1 per 3 s")
    i.add_argument("--generated-at", help="timestamp to record (default: now)")
    a = sub.add_parser("arguments", help="print the arguments for one Docket item")
    a.add_argument("--library", required=True)
    a.add_argument("--stance")
    a.add_argument("matter_id")
    s = sub.add_parser("serve", help="run the HTTP API")
    s.add_argument("--library", required=True)
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8091)
    args = p.parse_args(argv)

    try:
        if args.cmd == "ingest":
            snapshot = None
            if args.docket:
                snapshot = json.loads(Path(args.docket).read_text(encoding="utf-8"))
            pages = []
            for spec in args.page:
                url, sep, file = spec.partition("=")
                if not sep:
                    raise ValueError(f"--page wants URL=FILE, got {spec!r}")
                pages.append((url, Path(file).read_text(encoding="utf-8")))
            errors: list[dict] = []
            if args.fetch:
                if snapshot is None:
                    raise ValueError("--fetch needs --docket to know which pages to read")
                fetcher = ingest.Fetcher()
                for url in ingest.project_urls(snapshot):
                    try:
                        pages.append((url, fetcher.get(url)))
                    except OSError as exc:
                        errors.append({"url": url, "error": str(exc)})
            when = args.generated_at or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
            lib = ingest.build(snapshot, pages, when, errors)
            library.write(lib, args.out)
            for e in errors:
                print(f"d2-commons: skipped {e['url']}: {e['error']}", file=sys.stderr)
            print(
                f"{len(lib.arguments)} arguments on {len(lib.matters())} matters", file=sys.stderr
            )
            return 0
        lib = library.load(args.library)
    except (OSError, ValueError, KeyError) as exc:
        print(f"d2-commons: {exc}", file=sys.stderr)
        return 2

    if args.cmd == "serve":
        from .server import make_server

        server = make_server(lib, args.host, args.port)
        print(f"d2-commons on http://{args.host}:{server.server_address[1]}", file=sys.stderr)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        return 0

    from .server import arguments_response

    out = arguments_response(lib, args.matter_id, args.stance)
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
