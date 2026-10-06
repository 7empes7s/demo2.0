"""Build the library from Esch-sur-Alzette's public sources.

Council positions come from a Docket snapshot (no fetching). Consultation proposals come from
participation.esch.lu project pages: either recorded pages given as files, or fetched live, at
most one request every 3 seconds (the pace Docket uses for every Esch host).
"""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from collections.abc import Callable

from . import esch
from .library import Library

USER_AGENT = "Democracy2-Commons/0.1 (+https://github.com/7empes7s/demo2.0)"
ESCH_DELAY = 3.0  # minimum seconds between requests to any Esch host
ALLOWED_HOSTS = ("https://participation.esch.lu/",)
MAX_BYTES = 2 * 1024 * 1024  # a project page is about 200 KiB


class _AllowlistedRedirects(urllib.request.HTTPRedirectHandler):
    """Follows a redirect only when its target is allowlisted too, checked again on every hop."""

    def __init__(self, allowed: tuple[str, ...]) -> None:
        self.allowed = allowed

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.startswith(self.allowed):
            raise urllib.error.HTTPError(
                newurl, code, f"redirect to a host that is not allowed: {newurl}", headers, fp
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Fetcher:
    """GETs pages one at a time, never faster than one request per ``delay`` seconds."""

    def __init__(
        self,
        delay: float = ESCH_DELAY,
        timeout: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        allowed: tuple[str, ...] = ALLOWED_HOSTS,
        max_bytes: int = MAX_BYTES,
    ) -> None:
        self.delay, self.timeout = delay, timeout
        self._clock, self._sleep = clock, sleep
        self._last: float | None = None
        self.allowed, self.max_bytes = allowed, max_bytes
        self._opener = urllib.request.build_opener(_AllowlistedRedirects(allowed))

    def _open(self, url: str) -> bytes:  # seam for tests
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with self._opener.open(req, timeout=self.timeout) as res:
            body = res.read(self.max_bytes + 1)
        if len(body) > self.max_bytes:
            raise ValueError(f"response larger than {self.max_bytes} bytes: {url}")
        return body

    def get(self, url: str) -> str:
        if not url.startswith(self.allowed):
            raise ValueError(f"not an Esch participation page: {url}")
        if self._last is not None:
            wait = self._last + self.delay - self._clock()
            if wait > 0:
                self._sleep(wait)
        try:
            return self._open(url).decode("utf-8", errors="replace")
        finally:
            self._last = self._clock()


def project_urls(snapshot: dict) -> list[str]:
    """Participation project pages the Docket snapshot lists (surveys have no proposals)."""
    out = []
    for item in snapshot.get("items") or []:
        if str(item.get("id", "")).startswith("lu.esch.participation.project."):
            url = (item.get("urls") or {}).get("fr")
            if url and url not in out:
                out.append(url)
    return out


def build(
    snapshot: dict | None,
    pages: list[tuple[str, str]],
    generated_at: str,
    errors: list[dict] | None = None,
) -> Library:
    """``pages`` is a list of (page URL, HTML) for participation project pages."""
    arguments: list[dict] = []
    sources: list[dict] = []
    if snapshot is not None:
        positions = esch.positions_from_docket(snapshot)
        arguments += positions
        sources.append(
            {
                "id": "esch-council-votes",
                "from": "Docket snapshot",
                "docket_generated_at": snapshot.get("generated_at"),
                "arguments": len(positions),
            }
        )
    for url, html in pages:
        try:
            proposals = esch.proposals_from_project_page(html, url, errors)
        except ValueError as exc:
            if errors is None:
                raise
            errors.append({"url": url, "error": str(exc)})
            continue
        arguments += proposals
        sources.append({"id": "esch-participation", "url": url, "arguments": len(proposals)})
    return Library(arguments=arguments, sources=sources, generated_at=generated_at)
