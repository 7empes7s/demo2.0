"""Who is acting: the participant interface Agora needs from an identity module.

Agora never sees a person. It sees a per-context pseudonym (`nym`): the same participant in the
same context always gets the same nym, and nyms from different contexts cannot be linked
(docs/architecture/02-protocols.md, section 1).

- `DoorNyms` is the real source: the participant is a Door presentation (an anonymous credential
  proof made for the context `agora:<jurisdiction>` and for a one-time challenge Agora issued),
  checked by the Door verifier service over HTTP (`DOOR_URL`). One credential per adult resident
  per epoch, so one upvote per human per idea.
- `KeyedNyms` is the development stand-in: it derives the nym from the caller's participant id
  with a server key. One upvote per nym, not per human: anyone who can reach the API can invent
  participant ids. Development only (`d2-agora serve --dev-identity`).
- `ReadOnly` takes no identity at all: every post and upvote is refused (`--read-only`).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

_OPAQUE = re.compile(r"[A-Za-z0-9_-]{16,128}")
_NYM = re.compile(r"nym-[a-z2-7]{26}")
_HEX = re.compile(r"[0-9a-f]{2,128}")
KEY_FILE_ENV = "AGORA_NYM_KEY_FILE"
MIN_KEY_BYTES = 32
# Public and therefore worthless as a secret: only for `d2-agora serve --dev-insecure-key`.
DEV_KEY = b"d2-agora development key, never use outside a laptop"
log = logging.getLogger("d2_agora")


class IdentityError(ValueError):
    """The participant could not be turned into a nym. `code` is machine-readable; `status` is
    the HTTP status the API answers with."""

    code = "invalid_participant"
    status = 400

    def __init__(self, message: str, code: str | None = None, status: int | None = None) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code
        if status is not None:
            self.status = status


class InvalidParticipant(IdentityError):
    """Bad input: not a presentation, a malformed one, or an unknown or used challenge (400)."""


class Refused(IdentityError):
    """A well-formed presentation that does not give the right to act here (403): the proof
    fails, it was made for another context or challenge, the holder is not an adult, or the
    disclosed jurisdiction does not cover the idea's."""

    status = 403


class Unavailable(IdentityError):
    """The Door verifier cannot be reached or answered nonsense (503). Writes fail closed."""

    code = "door_unavailable"
    status = 503


class MissingKey(ValueError):
    """Identity is not configured: no usable nym key, or a bad Door setting."""


class NymSource(Protocol):
    def nym(self, participant: Any, context_id: str) -> str:
        """The participant's pseudonym in `context_id`. Raise an IdentityError if not valid."""
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

    kind = "dev"

    def __init__(self, key: bytes) -> None:
        if not isinstance(key, bytes) or len(key) < MIN_KEY_BYTES:
            raise MissingKey(f"the nym key must be at least {MIN_KEY_BYTES} bytes")
        self._key = key

    @classmethod
    def from_file(cls, path: str | Path) -> KeyedNyms:
        try:
            key = Path(path).read_bytes()
        except OSError as exc:
            raise MissingKey(f"cannot read the nym key file: {exc.strerror}") from exc
        # The key is raw bytes: only the one newline an editor or `echo` adds is dropped, so a
        # random key that starts or ends with a whitespace byte keeps it. A base64 text key
        # (ops/deploy/README.md) is used as it stands, its characters as the key bytes.
        return cls(key.removesuffix(b"\n"))

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


class ReadOnly:
    """No identity: Agora serves reads, and every post and upvote is refused (403 `read_only`).
    For a deployment that has no Door yet (`d2-agora serve --read-only`)."""

    kind = "none"

    def nym(self, participant: Any, context_id: str) -> str:
        raise IdentityError("this Agora is read only", "read_only", 403)


class Challenges:
    """One-time challenges for Door presentations: random 32 bytes, lowercase hex, valid for
    `ttl` seconds and usable once. A presentation signs the challenge into its proof, so a
    captured presentation cannot be replayed once its challenge is used or expired.

    In memory, bounded to `max_outstanding`. When full, expired challenges are dropped and, if
    it is still full, `issue` refuses (503 `challenge_capacity`) rather than dropping a live
    challenge, so a flood of `GET /challenge` cannot cancel challenges already handed out. It
    can still use up the capacity for new ones: rate-limit `GET /challenge` per client at the
    edge. A restart drops them all, which only makes clients ask again.
    """

    def __init__(
        self,
        ttl: float = 120.0,
        max_outstanding: int = 10_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.ttl = ttl
        self._max = max_outstanding
        self._clock = clock
        self._lock = threading.Lock()
        self._open: OrderedDict[str, float] = OrderedDict()  # challenge -> expiry, oldest first

    def issue(self) -> dict[str, Any]:
        challenge = secrets.token_hex(32)
        now = self._clock()
        with self._lock:
            while self._open and next(iter(self._open.values())) <= now:
                self._open.popitem(last=False)
            if len(self._open) >= self._max:
                raise Unavailable(
                    "too many open challenges: try again shortly", "challenge_capacity"
                )
            self._open[challenge] = now + self.ttl
        return {"challenge": challenge, "expires_in": int(self.ttl)}

    def consume(self, challenge: Any) -> str:
        """Use `challenge` up. Raises InvalidParticipant if it was never issued, is used or
        has expired."""
        if not isinstance(challenge, str) or not _HEX.fullmatch(challenge):
            raise InvalidParticipant("the presentation has no valid challenge", "unknown_challenge")
        with self._lock:
            expiry = self._open.pop(challenge, None)
        if expiry is None or expiry <= self._clock():
            raise InvalidParticipant(
                "unknown, used or expired challenge: ask GET /challenge for a new one",
                "unknown_challenge",
            )
        return challenge


def _post_json(url: str, body: dict[str, Any], timeout: float) -> tuple[int, Any]:
    """POST JSON, return (status, parsed body). Raises OSError or ValueError on failure."""
    data = json.dumps(body).encode()
    request = urllib.request.Request(
        url, data=data, method="POST", headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            return response.status, json.loads(response.read(64 * 1024))
    except urllib.error.HTTPError as exc:
        with exc:
            return exc.code, json.loads(exc.read(64 * 1024))


class DoorNyms:
    """Nyms from Door presentations, checked by the Door verifier service (`d2-door serve`).

    The participant is a Door `Presentation` (a JSON object) made for the context
    `agora:<jurisdiction_id>`, answering a challenge from `challenges`, and disclosing the
    adult flag and as many jurisdiction levels as the idea's jurisdiction has in Charter. A raw
    participant id is refused (`presentation_required`). Then:

    1. the challenge is used up (single use, short-lived), before Door is even asked;
    2. Door checks the proof against the issuer key of the one epoch Agora accepts (`epoch`):
       a holder with credentials for two epochs would otherwise have two nyms per context;
    3. Agora requires `adult` true and the disclosed jurisdiction path to start with the idea's
       jurisdiction path (Charter ids, root first), so a resident can act only in the areas
       their credential says they live in;
    4. the nym is Door's short form of the per-context pseudonym. Nothing else of the
       presentation is kept.

    Door unreachable, slow (`timeout`) or answering nonsense is `Unavailable` (503): writes
    fail closed.
    """

    kind = "door"

    def __init__(
        self,
        url: str,
        epoch: int,
        charter: Any = None,
        challenges: Challenges | None = None,
        timeout: float = 5.0,
        post: Callable[[str, dict[str, Any], float], tuple[int, Any]] = _post_json,
    ) -> None:
        if not isinstance(url, str) or not url.startswith(("http://", "https://")):
            raise MissingKey("DOOR_URL must be an http(s) URL")
        if isinstance(epoch, bool) or not isinstance(epoch, int) or not 0 <= epoch < 2**32:
            raise MissingKey("the Door epoch must be a whole number")
        if charter is None:
            import d2_charter

            charter = d2_charter.load()
        self.url = url.rstrip("/") + "/presentations/verify"
        self.epoch = epoch
        self.charter = charter
        self.challenges = challenges or Challenges()
        self.timeout = timeout
        self._post = post

    def challenge(self) -> dict[str, Any]:
        return self.challenges.issue()

    def nym(self, participant: Any, context_id: str) -> str:
        if not isinstance(participant, dict):
            raise InvalidParticipant(
                "send a Door presentation, not a participant id", "presentation_required"
            )
        if not context_id.startswith("agora:"):
            raise InvalidParticipant("not an Agora context", "invalid_context")
        try:
            jurisdiction = self.charter.jurisdiction_path(context_id.removeprefix("agora:"))
        except ValueError as exc:  # CharterError
            raise InvalidParticipant(str(exc), getattr(exc, "code", "invalid_context")) from exc
        self.challenges.consume(participant.get("challenge"))
        try:
            status, answer = self._post(
                self.url,
                {
                    "presentation": participant,
                    "context": context_id,
                    "challenge": participant["challenge"],
                    "epoch": self.epoch,
                    "require": {"jurisdiction_levels": len(jurisdiction), "adult": True},
                },
                self.timeout,
            )
        except (OSError, ValueError) as exc:  # unreachable, timeout, not JSON
            raise Unavailable("the Door verifier is unavailable") from exc
        code = answer.get("code") if isinstance(answer, dict) else None
        valid_code = isinstance(code, str) and re.fullmatch(r"[a-z_]{1,40}", code)
        if status == 400 and code == "malformed":
            # The presentation itself does not parse: the client's fault.
            raise InvalidParticipant("Door refused the presentation: malformed", code)
        if status == 400:
            # Door found the rest of Agora's request bad (say a Charter path deeper than Door's
            # levels): a server problem, not the user's. Log Door's code only, nothing else.
            log.error("Door answered 400 %s to Agora's request", code if valid_code else "?")
            raise Unavailable("the Door verifier is unavailable")
        if status == 422 and valid_code:
            # Door's own reason: context_mismatch, challenge_mismatch, invalid_proof, malformed...
            raise Refused(f"Door refused the presentation: {code}", code)
        if status != 200 or not isinstance(answer, dict):
            raise Unavailable("the Door verifier is unavailable")
        nym = answer.get("nym")
        disclosed = answer.get("disclosed")
        if not isinstance(nym, str) or not _NYM.fullmatch(nym) or not isinstance(disclosed, dict):
            raise Unavailable("the Door verifier gave an answer Agora cannot read")
        if disclosed.get("adult") is not True:
            raise Refused("only adults can post or upvote", "not_adult")
        path = disclosed.get("jurisdiction_path")
        levels = path.split(".") if isinstance(path, str) else []
        if levels[: len(jurisdiction)] != jurisdiction:
            raise Refused(
                "the credential does not place you in this jurisdiction",
                "jurisdiction_not_covered",
            )
        return nym
