"""OpenTimestamps anchoring for checkpoints: submit, upgrade and verify .ots receipts.

A minimal, dependency-free implementation of the OpenTimestamps proof format
(https://github.com/opentimestamps/python-opentimestamps). The anchored file is the signed
checkpoint note; its SHA-256 is submitted to each calendar's `POST /digest`, and the receipt is
a standard detached timestamp, so `ots verify -f checkpoint.txt checkpoint.ots` also works.

Every URL (calendars, the Esplora block API) is a parameter, so tests run against fakes.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field

HEADER_MAGIC = b"\x00OpenTimestamps\x00\x00Proof\x00\xbf\x89\xe2\xe8\x84\xe8\x92\x94"
MAJOR_VERSION = 1
OP_SHA256 = 0x08
PENDING = bytes.fromhex("83dfe30d2ef90c8e")
BITCOIN = bytes.fromhex("0588960d73d71901")

DEFAULT_CALENDARS = (
    "https://a.pool.opentimestamps.org",
    "https://b.pool.opentimestamps.org",
    "https://a.pool.eternitywall.com",
    "https://ots.btc.catallaxy.com",
)
DEFAULT_ESPLORA = "https://blockstream.info/api"
USER_AGENT = "d2-record/0.1 (+https://github.com/7empes7s/demo2.0)"

_UNARY = {0x08: "sha256", 0x02: "sha1", 0x03: "ripemd160", 0xF2: "reverse", 0xF3: "hexlify"}
_BINARY = {0xF0: "append", 0xF1: "prepend"}
_MAX_MSG = 4096
_MAX_DEPTH = 256
_MAX_RESPONSE = 10_000


class OtsError(ValueError):
    pass


# Encoding ------------------------------------------------------------------------------


def _write_varuint(out: io.BytesIO, n: int) -> None:
    while True:
        b = n & 0x7F
        n >>= 7
        out.write(bytes([b | 0x80 if n else b]))
        if not n:
            return


def _read(inp: io.BytesIO, n: int) -> bytes:
    b = inp.read(n)
    if len(b) != n:
        raise OtsError("truncated proof")
    return b


def _read_varuint(inp: io.BytesIO) -> int:
    n, shift = 0, 0
    while True:
        b = _read(inp, 1)[0]
        n |= (b & 0x7F) << shift
        if not b & 0x80:
            return n
        shift += 7
        if shift > 63:
            raise OtsError("varuint too long")


def _read_varbytes(inp: io.BytesIO, limit: int = _MAX_MSG) -> bytes:
    n = _read_varuint(inp)
    if n > limit:
        raise OtsError("field too long")
    return _read(inp, n)


def _write_varbytes(out: io.BytesIO, b: bytes) -> None:
    _write_varuint(out, len(b))
    out.write(b)


def apply_op(tag: int, arg: bytes | None, msg: bytes) -> bytes:
    if tag in _BINARY:
        result = msg + arg if tag == 0xF0 else arg + msg  # type: ignore[operator]
    elif tag == 0xF2:
        result = msg[::-1]
    elif tag == 0xF3:
        result = msg.hex().encode()
    elif tag in _UNARY:
        try:
            result = hashlib.new(_UNARY[tag], msg).digest()
        except ValueError as exc:
            raise OtsError(f"hash {_UNARY[tag]} unavailable") from exc
    else:
        raise OtsError(f"unknown op 0x{tag:02x}")
    if len(result) > _MAX_MSG:
        raise OtsError("message too long")
    return result


# Timestamps ----------------------------------------------------------------------------


@dataclass
class Timestamp:
    msg: bytes
    attestations: list[tuple[bytes, bytes]] = field(default_factory=list)  # (tag, payload)
    ops: list[tuple[int, bytes | None, Timestamp]] = field(default_factory=list)

    @classmethod
    def parse(cls, inp: io.BytesIO, msg: bytes, depth: int = 0) -> Timestamp:
        if depth > _MAX_DEPTH:
            raise OtsError("proof too deep")
        stamp = cls(msg)

        def item(tag: int) -> None:
            if tag == 0x00:
                att_tag = _read(inp, 8)
                stamp.attestations.append((att_tag, _read_varbytes(inp, 8192)))
            else:
                arg = _read_varbytes(inp) if tag in _BINARY else None
                if arg is not None and not arg:
                    raise OtsError("empty op argument")
                child = cls.parse(inp, apply_op(tag, arg, msg), depth + 1)
                stamp.ops.append((tag, arg, child))

        tag = _read(inp, 1)[0]
        while tag == 0xFF:
            item(_read(inp, 1)[0])
            tag = _read(inp, 1)[0]
        item(tag)
        return stamp

    def serialize(self, out: io.BytesIO) -> None:
        items: list[tuple[str, object]] = [("a", a) for a in self.attestations]
        items += [("o", o) for o in self.ops]
        if not items:
            raise OtsError("empty timestamp")
        for i, (kind, value) in enumerate(items):
            if i < len(items) - 1:
                out.write(b"\xff")
            if kind == "a":
                tag, payload = value  # type: ignore[misc]
                out.write(b"\x00" + tag)
                _write_varbytes(out, payload)
            else:
                op, arg, child = value  # type: ignore[misc]
                out.write(bytes([op]))
                if arg is not None:
                    _write_varbytes(out, arg)
                child.serialize(out)

    def merge(self, other: Timestamp) -> None:
        if other.msg != self.msg:
            raise OtsError("cannot merge timestamps of different messages")
        for att in other.attestations:
            if att not in self.attestations:
                self.attestations.append(att)
        for op, arg, child in other.ops:
            for my_op, my_arg, mine in self.ops:
                if (my_op, my_arg) == (op, arg):
                    mine.merge(child)
                    break
            else:
                self.ops.append((op, arg, child))

    def walk(self):
        """Yield (node, attestation) for every attestation in the tree."""
        for att in self.attestations:
            yield self, att
        for _, _, child in self.ops:
            yield from child.walk()


def pending_uri(payload: bytes) -> str:
    try:
        uri = _read_varbytes(io.BytesIO(payload), 1000).decode("ascii", "strict")
    except UnicodeDecodeError as exc:
        raise OtsError("calendar URI in pending attestation is not ASCII") from exc
    if not uri.startswith(("https://", "http://")) or any(c in uri for c in " \"'<>\\"):
        raise OtsError("bad calendar URI in pending attestation")
    return uri


def bitcoin_height(payload: bytes) -> int:
    return _read_varuint(io.BytesIO(payload))


def parse_ots(data: bytes) -> tuple[bytes, Timestamp]:
    """Return (file digest, timestamp) from a detached .ots file."""
    inp = io.BytesIO(data)
    if _read(inp, len(HEADER_MAGIC)) != HEADER_MAGIC:
        raise OtsError("not an OpenTimestamps proof")
    if _read_varuint(inp) != MAJOR_VERSION:
        raise OtsError("unsupported proof version")
    if _read(inp, 1)[0] != OP_SHA256:
        raise OtsError("only SHA-256 file hashes are supported")
    digest = _read(inp, 32)
    stamp = Timestamp.parse(inp, digest)
    if inp.read(1):
        raise OtsError("trailing bytes after proof")
    return digest, stamp


def serialize_ots(digest: bytes, stamp: Timestamp) -> bytes:
    out = io.BytesIO()
    out.write(HEADER_MAGIC)
    _write_varuint(out, MAJOR_VERSION)
    out.write(bytes([OP_SHA256]) + digest)
    stamp.serialize(out)
    return out.getvalue()


# Calendars and Bitcoin ------------------------------------------------------------------


def _http(url: str, data: bytes | None = None, timeout: float = 15.0) -> bytes | None:
    """Body of a 200 response, None on 404; raise OtsError otherwise."""
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Accept": "application/vnd.opentimestamps.v1", "User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(_MAX_RESPONSE + 1)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise OtsError(f"{url}: HTTP {exc.code}") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise OtsError(f"{url}: {exc}") from exc
    if len(body) > _MAX_RESPONSE:
        raise OtsError(f"{url}: response too large")
    return body


def stamp(
    digest: bytes, calendars: tuple[str, ...] | list[str] = DEFAULT_CALENDARS, min_ok: int = 1
) -> tuple[bytes, list[str]]:
    """Submit `digest` to each calendar; return (.ots bytes, errors)."""
    root, errors, ok = Timestamp(digest), [], 0
    for cal in calendars:
        try:
            body = _http(cal.rstrip("/") + "/digest", data=digest)
            if body is None:
                raise OtsError(f"{cal}: HTTP 404")
            inp = io.BytesIO(body)
            root.merge(Timestamp.parse(inp, digest))
            if inp.read(1):
                raise OtsError(f"{cal}: trailing bytes")
            ok += 1
        except OtsError as exc:
            errors.append(str(exc))
    if ok < min_ok:
        raise OtsError(f"only {ok} of {len(calendars)} calendars answered: {'; '.join(errors)}")
    return serialize_ots(digest, root), errors


def upgrade(
    data: bytes, calendars: tuple[str, ...] | list[str] = DEFAULT_CALENDARS
) -> tuple[bytes, bool, list[str]]:
    """Ask each pending calendar for its finished path; return (.ots bytes, changed, errors).

    Only calendars in `calendars` are contacted, whatever URI the receipt names.
    """
    digest, root = parse_ots(data)
    allowed = {c.rstrip("/") for c in calendars}
    changed, errors = False, []
    for node, (tag, payload) in list(root.walk()):
        if tag != PENDING:
            continue
        try:
            uri = pending_uri(payload).rstrip("/")
        except OtsError as exc:
            errors.append(f"{exc}, skipped")
            continue
        if uri not in allowed:
            errors.append(f"{uri}: not an allowed calendar, skipped")
            continue
        try:
            body = _http(f"{uri}/timestamp/{node.msg.hex()}")
            if body is None:
                continue
            node.merge(Timestamp.parse(io.BytesIO(body), node.msg))
        except OtsError as exc:
            errors.append(str(exc))
            continue
        if any(t == BITCOIN for _, (t, _) in node.walk()):
            node.attestations.remove((tag, payload))
        changed = True
    return serialize_ots(digest, root), changed, errors


@dataclass
class AnchorReport:
    pending: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)  # malformed pending attestations, skipped
    bitcoin: list[dict] = field(default_factory=list)  # {height, merkle_root, ok, block_time}

    @property
    def verified(self) -> bool:
        return any(b["ok"] for b in self.bitcoin)


def verify(
    data: bytes, expected_digest: bytes, esplora: str | None = DEFAULT_ESPLORA
) -> AnchorReport:
    """Check the receipt is for `expected_digest`; check Bitcoin attestations against Esplora.

    With esplora=None, Bitcoin attestations are listed but not checked (ok=False).
    """
    digest, root = parse_ots(data)
    if digest != expected_digest:
        raise OtsError("receipt is for a different checkpoint")
    report = AnchorReport()
    for node, (tag, payload) in root.walk():
        if tag == PENDING:
            try:
                report.pending.append(pending_uri(payload))
            except OtsError as exc:
                report.errors.append(str(exc))
        elif tag == BITCOIN:
            height = bitcoin_height(payload)
            claimed = node.msg[::-1].hex() if len(node.msg) == 32 else ""
            item = {"height": height, "merkle_root": claimed, "ok": False, "block_time": None}
            if esplora and claimed:
                base = esplora.rstrip("/")
                block_hash = (_http(f"{base}/block-height/{height}") or b"").decode().strip()
                if not re.fullmatch(r"[0-9a-f]{64}", block_hash):
                    raise OtsError(f"no block at height {height}")
                try:
                    block = json.loads(_http(f"{base}/block/{block_hash}") or b"{}")
                except ValueError as exc:
                    raise OtsError(f"block {block_hash}: reply is not JSON") from exc
                if not isinstance(block, dict):
                    raise OtsError(f"block {block_hash}: reply is not a JSON object")
                item["ok"] = block.get("merkle_root") == claimed
                item["block_time"] = block.get("timestamp")
            report.bitcoin.append(item)
    return report
