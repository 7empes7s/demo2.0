"""Seed arguments from Esch-sur-Alzette's public sources, in the spec Argument shape.

Two sources, both public:

- **Council votes**, read from a Docket snapshot (`d2.docket.snapshot/2`): for each agenda point
  with a recorded vote, one `position` per council group and side ("yes" for Oui, "no" for
  Non). A group's recorded vote is an official public position. It says who took a side, not
  why, so the text never gives reasons. Councillors are not named: the group is the author.
- **Consultation contributions** on participation.esch.lu (Hoplr): each proposal a resident
  posted on a project page becomes a `proposal` for its own option of the project. The page
  shows the proposal's title and the start of its text; the author is not on the page and is
  never stored. Email addresses, phone numbers and links are removed from the text.

Only pure functions here: data in, arguments out. Fetching lives in ingest.py.
"""

from __future__ import annotations

import hashlib
import re
from html.parser import HTMLParser
from urllib.parse import urljoin

PARTICIPATION = "https://participation.esch.lu"
COUNCIL_NYM = "source:esch.lu-council"
PARTICIPATION_NYM = "source:participation.esch.lu"

# The council publishes votes in French.
SIDES = {"Oui": "yes", "Non": "no"}

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
URL = re.compile(r"(?:https?://|www\.)\S+", re.I)
# Luxembourg and international numbers: +352 621 123 456, (+352)621 357 733, 621123456, 26 12 34 56
PHONE = re.compile(r"(?:\(?\+\d{2,3}\)?[\s./-]*)?(?:\d[\s./-]?){6,}\d")
DATE = re.compile(r"^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})$")
SPACES = re.compile(r"[ \t]+")
REMOVED = "[removed]"


def _phone(m: re.Match) -> str:
    return m.group(0) if DATE.match(m.group(0)) else REMOVED


def scrub(text: str) -> str:
    """Remove contact details from a resident's text and tidy the whitespace."""
    text = EMAIL.sub(REMOVED, text)
    text = URL.sub(REMOVED, text)
    text = PHONE.sub(_phone, text)
    lines = [SPACES.sub(" ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _arg_id(*parts: str) -> str:
    return "esch-" + hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:16]


def _meeting_date(item: dict) -> str | None:
    for entry in item.get("agenda") or []:
        if entry.get("date"):
            return entry["date"]
    return None


def _source_url(item: dict) -> str | None:
    urls = item.get("urls") or {}
    return urls.get("fr") or next(iter(urls.values()), None)


def positions_from_docket(snapshot: dict) -> list[dict]:
    """One position per council group and side for every Esch point with a recorded vote."""
    out: list[dict] = []
    for item in snapshot.get("items") or []:
        votes = item.get("votes") or {}
        by_party = votes.get("by_party") or {}
        url = _source_url(item)
        if item.get("jurisdiction_id") != "lu-esch" or not by_party or not url:
            continue
        date = _meeting_date(item)
        when = f" on {date}" if date else ""
        for party in sorted(by_party):
            if not party:
                continue  # a vote without a group cannot be attributed
            for vote, count in sorted(by_party[party].items()):
                side = SIDES.get(vote)
                if side is None or not count:
                    continue  # abstentions and blank votes take no side
                verb = "in favour" if side == "yes" else "against"
                noun = "councillor" if count == 1 else "councillors"
                out.append(
                    {
                        "id": _arg_id(item["id"], party, side),
                        "matter_id": item["id"],
                        "stance_option_id": side,
                        "text": (
                            f"{party}: {count} {noun} voted {verb} at the Esch-sur-Alzette "
                            f"municipal council{when}."
                        ),
                        "source_refs": [item["id"]],
                        "author_nym": COUNCIL_NYM,
                        "cluster_id": None,
                        "kind": "position",
                        "attribution": f"{party} group, Esch-sur-Alzette municipal council",
                        "source_url": url,
                    }
                )
    return out


class _Markers(HTMLParser):
    """Collects each proposal tile (`div.js-marker`) on a Hoplr project page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tiles: list[dict] = []
        self._depth = 0  # nesting depth inside the current marker, 0 when outside
        self._in_text = 0  # nesting depth inside its text block
        self._text: list[str] = []
        self.og_url: str | None = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and a.get("property") == "og:url":
            self.og_url = a.get("content")
        classes = (a.get("class") or "").split()
        if self._depth == 0:
            if tag == "div" and "js-marker" in classes and a.get("data-id"):
                self._depth = 1
                self._text = []
                self.tiles.append({"id": a["data-id"], "title": a.get("data-title") or ""})
            return
        if tag == "div":
            self._depth += 1
            if self._in_text:
                self._in_text += 1
            elif "project-map-shout__text" in classes:
                self._in_text = 1
        if tag == "a" and "content-link" in classes and a.get("href"):
            self.tiles[-1]["href"] = a["href"]
        if self._in_text and tag in ("p", "li", "br"):
            self._text.append("\n")

    def handle_endtag(self, tag):
        if self._depth and tag == "div":
            if self._in_text:
                self._in_text -= 1
            self._depth -= 1
            if self._depth == 0:
                self.tiles[-1]["text"] = "".join(self._text)

    def handle_data(self, data):
        if self._in_text:
            self._text.append(data)


PROJECT_PATH = re.compile(r"/proje?t?/(\d+)(?:/|$)")


def project_matter_id(page_url: str) -> str | None:
    """The Docket item id of a project page, e.g. lu.esch.participation.project.650."""
    m = PROJECT_PATH.search(page_url)
    return f"lu.esch.participation.project.{m.group(1)}" if m else None


def proposals_from_project_page(html: str, page_url: str) -> list[dict]:
    """Each proposal on a participation project page, as a `proposal` argument for itself."""
    parser = _Markers()
    parser.feed(html)
    parser.close()
    canonical = urljoin(PARTICIPATION, parser.og_url) if parser.og_url else page_url
    matter_id = project_matter_id(canonical) or project_matter_id(page_url)
    if matter_id is None:
        raise ValueError(f"not a participation project page: {page_url}")
    out: list[dict] = []
    seen: set[str] = set()
    for tile in parser.tiles:
        if tile["id"] in seen or not tile.get("href"):
            continue
        seen.add(tile["id"])
        title = scrub(tile["title"]).replace("\n", " ")
        body = scrub(tile.get("text") or "")
        text = f"{title}: {body}" if title and body else title or body
        if not text:
            continue
        out.append(
            {
                "id": _arg_id(matter_id, tile["id"]),
                "matter_id": matter_id,
                "stance_option_id": f"{matter_id}.proposal.{tile['id']}",
                "text": text,
                "source_refs": [matter_id],
                "author_nym": PARTICIPATION_NYM,
                "cluster_id": None,
                "kind": "proposal",
                "attribution": "A resident, on the city's participation platform",
                "source_url": urljoin(PARTICIPATION, tile["href"]),
            }
        )
    return out
