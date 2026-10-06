"""d2-agora: serve the Agora API.

  d2-agora serve --db agora.db [--host 127.0.0.1] [--port 8091]

Exit codes: 0 ok, 2 bad input (for example a database that cannot be opened).
"""

from __future__ import annotations

import argparse
import sqlite3
import sys

from .agora import Agora
from .server import make_server


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="d2-agora")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="run the HTTP API")
    s.add_argument("--db", required=True, help="SQLite file (created if missing)")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8091)
    args = p.parse_args(argv)

    try:
        agora = Agora(args.db)
        server = make_server(agora, args.host, args.port)
    except (OSError, sqlite3.Error) as exc:
        print(f"d2-agora: {exc}", file=sys.stderr)
        return 2
    print(f"d2-agora on http://{args.host}:{server.server_address[1]}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        agora.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
