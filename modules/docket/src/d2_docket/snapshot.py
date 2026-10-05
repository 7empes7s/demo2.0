"""Build the Docket snapshot the citizen app reads: what the Chamber of Deputies and the
Esch-sur-Alzette council are deciding now, and what Esch is consulting residents on."""

from __future__ import annotations

import json
import time
from dataclasses import asdict
from datetime import date
from pathlib import Path

from . import chd, esch
from .fetch import Fetcher, pdf_text

SCHEMA = "d2.docket.snapshot/2"
SOURCES = ("chd", "esch")
TEXT_KINDS = ("depot", "avis", "rapport", "amendement")  # procès-verbaux are skipped
CHARS = {"depot": 40_000, "avis": 15_000, "rapport": 20_000, "amendement": 10_000}
BILL_TYPES = ("projet de loi", "proposition de loi", "gesetzprojet")
ESCH_COUNCIL = "Conseil communal d'Esch-sur-Alzette"


def item_type(type_label: str | None) -> str:
    low = (type_label or "").lower()
    return "bill" if any(t in low for t in BILL_TYPES) else "other"


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _link_only(doc) -> dict:
    """A document listed by URL only: not fetched, so no hash or text yet."""
    return {**asdict(doc), "sha256": None, "fetched_at": None, "text": "", "truncated": False}


# --- Chamber of Deputies ---


def build_item(dossier: chd.Dossier, meetings: list[chd.Meeting], documents: list[dict]) -> dict:
    upcoming = [
        {
            "meeting_id": m.id,
            "date": m.date,
            "time": m.time,
            "body": m.body,
            "steps": p.steps,
        }
        for m in meetings
        for p in m.points
        if p.dossier == dossier.number
    ]
    return {
        "id": f"lu.chd.{dossier.number}",
        "source": "chd.lu",
        "jurisdiction_id": "lu",
        "number": dossier.number,
        "type": item_type(dossier.type),
        "type_label": dossier.type,
        "title": {"fr": dossier.title},
        "status": dossier.status,
        "author": dossier.author,
        "committee": dossier.committee,
        "deposited": dossier.deposited,
        "updated": dossier.updated,
        "urls": {
            lang if lang != "lu" else "lb": chd.dossier_url(dossier.number, lang)
            for lang in chd.LANGS
        },
        "agenda": upcoming,
        "activities": [asdict(a) for a in dossier.activities],
        "documents": documents,
    }


def fetch_documents(fetcher: Fetcher, dossier: chd.Dossier, limit: int = 8) -> list[dict]:
    out = []
    for doc in [d for d in dossier.documents if d.kind in TEXT_KINDS][:limit]:
        entry = _link_only(doc)
        try:
            got = fetcher.get(doc.url)
            entry["sha256"], entry["fetched_at"] = got.sha256, got.fetched_at
            text = (
                pdf_text(got.body)
                if got.mime == "application/pdf" or doc.url.lower().endswith(".pdf")
                else ""
            )
            limit_chars = CHARS.get(doc.kind, 10_000)
            entry["truncated"] = len(text) > limit_chars
            entry["text"] = text[:limit_chars]
        except Exception as exc:  # one broken document must not sink the snapshot
            entry["error"] = str(exc)[:300]
        out.append(entry)
    return out


def build_chd(fetcher: Fetcher, max_items: int = 40) -> dict:
    agenda_page = fetcher.get(f"{chd.BASE}/fr/agenda")
    meetings = chd.parse_agenda(agenda_page.body.decode("utf-8", "replace"))
    numbers: list[str] = []
    for m in meetings:
        for p in m.points:
            if p.dossier and p.dossier not in numbers:
                numbers.append(p.dossier)
    items, errors = [], []
    for number in numbers[:max_items]:
        try:
            page = fetcher.get(chd.dossier_url(number, "fr"))
            dossier = chd.parse_dossier(page.body.decode("utf-8", "replace"), number)
            items.append(build_item(dossier, meetings, fetch_documents(fetcher, dossier)))
        except Exception as exc:
            errors.append({"source": "chd.lu", "number": number, "error": str(exc)[:300]})
    return {
        "source": {
            "id": "chd",
            "name": "Chambre des Députés",
            "url": f"{chd.BASE}/fr/agenda",
            "sha256": agenda_page.sha256,
        },
        "meetings": [{"source": "chd.lu", **asdict(m)} for m in meetings],
        "items": items,
        "errors": errors,
    }


# --- Esch-sur-Alzette ---


def esch_meeting(
    session: esch.Session,
    link: esch.SessionLink | None,
    page: esch.SessionPage | None,
    points: list[esch.Point],
) -> dict:
    start, end = esch.time_range(session.duration)
    return {
        "source": "esch.lu",
        "id": f"esch-{session.id}",
        "date": session.date,
        "time": start,
        "end_time": end,
        "body": ESCH_COUNCIL,
        "location": None,  # the city does not state it per session
        "title": session.title,
        "nature": session.nature,
        "closed_part": session.closed_duration,
        "announced": session.announced,
        "convened": session.convened,
        "present": session.present,
        "excused": session.excused,
        "url": link.url if link else None,
        "video_url": page.video_url if page and not page.live else None,
        "live_url": page.video_url if page and page.live else None,
        "documents": [_link_only(d) for d in session.documents],
        "points": [{"text": p.title, "dossier": None, "steps": []} for p in points],
    }


def esch_point_item(meeting: dict, point: esch.Point, votes: dict | None) -> dict:
    return {
        "id": f"lu.esch.{point.id}",
        "source": "esch.lu",
        "jurisdiction_id": "lu-esch",
        "number": point.number,
        "type": "agenda",
        "type_label": point.category,
        "title": {"fr": point.title},
        "status": point.status,
        "author": None,
        "committee": None,
        "deposited": None,
        "updated": None,
        "urls": {"fr": meeting["url"]} if meeting["url"] else {},
        "agenda": [
            {
                "meeting_id": meeting["id"],
                "date": meeting["date"],
                "time": meeting["time"],
                "body": meeting["body"],
                "steps": [],
            }
        ],
        "activities": [],
        "documents": [_link_only(d) for d in point.documents],
        "reference": point.reference,
        "theme": point.group,
        "votes": votes,
    }


def esch_consultation_item(c: esch.Consultation, page: esch.ConsultationPage | None) -> dict:
    return {
        "id": f"lu.esch.participation.{c.kind}.{c.id}",
        "source": "esch.lu",
        "jurisdiction_id": "lu-esch",
        "number": None,
        "type": "other",
        "type_label": c.type_label,
        "title": {"fr": c.title},
        "status": c.status,
        "author": None,
        "committee": None,
        "deposited": None,
        "updated": None,
        "urls": {"fr": c.url},
        "agenda": [],
        "activities": [],
        "documents": [_link_only(d) for d in page.attachments] if page else [],
        "summary": c.summary,
        "when": c.when,
        "opens": page.start if page else None,
        "closes": page.end if page else None,
        "phases": [asdict(p) for p in page.phases] if page else [],
    }


def pick_sessions(sessions: list[esch.Session], today: date, past: int = 1) -> list[esch.Session]:
    """Every session from today on, plus the most recent `past` ones before today."""
    dated = sorted((s for s in sessions if s.date), key=lambda s: s.date or "")
    upcoming = [s for s in dated if s.date >= today.isoformat()]
    before = [s for s in dated if s.date < today.isoformat()]
    return (before[-past:] if past else []) + upcoming


def _text(fetcher: Fetcher, url: str) -> str:
    return fetcher.get(url).body.decode("utf-8", "replace")


def build_esch(fetcher: Fetcher, today: date | None = None, past_sessions: int = 1) -> dict:
    today = today or date.today()
    errors: list[dict] = []
    list_page = fetcher.get(esch.sessions_url(today.year))
    links = esch.parse_sessions_list(list_page.body.decode("utf-8", "replace"))
    sessions = esch.parse_sessions_api(_text(fetcher, esch.sessions_api_url(today.year)))
    earlier = [s for s in sessions if s.date and s.date < today.isoformat()]
    if len(earlier) < past_sessions:
        # early in the year: the last sessions before today are in the previous year's list
        links += esch.parse_sessions_list(_text(fetcher, esch.sessions_url(today.year - 1)))
        sessions += esch.parse_sessions_api(_text(fetcher, esch.sessions_api_url(today.year - 1)))
    by_date = {link.date: link for link in links if link.date}

    meetings, items = [], []
    for session in pick_sessions(sessions, today, past_sessions):
        link = by_date.get(session.date)
        page, points = None, []
        try:
            if link:
                page = esch.parse_session_page(_text(fetcher, link.url))
            points = esch.parse_points_api(
                _text(fetcher, esch.points_api_url(session.id)), session.date
            )
        except Exception as exc:
            errors.append({"source": "esch.lu", "session": session.id, "error": str(exc)[:300]})
        meeting = esch_meeting(session, link, page, points)
        meetings.append(meeting)
        voted = set(page.voted_item_ids) if page else set()
        for point in points:
            if point.closed:
                continue
            votes = None
            if point.id in voted:
                try:
                    votes = esch.parse_votes_api(_text(fetcher, esch.votes_api_url(point.id)))
                except Exception as exc:
                    errors.append({"source": "esch.lu", "point": point.id, "error": str(exc)[:300]})
            items.append(esch_point_item(meeting, point, votes))

    try:
        home = esch.parse_participation_home(_text(fetcher, esch.PARTICIPATION + "/"))
    except Exception as exc:
        home = []
        errors.append({"source": "participation.esch.lu", "error": str(exc)[:300]})
    for consultation in home:
        page = None
        try:
            page = esch.parse_participation_page(_text(fetcher, consultation.url))
        except Exception as exc:
            error = {"source": "participation.esch.lu", "url": consultation.url}
            errors.append({**error, "error": str(exc)[:300]})
        items.append(esch_consultation_item(consultation, page))

    return {
        "source": {
            "id": "esch",
            "name": "Ville d'Esch-sur-Alzette",
            "url": esch.sessions_url(),
            "sha256": list_page.sha256,
        },
        "meetings": meetings,
        "items": items,
        "errors": errors,
    }


# --- The snapshot ---


def build(
    fetcher: Fetcher,
    max_items: int = 40,
    sources: tuple[str, ...] = SOURCES,
    today: date | None = None,
    esch_past_sessions: int = 1,
) -> dict:
    parts = []
    for source in sources:
        try:
            if source == "chd":
                parts.append(build_chd(fetcher, max_items=max_items))
            elif source == "esch":
                parts.append(build_esch(fetcher, today=today, past_sessions=esch_past_sessions))
            else:
                raise ValueError(f"unknown source {source!r}; known: {', '.join(SOURCES)}")
        except ValueError:
            raise
        except Exception as exc:  # one unreachable site must not sink the other sources
            parts.append(
                {
                    "source": {"id": source},
                    "meetings": [],
                    "items": [],
                    "errors": [{"source": source, "error": str(exc)[:300]}],
                }
            )
    return {
        "schema": SCHEMA,
        "generated_at": _now(),
        "sources": [p["source"] for p in parts],
        "meetings": [m for p in parts for m in p["meetings"]],
        "items": [i for p in parts for i in p["items"]],
        "errors": [e for p in parts for e in p["errors"]],
    }


def write(snapshot: dict, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
