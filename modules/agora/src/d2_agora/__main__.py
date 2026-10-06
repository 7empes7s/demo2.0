"""d2-agora: serve the Agora API.

  d2-agora serve --db agora.db [--host 127.0.0.1] [--port 8091]
                 [--door-url URL --door-epoch N [--new-epoch] | --read-only
                  | --dev-identity (--nym-key-file PATH | --dev-insecure-key)]

Identity, exactly one of:
- Door: --door-url or DOOR_URL (the Door verifier, `d2-door serve`) and --door-epoch or
  DOOR_EPOCH (the one credential epoch Agora accepts). Posts and upvotes then need a Door
  presentation; raw participant ids are refused. The database keeps the first epoch it accepted;
  starting with another one needs --new-epoch, because every holder gets new nyms and could
  upvote the same ideas again.
- --read-only: no identity; reads only, every post and upvote is refused (403 read_only).
- --dev-identity: the development stand-in (KeyedNyms, one upvote per invented id, not per
  human) with --nym-key-file or AGORA_NYM_KEY_FILE (a file of at least 32 bytes, kept out of
  git, mode 600), or --dev-insecure-key, which uses a public key. The key options are refused
  without --dev-identity, so a production unit cannot pick the stand-in by accident.
With none of these, or two of them, the server refuses to start.

Exit codes: 0 ok, 2 bad input (for example a database that cannot be opened or no identity).
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys

from .agora import Agora, AgoraError
from .identity import DEV_KEY, DoorNyms, KeyedNyms, MissingKey, ReadOnly
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
    s.add_argument(
        "--new-epoch", action="store_true", help="accept a Door epoch other than the stored one"
    )
    s.add_argument("--read-only", action="store_true", help="no identity: refuse every write")
    s.add_argument(
        "--dev-identity", action="store_true", help="development stand-in identity (KeyedNyms)"
    )
    key = s.add_mutually_exclusive_group()
    key.add_argument(
        "--nym-key-file", help="file holding the nym key (default $AGORA_NYM_KEY_FILE)"
    )
    key.add_argument(
        "--dev-insecure-key", action="store_true", help="use a public key; development only"
    )
    args = p.parse_args(argv)

    door_url = args.door_url or os.environ.get("DOOR_URL")
    agora = None
    try:
        if args.new_epoch and not door_url:
            raise MissingKey("--new-epoch needs Door (DOOR_URL)")
        if (args.dev_insecure_key or args.nym_key_file) and not args.dev_identity:
            raise MissingKey("--nym-key-file / --dev-insecure-key need --dev-identity")
        if args.read_only and (door_url or args.dev_identity):
            raise MissingKey("--read-only takes no identity: drop DOOR_URL / --dev-identity")
        if door_url:
            if args.dev_identity:
                raise MissingKey("Door is configured: drop --dev-identity and its nym key")
            epoch = args.door_epoch or os.environ.get("DOOR_EPOCH")
            if not (epoch and epoch.isascii() and epoch.isdigit() and len(epoch) <= 10):
                raise MissingKey("Door needs --door-epoch or DOOR_EPOCH (a whole number)")
            nyms = DoorNyms(door_url, int(epoch))
            print(f"d2-agora: identity from Door at {door_url}, epoch {epoch}", file=sys.stderr)
        elif args.read_only:
            print("d2-agora: read only, every post and upvote is refused", file=sys.stderr)
            nyms = ReadOnly()
        elif not args.dev_identity:
            raise MissingKey(
                "no identity: set DOOR_URL and DOOR_EPOCH, or pass --read-only, or"
                " --dev-identity with a nym key (development only)"
            )
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
        if isinstance(nyms, DoorNyms):
            agora.accept_door_epoch(nyms.epoch, new=args.new_epoch)
        server = make_server(agora, args.host, args.port)
    except (OSError, sqlite3.Error, MissingKey, AgoraError) as exc:
        print(f"d2-agora: {exc}", file=sys.stderr)
        if agora is not None:
            agora.close()
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
