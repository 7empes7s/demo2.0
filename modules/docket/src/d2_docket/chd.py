"""Parsers for www.chd.lu, the Chamber of Deputies of Luxembourg.

Only pure functions here: HTML in, plain data out. Fetching lives in fetch.py so the parsers
can be tested against recorded pages in tests/fixtures/.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

BASE = "https://www.chd.lu"
LANGS = ("fr", "de", "en", "lu")  # the site's own language codes; "lu" is Luxembourgish (lb)
DOSSIER_HREF = re.compile(r"/(?:fr|de|en|lu)/dossier/([0-9]+[A-Z]?)$")
MEETING_HREF = re.compile(r"/(?:fr|de|en|lu)/meeting/([0-9]+)$")


@dataclass
class Document:
    label: str
    url: str
    date: str | None = None  # ISO date of the activity that published it
    kind: str = "other"  # depot, avis, amendement, rapport, pv, other


@dataclass
class Activity:
    date: str | None
    kind: str  # the site's row class, e.g. Creation, Commission, Avis
    description: str
    actors: list[str]
    documents: list[Document]


@dataclass
class Dossier:
    number: str
    title: str
    type: str | None
    status: str | None
    author: str | None
    deposited: str | None
    updated: str | None
    committee: str | None
    deposit_document: Document | None
    activities: list[Activity] = field(default_factory=list)

    @property
    def documents(self) -> list[Document]:
        seen: dict[str, Document] = {}
        if self.deposit_document:
            seen[self.deposit_document.url] = self.deposit_document
        for activity in self.activities:
            for doc in activity.documents:
                seen.setdefault(doc.url, doc)
        return list(seen.values())


@dataclass
class AgendaPoint:
    text: str
    dossier: str | None
    steps: list[str]


@dataclass
class Meeting:
    id: str
    date: str | None
    time: str | None
    body: str
    location: str | None
    points: list[AgendaPoint]


def _text(node: Tag | None) -> str:
    if node is None:
        return ""
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()


def _iso(day: str | None) -> str | None:
    """'15.05.2026' -> '2026-05-15'. Returns None for anything else."""
    if not day:
        return None
    m = re.fullmatch(r"(\d{2})\.(\d{2})\.(\d{4})", day.strip())
    if not m:
        return None
    d, mo, y = (int(x) for x in m.groups())
    try:
        return date(y, mo, d).isoformat()
    except ValueError:  # e.g. 31.02.2026 or a 00.00.0000 placeholder
        return None


def _doc_kind(label: str, url: str) -> str:
    low = (label + " " + url).lower()
    if "depot" in low or "dépôt" in low:
        return "depot"
    if "avis" in low:
        return "avis"
    if "amendement" in low:
        return "amendement"
    if "rapport" in low:
        return "rapport"
    if "_pv" in low or "procès-verbal" in low:
        return "pv"
    return "other"


def parse_dossier(html: str, number: str) -> Dossier:
    soup = BeautifulSoup(html, "html.parser")
    title_p = soup.select_one("p.chd-wysiwyg.text-large")
    title = _text(title_p)

    info: dict[str, str] = {}
    for row in soup.select("dl div.row"):
        dt, dd = row.find("dt"), row.find("dd")
        if dt and dd:
            info[_text(dt)] = _text(dd)

    # dt labels are translated; the first three rows are always type, author, deposit date
    # on bills, but orientation debates have no deposit row, so look labels up per language.
    def pick(*labels: str) -> str | None:
        for label in labels:
            if info.get(label):
                return info[label]
        return None

    deposit = soup.select_one("#folder-depot a[href]")
    deposit_doc = None
    if deposit:
        url = urljoin(BASE, deposit["href"])
        deposit_doc = Document(label=_text(deposit), url=url, kind="depot")

    status = None
    badge = soup.select_one(".border.position-lg-sticky .badge")
    if badge and not _text(badge).startswith("CHD_"):  # CHD_* is an unfilled template label
        status = _text(badge)

    updated = None
    for div in soup.select(".border.position-lg-sticky div.small"):
        m = re.search(r"(\d{2}\.\d{2}\.\d{4})", _text(div))
        if m:
            updated = _iso(m.group(1))
            break

    activities: list[Activity] = []
    table = soup.select_one(".chd-table:not(.hidden) table") or soup.select_one(".chd-table table")
    if table:
        for tr in table.select("tbody tr"):
            classes = [c for c in tr.get("class", []) if c not in ("row-item", "row-active")]
            cells = {td.get("data-title"): td for td in tr.find_all("td")}
            day = _iso(_text(cells.get("Date")))
            docs = []
            for a in (cells.get("Liens et Documents") or tr).select("a[href]"):
                url = urljoin(BASE, a["href"])
                label = _text(a)
                docs.append(Document(label=label, url=url, date=day, kind=_doc_kind(label, url)))
            actor_cell = cells.get("Intervenant")
            actors = (
                [a.strip() for a in actor_cell.get_text("\n").split("\n") if a.strip()]
                if actor_cell
                else []
            )
            activities.append(
                Activity(
                    date=day,
                    kind=classes[0] if classes else "",
                    description=_text(cells.get("Description")),
                    actors=actors,
                    documents=docs,
                )
            )
    if deposit_doc and not deposit_doc.date:
        for act in activities:
            if any(d.url == deposit_doc.url for d in act.documents):
                deposit_doc.date = act.date
                break

    # The info box has no committee row; the latest referral in the history names it.
    committee = pick("Commission", "Kommission", "Committee", "Kommissioun")
    if not committee:
        for act in reversed(sorted(activities, key=lambda a: a.date or "")):
            if act.kind in ("Commission", "Commission-pressentie") and act.actors:
                committee = act.actors[0]
                break

    return Dossier(
        number=number,
        title=title,
        type=pick("Type"),
        status=status,
        author=pick("Auteur", "Autor", "Author"),
        deposited=_iso(
            pick("Date de dépôt", "Datum der Einreichung", "Date of submission", "Datum vum Depot")
        ),
        updated=updated,
        committee=committee,
        deposit_document=deposit_doc,
        activities=activities,
    )


def parse_agenda(html: str) -> list[Meeting]:
    """Meetings on the agenda page, each with its agenda points and linked dossiers."""
    soup = BeautifulSoup(html, "html.parser")
    meetings: dict[str, Meeting] = {}
    for link in soup.select("a.chd-teaserEvent[href]"):
        m = MEETING_HREF.search(link["href"])
        if not m or m.group(1) in meetings:  # the page repeats each meeting for mobile and desktop
            continue
        meeting_id = m.group(1)
        desktop = link.select_one(".chd-timeline-meeting-event-datetime_desktop")
        when = [_text(d) for d in desktop.find_all("div", recursive=False)] if desktop else []
        time_ = next((w for w in when if re.fullmatch(r"\d{2}:\d{2}", w)), None)
        day = next((_iso(w) for w in when if _iso(w)), None)
        body = _text(link.select_one(".chd-timelineCurriculum__itemTitle.h5:not(.mb-8 span)"))
        title = link.select_one("h3.chd-timelineCurriculum__itemTitle")
        body = _text(title) if title else body
        location = _text(link.select_one(".badge-location")) or None
        points: list[AgendaPoint] = []
        collapse = soup.find(id=f"collapse-reunion-{meeting_id}")
        if collapse:
            for li in collapse.select("li.chd-timelineContentList__item"):
                desc = li.select_one(".chd-timelineContentList__description")
                dossier = None
                a = desc.select_one("a[href]") if desc else None
                if a:
                    dm = DOSSIER_HREF.search(a["href"])
                    dossier = dm.group(1) if dm else None
                steps = [_text(s) for s in li.select(".chd-timelineContentList__subItem")]
                points.append(AgendaPoint(text=_text(desc), dossier=dossier, steps=steps))
        meetings[meeting_id] = Meeting(
            id=meeting_id, date=day, time=time_, body=body, location=location, points=points
        )
    return list(meetings.values())


def dossier_url(number: str, lang: str = "fr") -> str:
    return f"{BASE}/{lang}/dossier/{number}"
