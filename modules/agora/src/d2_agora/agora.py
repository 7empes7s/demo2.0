"""Ideas, upvotes and the ranked queue, kept in one append-only SQLite file.

Rules (docs/architecture/01-modules.md section 11, Phase 2 criteria in 00-overview.md section 7):
- An idea's tier comes from Scope (d2_charter) applied to its jurisdiction and topics. The request
  cannot carry a tier: any field outside the documented ones is rejected, and nothing can change
  an idea after it is stored (database triggers refuse UPDATE and DELETE).
- One upvote per (idea, nym). A second one is refused, not merged.
- Upvote counts stay hidden for Charter `agora.upvote_hidden_hours` after an idea is posted.
  While hidden the count is null and the idea ranks as if it had none, so its position does not
  leak the count either.
- The queue order is total and deterministic: see `rank_key`.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from collections.abc import Callable, Iterable, Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import d2_charter
from d2_charter import CharterError

from .identity import InvalidParticipant, NymSource, OpaqueNyms

LANGS = ("lb", "fr", "de", "en", "pt")
LIMITS = {
    "title_chars": 200,  # per language
    "text_chars": 4000,  # per language
    "topics": 8,
    "queue_jurisdictions": 20,
    "queue_limit": 500,
}
IDEA_FIELDS = {"participant", "jurisdiction_id", "topic_ids", "title", "text"}
_TOPIC = re.compile(r"[a-z0-9_]{1,32}(\.[a-z0-9_]{1,32}){0,5}")
_JURISDICTION = re.compile(r"[a-z0-9-]{1,64}")
# C0 controls except tab and newline, DEL, C1 controls, and bidi overrides that can disguise text.
_BAD_CHARS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f‪-‮⁦-⁩]")
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

SCHEMA = """
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  jurisdiction_id TEXT NOT NULL,
  topic_ids TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  proposer_nym TEXT NOT NULL,
  created_at TEXT NOT NULL,
  scope_tier TEXT NOT NULL,
  charter_version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS upvotes (
  idea_id TEXT NOT NULL REFERENCES ideas(id),
  voter_nym TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (idea_id, voter_nym)
);
CREATE TRIGGER IF NOT EXISTS ideas_append_only_u BEFORE UPDATE ON ideas
  BEGIN SELECT RAISE(ABORT, 'agora is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ideas_append_only_d BEFORE DELETE ON ideas
  BEGIN SELECT RAISE(ABORT, 'agora is append-only'); END;
CREATE TRIGGER IF NOT EXISTS upvotes_append_only_u BEFORE UPDATE ON upvotes
  BEGIN SELECT RAISE(ABORT, 'agora is append-only'); END;
CREATE TRIGGER IF NOT EXISTS upvotes_append_only_d BEFORE DELETE ON upvotes
  BEGIN SELECT RAISE(ABORT, 'agora is append-only'); END;
"""


class AgoraError(ValueError):
    """Bad input. `code` is machine-readable; `status` is the HTTP status the API answers with."""

    status = 400

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class UnknownIdea(AgoraError):
    status = 404


class DuplicateUpvote(AgoraError):
    status = 409


def rank_key(idea: Mapping[str, Any], queue_priority: Mapping[str, int]) -> tuple:
    """Queue order: Charter queue priority of the tier (national first), then visible upvotes
    (most first; a hidden count ranks as 0), then created_at (oldest first), then id."""
    return (
        queue_priority[idea["scope_tier"]],
        -(idea["upvote_count"] or 0),
        idea["created_at"],
        idea["id"],
    )


def _now() -> datetime:
    return datetime.now(UTC)


def _timestamp(t: datetime) -> str:
    # Fixed width, so text order is time order.
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _ulid(t: datetime) -> str:
    n = (int(t.timestamp() * 1000) << 80) | int.from_bytes(os.urandom(10), "big")
    return "".join(_CROCKFORD[(n >> (5 * i)) & 31] for i in reversed(range(26)))


def _localized(value: Any, field: str, max_chars: int, multiline: bool) -> dict[str, str]:
    if not isinstance(value, dict) or not value:
        raise AgoraError("invalid_field", f"{field} must be an object of language -> text")
    out = {}
    for lang, text in value.items():
        if lang not in LANGS:
            raise AgoraError("invalid_field", f"{field}: language must be one of {LANGS}")
        if not isinstance(text, str) or not text.strip():
            raise AgoraError("invalid_field", f"{field}.{lang} must be non-empty text")
        text = text.strip()
        if len(text) > max_chars:
            raise AgoraError("too_long", f"{field}.{lang} is over {max_chars} characters")
        if _BAD_CHARS.search(text) or (not multiline and ("\n" in text or "\t" in text)):
            raise AgoraError("invalid_field", f"{field}.{lang} has control characters")
        out[lang] = text
    return out


class Agora:
    def __init__(
        self,
        path: str | Path = ":memory:",
        charter: d2_charter.Charter | None = None,
        nyms: NymSource | None = None,
        now: Callable[[], datetime] = _now,
    ) -> None:
        self.charter = charter or d2_charter.load()
        self.nyms = nyms or OpaqueNyms()
        self.now = now
        self.hidden = timedelta(hours=self.charter.param("agora.upvote_hidden_hours"))
        self.priority = {
            t: self.charter.param(f"tiers.{t}.queue_priority") for t in d2_charter.TIERS
        }
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.executescript(SCHEMA)

    def close(self) -> None:
        self._db.close()

    # --- writes -------------------------------------------------------------------------------

    def post_idea(self, body: Any) -> dict[str, Any]:
        """Store a new idea from an API body and return it as spec/schemas/idea.schema.json."""
        if not isinstance(body, dict):
            raise AgoraError("invalid_body", "body must be a JSON object")
        extra = sorted(set(body) - IDEA_FIELDS)
        if extra:
            # This is where a proposer's own "scope_tier" or "affected_population" ends up.
            raise AgoraError("unknown_field", f"unknown field(s): {', '.join(extra)}")
        jurisdiction_id = body.get("jurisdiction_id")
        if not isinstance(jurisdiction_id, str) or not _JURISDICTION.fullmatch(jurisdiction_id):
            raise AgoraError("invalid_field", "jurisdiction_id must be a jurisdiction id")
        topic_ids = body.get("topic_ids", [])
        if not isinstance(topic_ids, list) or not all(
            isinstance(t, str) and _TOPIC.fullmatch(t) for t in topic_ids
        ):
            raise AgoraError("invalid_field", "topic_ids must be a list of dotted topic ids")
        if len(topic_ids) > LIMITS["topics"]:
            raise AgoraError("too_long", f"at most {LIMITS['topics']} topics")
        if len(set(topic_ids)) != len(topic_ids):
            raise AgoraError("invalid_field", "topic_ids repeats a topic")
        title = _localized(body.get("title"), "title", LIMITS["title_chars"], multiline=False)
        text = _localized(body.get("text"), "text", LIMITS["text_chars"], multiline=True)
        try:
            tier = self.charter.tier({"jurisdiction_id": jurisdiction_id, "topic_ids": topic_ids})
        except CharterError as exc:
            raise AgoraError(exc.code, str(exc)) from exc
        nym = self._nym(body.get("participant"), jurisdiction_id)

        t = self.now()
        row = (
            _ulid(t),
            jurisdiction_id,
            json.dumps(topic_ids),
            json.dumps(title, ensure_ascii=False, sort_keys=True),
            json.dumps(text, ensure_ascii=False, sort_keys=True),
            nym,
            _timestamp(t),
            tier,
            self.charter.version,
        )
        with self._lock:
            self._db.execute("INSERT INTO ideas VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", row)
        return self.idea(row[0])

    def upvote(self, idea_id: str, participant: Any) -> dict[str, Any]:
        """Record one upvote. The answer never carries the count, which may still be hidden."""
        idea = self.idea(idea_id)
        nym = self._nym(participant, idea["jurisdiction_id"])
        try:
            with self._lock:
                self._db.execute(
                    "INSERT INTO upvotes VALUES (?, ?, ?)",
                    (idea_id, nym, _timestamp(self.now())),
                )
        except sqlite3.IntegrityError as exc:
            raise DuplicateUpvote(
                "duplicate_upvote", "this participant already upvoted this idea"
            ) from exc
        return {"idea_id": idea_id, "upvoted": True}

    def _nym(self, participant: Any, jurisdiction_id: str) -> str:
        try:
            return self.nyms.nym(participant, f"agora:{jurisdiction_id}")
        except InvalidParticipant as exc:
            raise AgoraError(exc.code, str(exc)) from exc

    # --- reads --------------------------------------------------------------------------------

    def idea(self, idea_id: str) -> dict[str, Any]:
        rows = self._select("WHERE i.id = ?", (idea_id,))
        if not rows:
            raise UnknownIdea("unknown_idea", "no idea with that id")
        return rows[0]

    def queue(
        self, jurisdictions: Iterable[str] | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Ideas in the given jurisdictions (all when None), in queue order."""
        if not 1 <= limit <= LIMITS["queue_limit"]:
            raise AgoraError("invalid_field", f"limit must be 1-{LIMITS['queue_limit']}")
        if jurisdictions is None:
            rows = self._select("", ())
        else:
            wanted = sorted(set(jurisdictions))
            if len(wanted) > LIMITS["queue_jurisdictions"]:
                raise AgoraError(
                    "too_long", f"at most {LIMITS['queue_jurisdictions']} jurisdictions"
                )
            marks = ",".join("?" * len(wanted))
            rows = self._select(f"WHERE i.jurisdiction_id IN ({marks})", tuple(wanted))
        rows.sort(key=lambda idea: rank_key(idea, self.priority))
        return rows[:limit]

    def count(self) -> int:
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM ideas").fetchone()[0]

    def _select(self, where: str, args: tuple) -> list[dict[str, Any]]:
        sql = (
            "SELECT i.id, i.jurisdiction_id, i.topic_ids, i.title, i.text, i.proposer_nym,"
            " i.created_at, i.scope_tier, i.charter_version, COUNT(u.voter_nym)"
            " FROM ideas i LEFT JOIN upvotes u ON u.idea_id = i.id "
            f"{where} GROUP BY i.id"
        )
        with self._lock:
            rows = self._db.execute(sql, args).fetchall()
        now = self.now()
        out = []
        for r in rows:
            created = datetime.strptime(r[6], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=UTC)
            out.append(
                {
                    "id": r[0],
                    "jurisdiction_id": r[1],
                    "topic_ids": json.loads(r[2]),
                    "title": json.loads(r[3]),
                    "text": json.loads(r[4]),
                    "proposer_nym": r[5],
                    "created_at": r[6],
                    "scope_tier": r[7],
                    "charter_version": r[8],
                    "upvote_count": r[9] if now >= created + self.hidden else None,
                }
            )
        return out
