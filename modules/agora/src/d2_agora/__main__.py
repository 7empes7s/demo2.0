"""d2-agora: serve the Agora API.

  d2-agora serve --db agora.db [--host 127.0.0.1] [--port 8091]
                 [--nym-key-file PATH | --dev-insecure-key]

The nym key comes from --nym-key-file or the AGORA_NYM_KEY_FILE environment variable (a file of at
least 32 bytes, kept out of git, mode 600). Without one the server refuses to start, unless
--dev-insecure-key is given, which uses a public key and is for development only.

Exit codes: 0 ok, 2 bad input (for example a database that cannot be opened or no nym key).
"""

from __future__ import annotations

import argparse
import sqlite3
import sys

from .agora import Agora
from .identity import DEV_KEY, KeyedNyms, MissingKey
from .server import make_server


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="d2-agora")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="run the HTTP API")
    s.add_argument("--db", required=True, help="SQLite file (created if missing)")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8091)
    key = s.add_mutually_exclusive_group()
    key.add_argument(
        "--nym-key-file", help="file holding the nym key (default $AGORA_NYM_KEY_FILE)"
    )
    key.add_argument(
        "--dev-insecure-key", action="store_true", help="use a public key; development only"
    )
    args = p.parse_args(argv)

    try:
        if args.dev_insecure_key:
            print("d2-agora: using the public development nym key", file=sys.stderr)
            nyms = KeyedNyms(DEV_KEY)
        elif args.nym_key_file:
            nyms = KeyedNyms.from_file(args.nym_key_file)
        else:
            nyms = KeyedNyms.from_env()
        agora = Agora(args.db, nyms=nyms)
        server = make_server(agora, args.host, args.port)
    except (OSError, sqlite3.Error, MissingKey) as exc:
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
