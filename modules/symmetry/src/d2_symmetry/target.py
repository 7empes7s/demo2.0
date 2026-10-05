"""Systems under test.

A target receives the matter, the user's position ("yes" or "no") and the user's message, and
returns the pushback text the system would show that user.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Protocol


class Target(Protocol):
    name: str

    def respond(self, matter: str, user_position: str, user_message: str) -> str: ...


class TargetError(RuntimeError):
    """The target did not return usable pushback."""


def public_name(url: str) -> str:
    """The URL without credentials, query or fragment, safe to publish in a report."""
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or ""
    if ":" in host:  # IPv6 literal
        host = f"[{host}]"
    netloc = f"{host}:{parts.port}" if parts.port else host
    return urllib.parse.urlunsplit((parts.scheme, netloc, parts.path, "", ""))


class HttpTarget:
    """POSTs `{"matter", "user_position", "user_message"}` as JSON; expects `{"pushback": str}`."""

    def __init__(self, url: str, timeout: float = 60.0, headers: dict[str, str] | None = None):
        if not url.startswith(("http://", "https://")):
            raise ValueError(f"target URL must be http(s): {url!r}")
        self.url = url
        self.name = public_name(url)
        self.timeout = timeout
        self.headers = {"Content-Type": "application/json", **(headers or {})}

    def respond(self, matter: str, user_position: str, user_message: str) -> str:
        body = json.dumps(
            {"matter": matter, "user_position": user_position, "user_message": user_message}
        ).encode("utf-8")
        req = urllib.request.Request(self.url, data=body, headers=self.headers, method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:  # noqa: S310
            payload = json.loads(resp.read().decode("utf-8"))
        pushback = payload.get("pushback") if isinstance(payload, dict) else None
        if not isinstance(pushback, str):
            raise TargetError(f"{self.url}: response has no 'pushback' text")
        return pushback


# FakeTarget embeds its intended strength in the text so FakeJudge can read it back exactly.
FAKE_MARKER = "[[strength={}]]"


class FakeTarget:
    """Deterministic test target that pushes back with a fixed strength per position."""

    def __init__(self, strength_yes: float, strength_no: float, name: str = "fake"):
        self.strength = {"yes": float(strength_yes), "no": float(strength_no)}
        self.name = name

    def respond(self, matter: str, user_position: str, user_message: str) -> str:
        s = self.strength[user_position]
        return f"{FAKE_MARKER.format(s)} Have you considered the other side of: {matter}"
