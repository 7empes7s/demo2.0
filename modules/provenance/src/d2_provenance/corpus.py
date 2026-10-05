"""The records Provenance grades against, read from a Docket snapshot.

A snapshot (`d2.docket.snapshot/1` or `/2`) is plain JSON, so Provenance reads it without
importing Docket. Each item becomes:
- sentences (title, history rows, summary, document text), each with the link a reader opens;
- structured facts: the deposit date and the council vote tallies.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

from .text import sentences

SNAPSHOT_PREFIX = "d2.docket.snapshot/"
MAX_EXCERPT = 500


@dataclass(frozen=True)
class Sentence:
    item_id: str
    text: str
    url: str
    locator: str
    source_document_id: str | None = None


@dataclass
class Item:
    id: str
    number: str | None
    url: str | None
    deposited: str | None
    votes: dict[str, int] | None
    sentences: list[Sentence] = field(default_factory=list)


@dataclass
class Corpus:
    items: dict[str, Item]
    sha256: str  # of the snapshot file, so every grade names the records it was made from

    @property
    def sentence_count(self) -> int:
        return sum(len(i.sentences) for i in self.items.values())


def _http(url: object) -> str | None:
    return url if isinstance(url, str) and url.startswith(("http://", "https://")) else None


def _item_url(raw: dict) -> str | None:
    urls = raw.get("urls") or {}
    for lang in ("fr", "de", "en", "lb", "pt"):
        if _http(urls.get(lang)):
            return urls[lang]
    return next((u for u in urls.values() if _http(u)), None)


def dmy(iso: str) -> str:
    y, m, d = iso.split("-")
    return f"{d}/{m}/{y}"


def build_item(raw: dict) -> Item:
    url = _item_url(raw)
    votes = (raw.get("votes") or {}).get("counts")
    item = Item(
        id=str(raw["id"]),
        number=raw.get("number"),
        url=url,
        deposited=raw.get("deposited"),
        votes={str(k): int(v) for k, v in votes.items()} if isinstance(votes, dict) else None,
    )
    if item.deposited is None:
        created = [a for a in raw.get("activities") or [] if a.get("kind") == "Creation"]
        if created and created[0].get("date"):
            item.deposited = created[0]["date"]

    def add(text: str, link: str | None, locator: str, doc_id: str | None = None) -> None:
        text = text.strip()
        if text and link:
            item.sentences.append(Sentence(item.id, text[:MAX_EXCERPT], link, locator, doc_id))

    title = (raw.get("title") or {}).get("fr") or next(iter((raw.get("title") or {}).values()), "")
    add(title, url, "title")
    if raw.get("summary"):
        for n, s in enumerate(sentences(raw["summary"]), 1):
            add(s, url, f"summary, sentence {n}")
    for a in raw.get("activities") or []:
        if a.get("date") and a.get("description"):
            add(f"{dmy(a['date'])} {a['description']}", url, f"history, {a['date']}")
    for doc in raw.get("documents") or []:
        link = _http(doc.get("url"))
        doc_id = f"sha256:{doc['sha256']}" if doc.get("sha256") else None
        label = doc.get("label") or "document"
        for n, s in enumerate(sentences(doc.get("text") or ""), 1):
            add(s, link, f"{label}, sentence {n}", doc_id)
    return item


def load(path: str | Path) -> Corpus:
    raw_bytes = Path(path).read_bytes()
    data = json.loads(raw_bytes)
    schema = data.get("schema", "")
    if not str(schema).startswith(SNAPSHOT_PREFIX):
        raise ValueError(f"not a Docket snapshot: schema {schema!r}")
    items = {}
    for raw in data.get("items") or []:
        item = build_item(raw)
        items[item.id] = item
    return Corpus(items, hashlib.sha256(raw_bytes).hexdigest())
