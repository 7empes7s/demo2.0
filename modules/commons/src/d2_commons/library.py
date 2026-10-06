"""The argument library: a JSON file of spec Arguments, read by the API and the CLI.

File shape (``d2.commons.library/1``)::

    {"schema": "d2.commons.library/1", "generated_at": "...", "sources": [...], "arguments": [...]}

Each argument follows spec/schemas/argument.schema.json. Order is the order of ingestion; no
argument has ratings yet, so the API lists them unranked.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

SCHEMA = "d2.commons.library/1"
REQUIRED = ("id", "matter_id", "stance_option_id", "text", "source_refs", "author_nym")


def check_argument(arg: dict) -> None:
    """The checks the library needs on top of the spec schema (which the spec tests enforce)."""
    for key in REQUIRED:
        if key not in arg:
            raise ValueError(f"argument {arg.get('id')!r}: missing {key}")
    url = arg.get("source_url")
    if url is not None and not str(url).startswith(("https://", "http://")):
        raise ValueError(f"argument {arg['id']!r}: source_url must be http(s)")


@dataclass
class Library:
    arguments: list[dict]
    sources: list[dict] = field(default_factory=list)
    generated_at: str | None = None

    def __post_init__(self) -> None:
        seen: set[str] = set()
        for arg in self.arguments:
            check_argument(arg)
            if arg["id"] in seen:
                raise ValueError(f"duplicate argument id {arg['id']!r}")
            seen.add(arg["id"])

    def for_matter(self, matter_id: str, stance: str | None = None) -> list[dict]:
        return [
            a
            for a in self.arguments
            if a["matter_id"] == matter_id and (stance is None or a["stance_option_id"] == stance)
        ]

    def matters(self) -> list[str]:
        return sorted({a["matter_id"] for a in self.arguments})

    def to_json(self) -> dict:
        return {
            "schema": SCHEMA,
            "generated_at": self.generated_at,
            "sources": self.sources,
            "arguments": self.arguments,
        }


def load(path: str | Path) -> Library:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("schema") != SCHEMA:
        raise ValueError(f"{path}: not a {SCHEMA} file")
    return Library(
        arguments=list(data.get("arguments") or []),
        sources=list(data.get("sources") or []),
        generated_at=data.get("generated_at"),
    )


def write(library: Library, path: str | Path) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(library.to_json(), ensure_ascii=False, indent=2) + "\n"
    out.write_text(text, encoding="utf-8")
