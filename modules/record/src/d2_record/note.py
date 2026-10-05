"""Ed25519 keys, signed notes (C2SP signed-note) and checkpoints (C2SP tlog-checkpoint).

Key strings use the signed-note encodings:
  verifier key  <name>+<key id, 8 hex>+<base64(0x01 || 32-byte public key)>
  signer key    PRIVATE+KEY+<name>+<key id>+<base64(0x01 || 32-byte seed)>
key id = first 4 bytes of SHA-256(name || 0x0A || 0x01 || public key).
"""

from __future__ import annotations

import base64
import hashlib
import re
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

ALG_ED25519 = 0x01
SIG_PREFIX = "— "  # em dash + space
_NAME = re.compile(r"^[^\s+]+$")


def _raw_public(key: Ed25519PublicKey) -> bytes:
    return key.public_bytes(Encoding.Raw, PublicFormat.Raw)


def key_id(name: str, public: bytes) -> bytes:
    return hashlib.sha256(name.encode() + b"\n" + bytes([ALG_ED25519]) + public).digest()[:4]


@dataclass(frozen=True)
class Verifier:
    name: str
    public: bytes

    @property
    def id(self) -> bytes:
        return key_id(self.name, self.public)

    def encode(self) -> str:
        blob = base64.b64encode(bytes([ALG_ED25519]) + self.public).decode()
        return f"{self.name}+{self.id.hex()}+{blob}"

    def verify(self, message: bytes, signature: bytes) -> bool:
        try:
            Ed25519PublicKey.from_public_bytes(self.public).verify(signature, message)
            return True
        except (InvalidSignature, ValueError):
            return False

    @classmethod
    def parse(cls, text: str) -> Verifier:
        parts = text.strip().split("+", 2)  # base64 may itself contain "+"
        if len(parts) != 3 or not _NAME.match(parts[0]):
            raise ValueError("verifier key must be <name>+<id>+<key>")
        name, kid, blob = parts
        raw = base64.b64decode(blob, validate=True)
        if len(raw) != 33 or raw[0] != ALG_ED25519:
            raise ValueError("verifier key is not an Ed25519 key")
        verifier = cls(name, raw[1:])
        if verifier.id.hex() != kid.lower():
            raise ValueError("verifier key id does not match the key")
        return verifier


@dataclass(frozen=True)
class Signer:
    name: str
    seed: bytes

    @property
    def private(self) -> Ed25519PrivateKey:
        return Ed25519PrivateKey.from_private_bytes(self.seed)

    @property
    def verifier(self) -> Verifier:
        return Verifier(self.name, _raw_public(self.private.public_key()))

    def sign(self, message: bytes) -> bytes:
        return self.private.sign(message)

    def encode(self) -> str:
        blob = base64.b64encode(bytes([ALG_ED25519]) + self.seed).decode()
        return f"PRIVATE+KEY+{self.name}+{self.verifier.id.hex()}+{blob}"

    @classmethod
    def generate(cls, name: str) -> Signer:
        if not _NAME.match(name):
            raise ValueError("key name must be non-empty with no spaces or '+'")
        seed = Ed25519PrivateKey.generate().private_bytes(
            Encoding.Raw, PrivateFormat.Raw, NoEncryption()
        )
        return cls(name, seed)

    @classmethod
    def parse(cls, text: str) -> Signer:
        parts = text.strip().split("+", 4)
        if len(parts) != 5 or parts[:2] != ["PRIVATE", "KEY"]:
            raise ValueError("signer key must be PRIVATE+KEY+<name>+<id>+<key>")
        raw = base64.b64decode(parts[4], validate=True)
        if len(raw) != 33 or raw[0] != ALG_ED25519:
            raise ValueError("signer key is not an Ed25519 key")
        signer = cls(parts[2], raw[1:])
        if signer.verifier.id.hex() != parts[3].lower():
            raise ValueError("signer key id does not match the key")
        return signer


def sign_note(body: str, signer: Signer) -> str:
    if not body.endswith("\n") or "\n\n" in body:
        raise ValueError("note body must end in a newline and contain no blank line")
    sig = signer.sign(body.encode())
    line = base64.b64encode(signer.verifier.id + sig).decode()
    return f"{body}\n{SIG_PREFIX}{signer.name} {line}\n"


def open_note(note: str, verifier: Verifier) -> str:
    """Return the note body if `verifier` signed it, else raise ValueError."""
    body, sep, sigs = note.partition("\n\n")
    if not sep or not sigs.endswith("\n"):
        raise ValueError("malformed note")
    body += "\n"
    for line in sigs[:-1].split("\n"):
        if not line.startswith(SIG_PREFIX):
            raise ValueError("malformed signature line")
        name, _, blob = line[len(SIG_PREFIX) :].partition(" ")
        raw = base64.b64decode(blob, validate=True)
        if name != verifier.name or raw[:4] != verifier.id:
            continue
        if verifier.verify(body.encode(), raw[4:]):
            return body
        raise ValueError("bad signature")
    raise ValueError(f"no signature from {verifier.name}")


@dataclass(frozen=True)
class Checkpoint:
    origin: str
    size: int
    root: bytes
    timestamp: int

    def body(self) -> str:
        root = base64.b64encode(self.root).decode()
        return f"{self.origin}\n{self.size}\n{root}\ntimestamp {self.timestamp}\n"

    def sign(self, signer: Signer) -> str:
        return sign_note(self.body(), signer)

    @classmethod
    def parse_body(cls, body: str) -> Checkpoint:
        lines = body.split("\n")[:-1]
        if len(lines) < 3 or not lines[0]:
            raise ValueError("checkpoint needs origin, size and root lines")
        if not re.fullmatch(r"0|[1-9][0-9]*", lines[1]):
            raise ValueError("bad tree size")
        root = base64.b64decode(lines[2], validate=True)
        if len(root) != 32:
            raise ValueError("bad root hash")
        stamp = [x for x in lines[3:] if x.startswith("timestamp ")]
        if len(stamp) != 1 or not re.fullmatch(r"[0-9]+", stamp[0][10:]):
            raise ValueError("checkpoint needs one 'timestamp <unix seconds>' line")
        return cls(lines[0], int(lines[1]), root, int(stamp[0][10:]))

    @classmethod
    def verify(cls, note: str, verifier: Verifier) -> Checkpoint:
        return cls.parse_body(open_note(note, verifier))


def checkpoint_hash(note: str) -> bytes:
    """What gets anchored: SHA-256 of the full signed note bytes."""
    return hashlib.sha256(note.encode()).digest()
