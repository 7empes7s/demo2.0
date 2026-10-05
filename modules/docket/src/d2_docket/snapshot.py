"""Build the Docket snapshot the citizen app reads: what is on the Chamber's agenda now."""

from __future__ import annotations

import json
import time
from dataclasses import asdict
from pathlib import Path

from . import chd
from .fetch import Fetcher, pdf_text

SCHEMA = "d2.docket.snapshot/1"
TEXT_KINDS = ("depot", "avis", "rapport", "amendement")  # procès-verbaux are skipped
CHARS = {"depot": 40_000, "avis": 15_000, "rapport": 20_000, "amendement": 10_000}
BILL_TYPES = ("projet de loi", "proposition de loi", "gesetzprojet")


def item_type(type_label: str | None) -> str:
    """bill, debate or other (the values spec/schemas/source-item allows for Chamber dossiers)."""
    low = (type_label or "").lower()
    if any(t in low for t in BILL_TYPES):
        return "bill"
    if "débat" in low or "debatt" in low:
        return "debate"
    return "other"


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
        entry = {**asdict(doc), "sha256": None, "fetched_at": None, "text": "", "truncated": False}
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


def build(fetcher: Fetcher, max_items: int = 40) -> dict:
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
            errors.append({"number": number, "error": str(exc)[:300]})
    return {
        "schema": SCHEMA,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": {
            "name": "Chambre des Députés",
            "url": f"{chd.BASE}/fr/agenda",
            "sha256": agenda_page.sha256,
        },
        "meetings": [asdict(m) for m in meetings],
        "items": items,
        "errors": errors,
    }


def write(snapshot: dict, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
