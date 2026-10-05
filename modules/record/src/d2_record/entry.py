"""Record entries: validation, the signed message, and the leaf encoding.

An entry is {type, payload_hash, payload_uri, signer, signature}. The log never sees payloads.
  signed message = "d2.record.entry-signature/1\\n" type "\\n" payload_hash "\\n" payload_uri "\\n"
  leaf data      = "d2.record.entry/1\\n" type "\\n" payload_hash "\\n" payload_uri "\\n"
                   signer "\\n" signature "\\n"                                  (UTF-8)
"""

from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path

from .merkle import leaf_hash
from .note import Signer, Verifier

FIELDS = ("type", "payload_hash", "payload_uri", "signer", "signature")
_PAYLOAD_HASH = re.compile(r"^sha256:[0-9a-f]{64}$")
_URI = re.compile(r"^[^\x00-\x20\x7f]{1,2048}$")


class EntryError(ValueError):
    pass


@dataclass(frozen=True)
class Entry:
    type: str
    payload_hash: str
    payload_uri: str
    signer: str
    signature: str

    def signed_message(self) -> bytes:
        return signed_message(self.type, self.payload_hash, self.payload_uri)

    def leaf_data(self) -> bytes:
        fields = (self.type, self.payload_hash, self.payload_uri, self.signer, self.signature)
        return ("d2.record.entry/1\n" + "".join(f + "\n" for f in fields)).encode()

    def leaf_hash(self) -> bytes:
        return leaf_hash(self.leaf_data())

    def to_dict(self) -> dict[str, str]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: object) -> Entry:
        if not isinstance(data, dict) or set(data) != set(FIELDS):
            raise EntryError(f"entry must have exactly the fields {', '.join(FIELDS)}")
        if not all(isinstance(data[f], str) for f in FIELDS):
            raise EntryError("entry fields must be strings")
        return cls(**{f: data[f] for f in FIELDS})

    def check(self, allowed_types: frozenset[str] | None) -> None:
        """Raise EntryError unless the entry is well formed and its signature verifies."""
        if allowed_types is not None and self.type not in allowed_types:
            raise EntryError(f"unknown entry type {self.type!r}")
        if not _PAYLOAD_HASH.match(self.payload_hash):
            raise EntryError("payload_hash must be sha256:<64 lowercase hex>")
        if not _URI.match(self.payload_uri):
            raise EntryError("payload_uri must be 1-2048 characters with no spaces or controls")
        try:
            verifier = Verifier.parse(self.signer)
            sig = base64.b64decode(self.signature, validate=True)
        except ValueError as exc:
            raise EntryError(f"bad signer or signature encoding: {exc}") from exc
        if len(sig) != 64 or not verifier.verify(self.signed_message(), sig):
            raise EntryError("signature does not verify")


def signed_message(type_: str, payload_hash: str, payload_uri: str) -> bytes:
    return f"d2.record.entry-signature/1\n{type_}\n{payload_hash}\n{payload_uri}\n".encode()


def sign_entry(signer: Signer, type_: str, payload_hash: str, payload_uri: str) -> Entry:
    sig = signer.sign(signed_message(type_, payload_hash, payload_uri))
    return Entry(
        type_, payload_hash, payload_uri, signer.verifier.encode(), base64.b64encode(sig).decode()
    )


def find_types_file() -> Path | None:
    env = os.environ.get("D2_RECORD_TYPES")
    if env:
        return Path(env)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "spec" / "record-types.json"
        if candidate.is_file():
            return candidate
    return None


def load_types(path: Path | None = None) -> frozenset[str]:
    """Entry types from spec/record-types.json (path, $D2_RECORD_TYPES, or found upward)."""
    path = path or find_types_file()
    if path is None:
        raise FileNotFoundError(
            "spec/record-types.json not found; pass --types or set D2_RECORD_TYPES"
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    return frozenset(t["type"] for t in data["types"])
