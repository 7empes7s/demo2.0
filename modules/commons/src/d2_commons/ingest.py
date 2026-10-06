"""Build the library from Esch-sur-Alzette's public sources.

Council positions come from a Docket snapshot (no fetching). Consultation proposals come from
participation.esch.lu project pages: either recorded pages given as files, or fetched live, at
most one request every 3 seconds (the pace Docket uses for every Esch host).
"""

from __future__ import annotations

import time
import urllib.request
from collections.abc import Callable

from . import esch
from .library import Library

USER_AGENT = "Democracy2-Commons/0.1 (+https://github.com/7empes7s/demo2.0)"
ESCH_DELAY = 3.0  # minimum seconds between requests to any Esch host
ALLOWED_HOSTS = ("https://participation.esch.lu/",)


class Fetcher:
    """GETs pages one at a time, never faster than one request per ``delay`` seconds."""

    def __init__(
        self,
        delay: float = ESCH_DELAY,
        timeout: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.delay, self.timeout = delay, timeout
        self._clock, self._sleep = clock, sleep
        self._last: float | None = None

    def _open(self, url: str) -> bytes:  # seam for tests
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=self.timeout) as res:
            return res.read()

    def get(self, url: str) -> str:
        if not url.startswith(ALLOWED_HOSTS):
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
            proposals = esch.proposals_from_project_page(html, url)
        except ValueError as exc:
            if errors is None:
                raise
            errors.append({"url": url, "error": str(exc)})
            continue
        arguments += proposals
        sources.append({"id": "esch-participation", "url": url, "arguments": len(proposals)})
    return Library(arguments=arguments, sources=sources, generated_at=generated_at)
