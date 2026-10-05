"""d2-record: run and check a Record log. `d2-record <command> --help` for each command."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from . import ots
from .entry import Entry, EntryError, load_types, sign_entry
from .note import Checkpoint, Signer, Verifier, checkpoint_hash
from .server import b64, consistency_json, inclusion_json, make_server
from .store import Log
from .verify import VerifyError, check_consistency, check_inclusion


def _read(path: str) -> str:
    return sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")


def _json(path: str):
    return json.loads(_read(path))


def _signer(path: str) -> Signer:
    return Signer.parse(Path(path).read_text(encoding="utf-8"))


def _verifier(value: str) -> Verifier:
    """A verifier key string, or a file containing one."""
    if Path(value).is_file():
        value = Path(value).read_text(encoding="utf-8")
    return Verifier.parse(value.strip())


def _log(args) -> Log:
    types = None if args.any_type else load_types(Path(args.types) if args.types else None)
    return Log(args.db, allowed_types=types)


def _out(obj) -> None:
    print(json.dumps(obj, indent=2))


def cmd_keygen(args) -> int:
    signer = Signer.generate(args.name)
    out = Path(args.out)
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(signer.encode() + "\n")
    print(signer.verifier.encode())
    return 0


def cmd_vkey(args) -> int:
    print(_signer(args.key).verifier.encode())
    return 0


def cmd_sign_entry(args) -> int:
    entry = sign_entry(_signer(args.key), args.type, args.payload_hash, args.payload_uri)
    _out(entry.to_dict())
    return 0


def cmd_append(args) -> int:
    data = _json(args.entry)
    items = data if isinstance(data, list) else [data]
    log = _log(args)
    try:
        results = log.append_many([Entry.from_dict(d) for d in items])
    except EntryError as exc:
        print(f"rejected: {exc}", file=sys.stderr)
        return 1
    for seq, leaf in results:
        print(json.dumps({"seq": seq, "leaf_hash": b64(leaf)}))
    return 0


def cmd_checkpoint(args) -> int:
    sys.stdout.write(_log(args).checkpoint(_signer(args.key)))
    return 0


def cmd_prove_inclusion(args) -> int:
    log = _log(args)
    size = log.size if args.size is None else args.size
    _out(inclusion_json(log, args.seq, size))
    return 0


def cmd_prove_consistency(args) -> int:
    _out(consistency_json(_log(args), args.old, args.new))
    return 0


def cmd_verify_inclusion(args) -> int:
    cp = check_inclusion(
        _read(args.checkpoint), _verifier(args.vkey), _json(args.entry), _json(args.proof)
    )
    print(f"ok: entry is in {cp.origin} at size {cp.size}")
    return 0


def cmd_verify_consistency(args) -> int:
    check_consistency(_read(args.old), _read(args.new), _verifier(args.vkey), _json(args.proof))
    print("ok: the new checkpoint extends the old one")
    return 0


def cmd_serve(args) -> int:
    server = make_server(_log(args), _signer(args.key), args.host, args.port)
    print(f"d2-record listening on http://{args.host}:{server.server_address[1]}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


def _anchor_size(log: Log, size: int | None) -> tuple[int, str]:
    note = log.checkpoint_at(size) if size is not None else log.latest_checkpoint()
    if note is None:
        raise KeyError("no such checkpoint; run `d2-record checkpoint` first")
    return int(note.split("\n")[1]), note


def cmd_anchor(args) -> int:
    log = _log(args)
    size, note = _anchor_size(log, args.size)
    receipt, errors = ots.stamp(checkpoint_hash(note), args.calendar or ots.DEFAULT_CALENDARS)
    for err in errors:
        print(f"warning: {err}", file=sys.stderr)
    log.save_anchor(size, receipt)
    if args.out:
        Path(args.out).write_bytes(receipt)
    print(f"anchored checkpoint at size {size}: sha256 {checkpoint_hash(note).hex()}")
    return 0


def cmd_upgrade_anchor(args) -> int:
    log = _log(args)
    size, _ = _anchor_size(log, args.size)
    receipt = log.anchor(size)
    if receipt is None:
        raise KeyError(f"no anchor for size {size}; run `d2-record anchor` first")
    receipt, changed, errors = ots.upgrade(receipt, args.calendar or ots.DEFAULT_CALENDARS)
    for err in errors:
        print(f"warning: {err}", file=sys.stderr)
    if changed:
        log.save_anchor(size, receipt)
    if args.out:
        Path(args.out).write_bytes(receipt)
    print("upgraded" if changed else "no change yet (calendars have not reached Bitcoin)")
    return 0


def cmd_verify_anchor(args) -> int:
    note = _read(args.checkpoint)
    if args.vkey:
        Checkpoint.verify(note, _verifier(args.vkey))
    esplora = None if args.offline else args.esplora
    report = ots.verify(Path(args.ots).read_bytes(), checkpoint_hash(note), esplora)
    for uri in report.pending:
        print(f"pending: {uri}")
    for err in report.errors:
        print(f"warning: skipped a pending attestation: {err}", file=sys.stderr)
    for b in report.bitcoin:
        state = "verified" if b["ok"] else ("unchecked" if esplora is None else "MISMATCH")
        print(f"bitcoin block {b['height']}: {state} (merkle root {b['merkle_root']})")
    if report.verified:
        return 0
    if esplora is not None and report.bitcoin:
        return 1
    return 3  # well formed, not (yet) verifiable on Bitcoin


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="d2-record", description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    def db(sp):
        sp.add_argument("--db", required=True, help="SQLite file")
        sp.add_argument("--types", help="record-types.json (default: spec/record-types.json)")
        sp.add_argument("--any-type", action="store_true", help="accept any entry type")
        return sp

    sp = sub.add_parser("keygen", help="new Ed25519 signing key (file mode 600)")
    sp.add_argument("--name", required=True, help="key name; also the log origin")
    sp.add_argument("--out", required=True)
    sp.set_defaults(fn=cmd_keygen)

    sp = sub.add_parser("vkey", help="print the verifier key of a signing key")
    sp.add_argument("--key", required=True)
    sp.set_defaults(fn=cmd_vkey)

    sp = sub.add_parser("sign-entry", help="sign an entry for a payload hash")
    sp.add_argument("--key", required=True)
    sp.add_argument("--type", required=True)
    sp.add_argument("--payload-hash", required=True, help="sha256:<hex>")
    sp.add_argument("--payload-uri", required=True)
    sp.set_defaults(fn=cmd_sign_entry)

    sp = db(sub.add_parser("append", help="append one entry or a JSON array of entries"))
    sp.add_argument("--entry", required=True, help="JSON file, or - for stdin")
    sp.set_defaults(fn=cmd_append)

    sp = db(sub.add_parser("checkpoint", help="sign and print a checkpoint for the tree"))
    sp.add_argument("--key", required=True)
    sp.set_defaults(fn=cmd_checkpoint)

    sp = db(sub.add_parser("prove-inclusion"))
    sp.add_argument("--seq", type=int, required=True)
    sp.add_argument("--size", type=int)
    sp.set_defaults(fn=cmd_prove_inclusion)

    sp = db(sub.add_parser("prove-consistency"))
    sp.add_argument("--from", dest="old", type=int, required=True)
    sp.add_argument("--to", dest="new", type=int, required=True)
    sp.set_defaults(fn=cmd_prove_consistency)

    sp = sub.add_parser("verify-inclusion", help="exit 0 if the entry is in the checkpoint")
    for name in ("--vkey", "--checkpoint", "--entry", "--proof"):
        sp.add_argument(name, required=True)
    sp.set_defaults(fn=cmd_verify_inclusion)

    sp = sub.add_parser("verify-consistency", help="exit 0 if new extends old")
    for name in ("--vkey", "--old", "--new", "--proof"):
        sp.add_argument(name, required=True)
    sp.set_defaults(fn=cmd_verify_consistency)

    sp = db(sub.add_parser("serve", help="run the HTTP API"))
    sp.add_argument("--key", required=True)
    sp.add_argument("--host", default="127.0.0.1")
    sp.add_argument("--port", type=int, default=8080)
    sp.set_defaults(fn=cmd_serve)

    for name, fn, help_ in (
        ("anchor", cmd_anchor, "timestamp a checkpoint with OpenTimestamps"),
        ("upgrade-anchor", cmd_upgrade_anchor, "fetch the Bitcoin path for a pending anchor"),
    ):
        sp = db(sub.add_parser(name, help=help_))
        sp.add_argument("--size", type=int, help="checkpoint size (default: latest)")
        sp.add_argument("--calendar", action="append", help="calendar URL (repeatable)")
        sp.add_argument("--out", help="also write the .ots receipt here")
        sp.set_defaults(fn=fn)

    sp = sub.add_parser(
        "verify-anchor",
        help="exit 0 if verified on Bitcoin, 3 if only pending or unchecked, 1 if invalid",
    )
    sp.add_argument("--checkpoint", required=True)
    sp.add_argument("--ots", required=True)
    sp.add_argument("--vkey", help="also check the checkpoint signature")
    sp.add_argument("--esplora", default=ots.DEFAULT_ESPLORA, help="Esplora API base URL")
    sp.add_argument("--offline", action="store_true", help="do not query a block explorer")
    sp.set_defaults(fn=cmd_verify_anchor)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.fn(args)
    except (VerifyError, ValueError, KeyError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
