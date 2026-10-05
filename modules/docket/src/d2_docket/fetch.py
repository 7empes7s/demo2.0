"""Polite HTTP fetching and PDF text extraction. Every fetched file is kept with its SHA-256."""

from __future__ import annotations

import hashlib
import io
import time
import urllib.request
from dataclasses import dataclass

USER_AGENT = "Democracy2-Docket/0.1 (+https://github.com/7empes7s/demo2.0)"


@dataclass
class Fetched:
    url: str
    fetched_at: str
    sha256: str
    mime: str
    body: bytes


class Fetcher:
    """Fetches with a fixed delay between requests and a few retries."""

    def __init__(self, delay: float = 1.0, retries: int = 3, timeout: float = 60.0):
        self.delay, self.retries, self.timeout = delay, retries, timeout
        self._last = 0.0

    def get(self, url: str) -> Fetched:
        error: Exception | None = None
        for attempt in range(self.retries):
            wait = self._last + self.delay - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    body = resp.read()
                    mime = resp.headers.get_content_type()
                self._last = time.monotonic()
                return Fetched(
                    url=url,
                    fetched_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    sha256=hashlib.sha256(body).hexdigest(),
                    mime=mime,
                    body=body,
                )
            except Exception as exc:  # network errors are retried, then raised
                error = exc
                self._last = time.monotonic()
                time.sleep(2**attempt)
        raise RuntimeError(f"could not fetch {url}: {error}")


def pdf_text(data: bytes, max_pages: int = 60) -> str:
    """Plain text of a PDF, page by page. Empty string if the PDF has no text layer."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = []
    for i, page in enumerate(reader.pages):
        if i >= max_pages:
            break
        pages.append(page.extract_text() or "")
    return "\n\n".join(p.strip() for p in pages).strip()
