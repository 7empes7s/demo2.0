"""d2-agora: serve the Agora API.

  d2-agora serve --db agora.db [--host 127.0.0.1] [--port 8091]
                 [--door-url URL --door-epoch N | --nym-key-file PATH | --dev-insecure-key]

Identity, in order:
- Door: --door-url or DOOR_URL (the Door verifier, `d2-door serve`) and --door-epoch or
  DOOR_EPOCH (the one credential epoch Agora accepts). Posts and upvotes then need a Door
  presentation; raw participant ids are refused. A nym key option given as well is an error.
- Development stand-in (KeyedNyms, one upvote per invented id, not per human): --nym-key-file or
  AGORA_NYM_KEY_FILE (a file of at least 32 bytes, kept out of git, mode 600), or
  --dev-insecure-key, which uses a public key.
With none of these the server refuses to start.

Exit codes: 0 ok, 2 bad input (for example a database that cannot be opened or no identity).
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys

from .agora import Agora
from .identity import DEV_KEY, DoorNyms, KeyedNyms, MissingKey
from .server import make_server


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="d2-agora")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="run the HTTP API")
    s.add_argument("--db", required=True, help="SQLite file (created if missing)")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8091)
    s.add_argument("--door-url", help="Door verifier URL (default $DOOR_URL)")
    s.add_argument("--door-epoch", help="the credential epoch Agora accepts (default $DOOR_EPOCH)")
    key = s.add_mutually_exclusive_group()
    key.add_argument(
        "--nym-key-file", help="file holding the nym key (default $AGORA_NYM_KEY_FILE)"
    )
    key.add_argument(
        "--dev-insecure-key", action="store_true", help="use a public key; development only"
    )
    args = p.parse_args(argv)

    door_url = args.door_url or os.environ.get("DOOR_URL")
    try:
        if door_url:
            if args.dev_insecure_key or args.nym_key_file:
                raise MissingKey("Door is configured: drop --nym-key-file / --dev-insecure-key")
            epoch = args.door_epoch or os.environ.get("DOOR_EPOCH")
            if not (epoch and epoch.isascii() and epoch.isdigit() and len(epoch) <= 10):
                raise MissingKey("Door needs --door-epoch or DOOR_EPOCH (a whole number)")
            nyms = DoorNyms(door_url, int(epoch))
            print(f"d2-agora: identity from Door at {door_url}, epoch {epoch}", file=sys.stderr)
        elif args.dev_insecure_key:
            print("d2-agora: using the public development nym key", file=sys.stderr)
            nyms = KeyedNyms(DEV_KEY)
        elif args.nym_key_file:
            nyms = KeyedNyms.from_file(args.nym_key_file)
        else:
            nyms = KeyedNyms.from_env()
        if isinstance(nyms, KeyedNyms):
            print(
                "d2-agora: development identity (KeyedNyms): one upvote per id, not per human",
                file=sys.stderr,
            )
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
