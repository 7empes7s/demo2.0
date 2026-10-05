"""Parsers for the city of Esch-sur-Alzette: its municipal council and its participation platform.

Where the data lives (recorded October 2026):
- administration.esch.lu/seances-publiques-conseil-communal/ lists the council's sessions of a
  year (?y=YYYY), each linking to a session page under /sessions_conseil/.
- A session page shows the agenda points, their documents, links to vote charts and the
  esch.tv video. The page is built from workflow.esch.lu, the city's council workflow, whose
  read-only JSON API (documented at workflow.esch.lu/api/swagger/v1/swagger.json) gives the
  same sessions and points with their status, plus each councillor's vote.
- participation.esch.lu runs on Hoplr. Its public pages are server-rendered HTML: the home page
  lists active and past projects and surveys; each survey and project page has its dates.

Only pure functions here: HTML or JSON in, plain data out. Fetching lives in snapshot.py.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

ADMIN = "https://administration.esch.lu"
API = "https://workflow.esch.lu/api/api/v1"
PARTICIPATION = "https://participation.esch.lu"

VOTES_CHART = re.compile(r"/AgendaItems/GetVotesChart/(\d+)")
POINT_NUMBER = re.compile(r"^(\d+(?:\.[0-9A-Z]+)*)\.?\s+(.*)$", re.S)
TIME_RANGE = re.compile(r"(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})")
FR_MONTHS = {
    "janv": 1,
    "janvier": 1,
    "févr": 2,
    "février": 2,
    "mars": 3,
    "avr": 4,
    "avril": 4,
    "mai": 5,
    "juin": 6,
    "juil": 7,
    "juillet": 7,
    "août": 8,
    "sept": 9,
    "septembre": 9,
    "oct": 10,
    "octobre": 10,
    "nov": 11,
    "novembre": 11,
    "déc": 12,
    "décembre": 12,
}


def _text(node: Tag | None) -> str:
    if node is None:
        return ""
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()


def iso_slash(day: str | None) -> str | None:
    """'02/10/2026' -> '2026-10-02'. None for anything else, impossible days included."""
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", (day or "").strip())
    if not m:
        return None
    d, mo, y = (int(x) for x in m.groups())
    try:
        return date(y, mo, d).isoformat()
    except ValueError:  # e.g. 31/02: not a real day, so no date rather than a crash
        return None


def iso_french(text: str | None) -> str | None:
    """'24 février 2026', '19 sept. 2026', '1er janv. 2027' -> ISO date. None if no date."""
    m = re.search(r"(\d{1,2})(?:er)?\s+([a-zéû]+)\.?\s+(\d{4})", (text or "").lower())
    if not m or m.group(2) not in FR_MONTHS:
        return None
    try:
        return date(int(m.group(3)), FR_MONTHS[m.group(2)], int(m.group(1))).isoformat()
    except ValueError:  # e.g. "32 janvier": not a real day
        return None


def time_range(text: str | None) -> tuple[str | None, str | None]:
    """'De 08:30 à 13:00' -> ('08:30', '13:00')."""
    m = TIME_RANGE.search(text or "")
    if not m:
        return None, None
    return tuple(t if len(t) == 5 else "0" + t for t in m.groups())  # type: ignore[return-value]


# --- Council: the public sessions list and session pages (administration.esch.lu) ---


@dataclass
class SessionLink:
    date: str | None
    url: str
    title: str  # e.g. "Séance Ordinaire"
    duration: str | None
    closed_duration: str | None  # huis clos, the part held behind closed doors


def sessions_url(year: int | None = None) -> str:
    base = f"{ADMIN}/seances-publiques-conseil-communal/"
    return f"{base}?y={year}" if year else base


def parse_sessions_list(html: str) -> list[SessionLink]:
    """The sessions of one year, newest first, as the public list shows them."""
    soup = BeautifulSoup(html, "html.parser")
    out: list[SessionLink] = []
    for a in soup.select('a[href*="/sessions_conseil/"]'):
        day = a.select_one(".date")
        if day is None:
            continue
        out.append(
            SessionLink(
                date=iso_slash(_text(day)),
                url=urljoin(ADMIN, a["href"]),
                title=_text(a.select_one(".title")),
                duration=_text(a.select_one(".time")) or None,
                closed_duration=_text(a.select_one(".time-closed")) or None,
            )
        )
    return out


@dataclass
class SessionPage:
    video_url: str | None
    live: bool  # True when the video link is the live stream, not a recording
    voted_item_ids: list[int] = field(default_factory=list)  # points with published votes


def parse_session_page(html: str) -> SessionPage:
    soup = BeautifulSoup(html, "html.parser")
    video = soup.select_one("a#council-session-video[href]")
    ids: list[int] = []
    for a in soup.select('a[href*="/AgendaItems/GetVotesChart/"]'):
        m = VOTES_CHART.search(a["href"])
        if m and int(m.group(1)) not in ids:
            ids.append(int(m.group(1)))
    return SessionPage(
        video_url=video["href"] if video else None,
        live="live-stream" in (video.get("class", []) if video else []),
        voted_item_ids=ids,
    )


# --- Council: the workflow API (workflow.esch.lu) ---


@dataclass
class Document:
    label: str
    url: str
    date: str | None = None
    kind: str = "other"  # ordre_du_jour, deliberation, rapport, other


@dataclass
class Session:
    id: int
    date: str | None
    title: str
    nature: str | None
    status: str | None
    announced: str | None
    convened: str | None
    duration: str | None
    closed_duration: str | None
    present: list[str]
    excused: list[str]
    documents: list[Document]


@dataclass
class Point:
    id: int
    reference: str | None
    number: str | None  # the agenda number, e.g. "6.1"; None for unnumbered points
    title: str
    order: int | None
    status: str | None  # as the city states it, e.g. "Délibéré", "En cours"
    category: str | None  # the "Rubrique", e.g. "Conventions"
    group: str | None  # the policy area, e.g. "Budget et Finances"
    closed: bool
    documents: list[Document]


def _names(value: str | None) -> list[str]:
    return [n.strip() for n in (value or "").split(";") if n.strip()]


def _doc_kind(label: str) -> str:
    low = label.lower()
    if "ordre du jour" in low:
        return "ordre_du_jour"
    if "délibération" in low or "deliberation" in low:
        return "deliberation"
    if "rapport" in low:
        return "rapport"
    return "other"


def session_document_url(session_id: int, document_id: int) -> str:
    return f"{API}/Sessions/GetDocument/{session_id}/{document_id}"


def point_document_url(item_id: int, document_id: int) -> str:
    return f"{API}/AgendaItems/GetDocument/{item_id}/{document_id}"


def sessions_api_url(year: int) -> str:
    return f"{API}/Sessions/{year}?language=fr"


def points_api_url(session_id: int) -> str:
    return f"{API}/AgendaItems/{session_id}"


def votes_api_url(item_id: int) -> str:
    return f"{API}/Votes/{item_id}"


def parse_sessions_api(raw: str) -> list[Session]:
    out = []
    for s in json.loads(raw) or []:
        if s.get("isTechnical"):
            continue
        day = iso_slash(s.get("date"))
        out.append(
            Session(
                id=s["id"],
                date=day,
                title=s.get("displayTitle") or s.get("name") or "",
                nature=s.get("nature") or None,
                status=s.get("status") or None,
                announced=iso_slash(s.get("announcement")),
                convened=iso_slash(s.get("convocation")),
                duration=s.get("sessionDuration") or None,
                closed_duration=s.get("closedSessionDuration") or None,
                present=_names(s.get("present")),
                excused=_names(s.get("excused")),
                documents=[
                    Document(
                        label=d["name"],
                        url=session_document_url(s["id"], d["id"]),
                        date=day,
                        kind=_doc_kind(d["name"]),
                    )
                    for d in s.get("publicDocuments") or []
                ],
            )
        )
    return out


def split_number(name: str) -> tuple[str | None, str]:
    """'6.1. PAP Quai Neiduerf ; décision' -> ('6.1', 'PAP Quai Neiduerf ; décision')."""
    name = re.sub(r"\s+", " ", name).strip()
    m = POINT_NUMBER.match(name)
    return (m.group(1), m.group(2).strip()) if m else (None, name)


def parse_points_api(raw: str, session_date: str | None = None) -> list[Point]:
    out = []
    for p in json.loads(raw) or []:
        number, title = split_number(p.get("name") or "")
        out.append(
            Point(
                id=p["id"],
                reference=p.get("reference") or None,
                number=number,
                title=title,
                order=p.get("order"),
                status=p.get("status") or None,
                category=p.get("category") or None,
                group=p.get("group") or None,
                closed=bool(p.get("isClosedSession")),
                documents=[
                    Document(
                        label=d["name"],
                        url=point_document_url(p["id"], d["id"]),
                        date=session_date,
                        kind=_doc_kind(d["name"]),
                    )
                    for d in p.get("publicDocuments") or []
                ],
            )
        )
    out.sort(key=lambda p: (p.order is None, p.order or 0))
    return out


def parse_votes_api(raw: str) -> dict | None:
    """Each councillor's vote on one point, with totals overall and per party."""
    rows = json.loads(raw) if raw.strip() else []
    if not isinstance(rows, list) or not rows:
        return None
    members, counts, by_party = [], {}, {}
    for r in rows:
        member = r.get("politicalMember") or {}
        name = (member.get("user") or {}).get("displayName")
        party = (member.get("politicalParty") or {}).get("name")
        vote = r.get("vote")
        members.append({"name": name, "party": party, "vote": vote})
        # JSON keys cannot be null: a missing vote or party is counted under "" (never "null")
        vote_key, party_key = vote or "", party or ""
        counts[vote_key] = counts.get(vote_key, 0) + 1
        party_counts = by_party.setdefault(party_key, {})
        party_counts[vote_key] = party_counts.get(vote_key, 0) + 1
    return {"counts": counts, "by_party": by_party, "members": members}


# --- participation.esch.lu (Hoplr) ---


@dataclass
class Consultation:
    kind: str  # "project" or "survey", from the tile's CSS class
    id: str
    url: str
    title: str
    type_label: str  # the site's own label, e.g. "Projet", "Enquête"
    status: str | None  # the section it is listed under, e.g. "Actif", "Passé"
    summary: str
    when: str | None  # the tile's time note, e.g. "Terminé le 16 juillet 2026"


TILE_ID = re.compile(r"^(project|survey)-(\w+)$")


def parse_participation_home(html: str) -> list[Consultation]:
    soup = BeautifulSoup(html, "html.parser")
    labels: dict[str, str] = {}
    for button in soup.select(".section__tab button[data-status]"):
        label = re.sub(r"\s*\(\d+\)\s*$", "", _text(button))
        labels[button["data-status"]] = label
    out: list[Consultation] = []
    seen: set[str] = set()
    for tile in soup.select(".section__item[id]"):
        m = TILE_ID.match(tile["id"])
        if not m or tile["id"] in seen:
            continue
        seen.add(tile["id"])
        section = tile.find_parent("section")
        status_key = "past" if section is not None and section.get("id") == "past" else "active"
        link = tile.select_one("a.tile__content-info-title[href]")
        meta = tile.select_one(".tile__content-info-meta")
        type_span = meta.select_one(".tile__content-info-meta-type") if meta else None
        for icon in type_span.select("i") if type_span else []:
            icon.decompose()  # Material icon names such as "folder" are text in the HTML
        type_label = _text(type_span)
        when = None
        if meta:
            notes = [_text(s) for s in meta.find_all("span", recursive=False)]
            when = next((n for n in notes if n and n != _text(type_span)), None)
        out.append(
            Consultation(
                kind=m.group(1),
                id=m.group(2),
                url=urljoin(PARTICIPATION, link["href"]) if link else PARTICIPATION,
                title=_text(link),
                type_label=type_label,
                status=labels.get(status_key),
                summary=_text(tile.select_one(".tile__content-info-description")),
                when=when,
            )
        )
    return out


@dataclass
class Phase:
    title: str
    start: str | None
    end: str | None


@dataclass
class ConsultationPage:
    start: str | None
    end: str | None
    phases: list[Phase]
    attachments: list[Document]


def parse_participation_page(html: str) -> ConsultationPage:
    """A survey's date range, or a project's phases, plus downloadable attachments."""
    soup = BeautifulSoup(html, "html.parser")
    start = iso_french(_text(soup.select_one(".date-range__start strong")))
    end = iso_french(_text(soup.select_one(".date-range__end strong")))
    phases = []
    for info in soup.select(".phase-info"):
        dates = _text(info.select_one(".phase-info__dates"))
        first, _, last = dates.partition(" - ")
        phases.append(
            Phase(
                title=_text(info.select_one(".phase-info__title")),
                start=iso_french(first),
                end=iso_french(last),
            )
        )
    if phases and start is None:
        start, end = phases[0].start, phases[-1].end
    attachments = []
    for a in soup.select("a.message-attachment[href]"):
        url = urljoin(PARTICIPATION, a["href"])
        if all(d.url != url for d in attachments):
            label = _text(a.select_one(".message-attachment__filename")) or url.rsplit("/", 1)[-1]
            attachments.append(Document(label=label, url=url))
    return ConsultationPage(start=start, end=end, phases=phases, attachments=attachments)
