"""Who is acting: the participant interface Agora needs from an identity module.

Agora never sees a person. It sees a per-context pseudonym (`nym`): the same participant in the
same context always gets the same nym, and nyms from different contexts cannot be linked
(docs/architecture/02-protocols.md, section 1). Door will derive it from an anonymous credential
presentation. Door does not exist yet, so v1 ships `KeyedNyms`, which derives the nym from the
caller's participant id with a server key. That is enough to enforce one upvote per nym and to
keep the participant id out of published ideas, but not one upvote per human: anyone who can
reach the API can invent participant ids. Run it on loopback only, behind a caller that issues
the participant ids, until a Door-backed `NymSource` replaces it.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
from pathlib import Path
from typing import Protocol

_OPAQUE = re.compile(r"[A-Za-z0-9_-]{16,128}")
KEY_FILE_ENV = "AGORA_NYM_KEY_FILE"
MIN_KEY_BYTES = 32
# Public and therefore worthless as a secret: only for `d2-agora serve --dev-insecure-key`.
DEV_KEY = b"d2-agora development key, never use outside a laptop"


class InvalidParticipant(ValueError):
    code = "invalid_participant"


class MissingKey(ValueError):
    """No usable nym key was configured."""


class NymSource(Protocol):
    def nym(self, participant: str, context_id: str) -> str:
        """The participant's pseudonym in `context_id`. Raise InvalidParticipant if not valid."""
        ...


class KeyedNyms:
    """Development stand-in for Door: nym = HMAC-SHA256(key, context_id NUL participant),
    base32, 26 characters, prefixed `nym-`.

    The participant must be 16 to 128 characters of A-Z, a-z, 0-9, `_` or `-`, so an email
    address, a name or a phone number is rejected rather than stored. The participant id itself
    is never stored or published, and the nym differs per context, so a proposer's ideas in two
    areas cannot be linked by their nyms. The key never goes in git: load it with `from_file` or
    `from_env`.
    """

    def __init__(self, key: bytes) -> None:
        if not isinstance(key, bytes) or len(key) < MIN_KEY_BYTES:
            raise MissingKey(f"the nym key must be at least {MIN_KEY_BYTES} bytes")
        self._key = key

    @classmethod
    def from_file(cls, path: str | Path) -> KeyedNyms:
        try:
            key = Path(path).read_bytes().strip()
        except OSError as exc:
            raise MissingKey(f"cannot read the nym key file: {exc.strerror}") from exc
        return cls(key)

    @classmethod
    def from_env(cls) -> KeyedNyms:
        path = os.environ.get(KEY_FILE_ENV)
        if not path:
            raise MissingKey(f"no nym key: set {KEY_FILE_ENV} to a file of at least 32 bytes")
        return cls.from_file(path)

    def nym(self, participant: str, context_id: str) -> str:
        if not isinstance(participant, str) or not _OPAQUE.fullmatch(participant):
            raise InvalidParticipant(
                "participant must be an opaque id: 16-128 characters of A-Z a-z 0-9 _ -"
            )
        mac = hmac.new(self._key, f"{context_id}\0{participant}".encode(), hashlib.sha256)
        return "nym-" + base64.b32encode(mac.digest()).decode().lower()[:26]
