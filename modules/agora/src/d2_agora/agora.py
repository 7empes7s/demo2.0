"""Ideas, upvotes and the ranked queue, kept in one append-only SQLite file.

Rules (docs/architecture/01-modules.md section 11, Phase 2 criteria in 00-overview.md section 7):
- An idea's tier comes from Scope (d2_charter) applied to its jurisdiction and topics. The request
  cannot carry a tier: any field outside the documented ones is rejected, and nothing can change
  an idea after it is stored (database triggers refuse UPDATE, DELETE and an INSERT that would
  replace a stored row).
- The proposer picks the jurisdiction. With Door (`DoorNyms`) it must be one their credential
  places them in, so nobody files in a commune they do not live in. A resident can still file a
  commune matter under an area that contains it (say `lu`); anyone else in that area can then
  open a ScopeChallenge naming a narrower jurisdiction. A Lottery panel drawn from the area's
  participants votes uphold or narrow; if narrowed, Scope recomputes the tier for the new
  jurisdiction. A challenge can only narrow, never widen.
- One upvote per (idea, nym). A second one is refused, not merged.
- Upvote counts stay hidden for Charter `agora.upvote_hidden_hours` after an idea is posted.
  While hidden the count is null and the idea ranks as if it had none, so its position does not
  leak the count either.
- The queue order is total and deterministic: see `rank_key`.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import threading
import unicodedata
from collections.abc import Callable, Iterable, Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import d2_charter
from d2_charter import CharterError

from .identity import IdentityError, NymSource
from .sortition import LotteryError, Sortition

log = logging.getLogger("d2_agora")

LANGS = ("lb", "fr", "de", "en", "pt")
LIMITS = {
    "title_chars": 200,  # per language
    "text_chars": 4000,  # per language
    "topics": 8,
    "queue_jurisdictions": 20,
    "queue_limit": 500,
}
IDEA_FIELDS = {"participant", "jurisdiction_id", "topic_ids", "title", "text"}
CHALLENGE_FIELDS = {"participant", "jurisdiction_id"}
VOTE_FIELDS = {"participant", "vote"}
VOTES = ("uphold", "narrow")
CHALLENGE_PURPOSE = "scope-challenge"
# The Lottery commits to the first drand round at least an hour after the commit; the round
# exists at most one chain period later (30 s on the slowest trusted chain). Agora asks for the
# draw only after this delay, so a recorded or early beacon cannot be used before its time.
DRAW_DELAY = timedelta(seconds=3600 + 60)
# After a failed panel draw, reads wait this long before running the Lottery CLI again.
DRAW_RETRY = timedelta(seconds=60)
# An idea takes at most this many upheld challenges; then the tier is settled.
MAX_UPHELD_CHALLENGES = 3
_TOPIC = re.compile(r"[a-z0-9_]{1,32}(\.[a-z0-9_]{1,32}){0,5}")
_JURISDICTION = re.compile(r"[a-z0-9-]{1,64}")
# C0 controls except tab and newline, DEL, C1 controls, bidi overrides that can disguise text,
# and lone surrogates (they cannot be stored as UTF-8).
_BAD_CHARS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\ud800-\udfff]")
# Also refused in one-line fields: tab, newline, line and paragraph separators, zero-width chars.
_BAD_ONE_LINE = re.compile(r"[\t\n\u2028\u2029\u200b-\u200d\u2060\ufeff]")
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
-- Settings the database must keep across restarts: `door_epoch`, the Door epoch it accepts.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS ideas_append_only_u BEFORE UPDATE ON ideas
  BEGIN SELECT RAISE(ABORT, 'agora is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ideas_append_only_d BEFORE DELETE ON ideas
  BEGIN SELECT RAISE(ABORT, 'agora is append-only'); END;
CREATE TRIGGER IF NOT EXISTS upvotes_append_only_u BEFORE UPDATE ON upvotes
  BEGIN SELECT RAISE(ABORT, 'agora is append-only'); END;
CREATE TRIGGER IF NOT EXISTS upvotes_append_only_d BEFORE DELETE ON upvotes
  BEGIN SELECT RAISE(ABORT, 'agora is append-only'); END;
-- INSERT OR REPLACE / REPLACE INTO delete the old row without firing DELETE triggers (unless
-- recursive_triggers is on), so refuse any insert whose key is already stored.
CREATE TRIGGER IF NOT EXISTS ideas_append_only_i BEFORE INSERT ON ideas
  WHEN EXISTS (SELECT 1 FROM ideas WHERE id = NEW.id)
  BEGIN SELECT RAISE(ABORT, 'agora is append-only'); END;
CREATE TRIGGER IF NOT EXISTS upvotes_append_only_i BEFORE INSERT ON upvotes
  WHEN EXISTS (SELECT 1 FROM upvotes WHERE idea_id = NEW.idea_id AND voter_nym = NEW.voter_nym)
  BEGIN SELECT RAISE(ABORT, 'agora is append-only'); END;
-- ScopeChallenges. A challenge, its panel draw, each panel vote and its outcome are separate
-- append-only rows; an idea's current jurisdiction and tier are read from its last `narrowed`
-- outcome, so the idea row itself never changes.
CREATE TABLE IF NOT EXISTS scope_challenges (
  id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL REFERENCES ideas(id),
  challenger_nym TEXT NOT NULL,
  from_jurisdiction_id TEXT NOT NULL,
  from_tier TEXT NOT NULL,
  proposed_jurisdiction_id TEXT NOT NULL,
  proposed_tier TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  deadline TEXT NOT NULL,
  charter_version TEXT NOT NULL,
  panel_size INTEGER NOT NULL,
  pool TEXT NOT NULL,
  commitment TEXT NOT NULL,
  UNIQUE (idea_id, challenger_nym)
);
CREATE TABLE IF NOT EXISTS scope_challenge_draws (
  challenge_id TEXT PRIMARY KEY REFERENCES scope_challenges(id),
  transcript TEXT NOT NULL,
  drawn_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scope_challenge_votes (
  challenge_id TEXT NOT NULL REFERENCES scope_challenges(id),
  voter_nym TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('uphold', 'narrow')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (challenge_id, voter_nym)
);
CREATE TABLE IF NOT EXISTS scope_challenge_outcomes (
  challenge_id TEXT PRIMARY KEY REFERENCES scope_challenges(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('upheld', 'narrowed')),
  decided_by TEXT NOT NULL CHECK (decided_by IN ('majority', 'deadline')),
  uphold_votes INTEGER NOT NULL,
  narrow_votes INTEGER NOT NULL,
  jurisdiction_id TEXT NOT NULL,
  scope_tier TEXT NOT NULL,
  charter_version TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  reason TEXT
);
""" + "".join(
    f"""
CREATE TRIGGER IF NOT EXISTS {t}_append_only_u BEFORE UPDATE ON {t}
  BEGIN SELECT RAISE(ABORT, 'agora is append-only'); END;
CREATE TRIGGER IF NOT EXISTS {t}_append_only_d BEFORE DELETE ON {t}
  BEGIN SELECT RAISE(ABORT, 'agora is append-only'); END;
CREATE TRIGGER IF NOT EXISTS {t}_append_only_i BEFORE INSERT ON {t}
  WHEN EXISTS (SELECT 1 FROM {t} WHERE {key})
  BEGIN SELECT RAISE(ABORT, 'agora is append-only'); END;
"""
    for t, key in (
        ("scope_challenges", "id = NEW.id"),
        ("scope_challenge_draws", "challenge_id = NEW.challenge_id"),
        (
            "scope_challenge_votes",
            "challenge_id = NEW.challenge_id AND voter_nym = NEW.voter_nym",
        ),
        ("scope_challenge_outcomes", "challenge_id = NEW.challenge_id"),
    )
)


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


class UnknownChallenge(AgoraError):
    status = 404


class Conflict(AgoraError):
    """The request clashes with stored state: a duplicate challenge or vote, a closed challenge."""

    status = 409


class Forbidden(AgoraError):
    """A valid participant who may not do this: their own idea, not on the panel."""

    status = 403


class Unavailable(AgoraError):
    status = 503


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


def _parse_time(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=UTC)


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
        if _BAD_CHARS.search(text) or (not multiline and _BAD_ONE_LINE.search(text)):
            raise AgoraError("invalid_field", f"{field}.{lang} has control characters")
        text = unicodedata.normalize("NFC", text)
        if len(text) > max_chars:
            raise AgoraError("too_long", f"{field}.{lang} is over {max_chars} characters")
        out[lang] = text
    return out


class Agora:
    def __init__(
        self,
        path: str | Path = ":memory:",
        charter: d2_charter.Charter | None = None,
        *,
        nyms: NymSource,
        now: Callable[[], datetime] = _now,
        lottery: Sortition | None = None,
    ) -> None:
        """`nyms` is required: there is no default key (see identity.py). `now` must return
        timezone-aware datetimes. `lottery` draws ScopeChallenge panels (`LotteryCli`); without
        it, opening a challenge answers 503 `lottery_unavailable`."""
        self.charter = charter or d2_charter.load()
        self.nyms = nyms
        self._now = now
        self.now()  # a tz-naive clock fails here, not on the first read
        self.hidden = timedelta(hours=self.charter.param("agora.upvote_hidden_hours"))
        self.priority = {
            t: self.charter.param(f"tiers.{t}.queue_priority") for t in d2_charter.TIERS
        }
        self.lottery = lottery
        self.panel_size = self.charter.param("scope_challenge.panel_size")
        self.decision_window = timedelta(days=self.charter.param("scope_challenge.decision_days"))
        self._lock = threading.Lock()
        self._draw_failed_at: dict[str, datetime] = {}  # challenge id -> last failed draw
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.executescript(SCHEMA)

    def now(self) -> datetime:
        t = self._now()
        if not isinstance(t, datetime) or t.utcoffset() is None:
            raise TypeError("Agora's clock must return timezone-aware datetimes (e.g. UTC)")
        return t

    def close(self) -> None:
        self._db.close()

    def accept_door_epoch(self, epoch: int, new: bool = False) -> None:
        """Record the Door epoch this database accepts. A different epoch gives every holder new
        nyms, so they could upvote the same ideas again: refuse it unless `new` is set (the
        operator's explicit `--new-epoch`), which then replaces the stored one."""
        with self._lock:
            row = self._db.execute("SELECT value FROM meta WHERE key = 'door_epoch'").fetchone()
            if row is not None and row[0] != str(epoch) and not new:
                raise AgoraError(
                    "epoch_changed",
                    f"this database accepts Door epoch {row[0]}, not {epoch}: a new epoch gives"
                    " every holder new nyms, so they could upvote the same ideas again."
                    " Start with --new-epoch to accept it.",
                )
            self._db.execute(
                "INSERT INTO meta VALUES ('door_epoch', ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (str(epoch),),
            )

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
        # The nym context is the jurisdiction the idea was filed under, even after a challenge
        # narrowed it, so nobody gets a second nym (and a second upvote) for the same idea.
        nym = self._nym(participant, idea["filed_jurisdiction_id"])
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
        except IdentityError as exc:
            err = AgoraError(exc.code, str(exc))
            err.status = exc.status  # 400 bad input, 403 refused, 503 Door unavailable
            raise err from exc

    # --- scope challenges ---------------------------------------------------------------------

    def open_challenge(self, idea_id: str, body: Any) -> dict[str, Any]:
        """Contest an idea's tier: `{participant, jurisdiction_id}`, the narrower jurisdiction
        the challenger says the idea belongs to. Commits a Lottery draw for the panel."""
        if not isinstance(body, dict):
            raise AgoraError("invalid_body", "body must be a JSON object")
        extra = sorted(set(body) - CHALLENGE_FIELDS)
        if extra:
            raise AgoraError("unknown_field", f"unknown field(s): {', '.join(extra)}")
        if set(body) != CHALLENGE_FIELDS:
            raise AgoraError("invalid_body", "body must be {participant, jurisdiction_id}")
        proposed = body["jurisdiction_id"]
        if not isinstance(proposed, str) or not _JURISDICTION.fullmatch(proposed):
            raise AgoraError("invalid_field", "jurisdiction_id must be a jurisdiction id")
        idea = self.idea(idea_id)  # settles due challenges first
        if self.lottery is None:
            raise Unavailable("lottery_unavailable", "no Lottery is configured for panels")
        try:
            current = self.charter.jurisdiction_path(idea["jurisdiction_id"])
            narrower = self.charter.jurisdiction_path(proposed)
            proposed_tier = self.charter.tier(
                {"jurisdiction_id": proposed, "topic_ids": idea["topic_ids"]}
            )
        except CharterError as exc:
            raise AgoraError(exc.code, str(exc)) from exc
        if len(narrower) <= len(current) or narrower[: len(current)] != current:
            raise AgoraError(
                "not_narrower",
                "a challenge names a jurisdiction inside the idea's current one; it never widens",
            )
        if self.priority[proposed_tier] <= self.priority[idea["scope_tier"]]:
            raise AgoraError(
                "not_narrower", f"{proposed} has the same tier as the idea: nothing to decide"
            )
        nym = self._nym(body["participant"], idea["filed_jurisdiction_id"])
        if nym == idea["proposer_nym"]:
            raise Forbidden("own_idea", "a proposer cannot challenge their own idea")
        with self._lock:
            self._refuse_second_challenge(idea_id, nym, proposed)
            pool = self._panel_pool(idea, nym)
        if len(pool) < self.panel_size:
            raise Conflict(
                "panel_pool_too_small",
                f"a panel needs {self.panel_size} participants in this area besides the"
                f" proposer and the challenger; there are {len(pool)}",
            )
        t = self.now()
        challenge_id = _ulid(t)
        try:
            commitment = self.lottery.commit(
                pool,
                CHALLENGE_PURPOSE,
                f"agora.scope-challenge.{challenge_id}",
                self.panel_size,
                int(t.timestamp()),
            )
        except LotteryError as exc:
            log.error("ScopeChallenge panel commit failed: %s", exc)
            raise Unavailable("lottery_unavailable", "the Lottery is unavailable") from exc
        row = (
            challenge_id,
            idea_id,
            nym,
            idea["jurisdiction_id"],
            idea["scope_tier"],
            proposed,
            proposed_tier,
            _timestamp(t),
            _timestamp(t + self.decision_window),
            self.charter.version,
            self.panel_size,
            json.dumps(pool),
            json.dumps(commitment, sort_keys=True),
        )
        with self._lock:
            self._refuse_second_challenge(idea_id, nym, proposed)  # again: the commit ran unlocked
            self._db.execute(
                "INSERT INTO scope_challenges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", row
            )
        return self.challenge(challenge_id)

    def vote_challenge(self, challenge_id: str, body: Any) -> dict[str, Any]:
        """A panel member's vote, `{participant, vote}` with vote `uphold` or `narrow`. A
        majority of the panel (3 of 5) decides at once; only such a majority narrows."""
        if not isinstance(body, dict) or set(body) != VOTE_FIELDS:
            raise AgoraError("invalid_body", "body must be exactly {participant, vote}")
        if body["vote"] not in VOTES:
            raise AgoraError("invalid_field", "vote must be uphold or narrow")
        ch = self.challenge(challenge_id)  # settles, and draws the panel when due
        if ch["status"] != "open":
            raise Conflict("challenge_closed", "this challenge is decided")
        if ch["panel"] is None:
            raise Conflict("panel_not_drawn", "the panel is not drawn yet: try again later")
        idea = self.idea(ch["idea_id"])
        nym = self._nym(body["participant"], idea["filed_jurisdiction_id"])
        if nym not in ch["panel"]:
            raise Forbidden("not_on_panel", "only the drawn panel votes on this challenge")
        with self._lock:
            row = self._challenge_row(challenge_id)
            if self._outcome_row(challenge_id) or self.now() >= _parse_time(row["deadline"]):
                raise Conflict("challenge_closed", "this challenge is decided")
            try:
                self._db.execute(
                    "INSERT INTO scope_challenge_votes VALUES (?, ?, ?, ?)",
                    (challenge_id, nym, body["vote"], _timestamp(self.now())),
                )
            except sqlite3.DatabaseError as exc:
                raise Conflict("duplicate_vote", "this panel member already voted") from exc
            uphold, narrow = self._tally(challenge_id)
            majority = row["panel_size"] // 2 + 1
            if max(uphold, narrow) >= majority:
                outcome = "narrowed" if narrow >= majority else "upheld"
                self._decide(row, outcome, "majority", uphold, narrow, self.now())
        return {"challenge_id": challenge_id, "voted": True}

    def challenge(self, challenge_id: str) -> dict[str, Any]:
        """A challenge as `spec/schemas/scope-challenge.schema.json`. Draws its panel first
        when the committed round is due."""
        self._settle()
        with self._lock:
            row = self._challenge_row(challenge_id)
            pending = not self._has_draw(challenge_id) and not self._outcome_row(challenge_id)
        if pending:
            self._draw_if_due(row)
        with self._lock:
            drawn = self._db.execute(
                "SELECT transcript FROM scope_challenge_draws WHERE challenge_id = ?",
                (challenge_id,),
            ).fetchone()
            outcome = self._outcome_row(challenge_id)
        return self._view(row, json.loads(drawn[0]) if drawn else None, outcome)

    def challenges_of(self, idea_id: str) -> list[dict[str, Any]]:
        """Every challenge against an idea, oldest first."""
        self.idea(idea_id)
        with self._lock:
            ids = [
                r[0]
                for r in self._db.execute(
                    "SELECT id FROM scope_challenges WHERE idea_id = ? ORDER BY opened_at, id",
                    (idea_id,),
                )
            ]
        return [self.challenge(i) for i in ids]

    def _refuse_second_challenge(self, idea_id: str, nym: str, proposed: str) -> None:
        """Under the lock. One challenge per participant per idea, ever; one open per idea; no
        new draw for an area a panel already refused; at most MAX_UPHELD_CHALLENGES upheld."""
        if self._db.execute(
            "SELECT 1 FROM scope_challenges WHERE idea_id = ? AND challenger_nym = ?",
            (idea_id, nym),
        ).fetchone():
            raise Conflict("duplicate_challenge", "this participant already challenged this idea")
        if self._db.execute(
            "SELECT 1 FROM scope_challenges c WHERE c.idea_id = ? AND NOT EXISTS"
            " (SELECT 1 FROM scope_challenge_outcomes o WHERE o.challenge_id = c.id)",
            (idea_id,),
        ).fetchone():
            raise Conflict("challenge_open", "this idea already has an open challenge")
        upheld = [
            r[0]
            for r in self._db.execute(
                "SELECT c.proposed_jurisdiction_id FROM scope_challenges c"
                " JOIN scope_challenge_outcomes o ON o.challenge_id = c.id"
                " WHERE c.idea_id = ? AND o.outcome = 'upheld'",
                (idea_id,),
            )
        ]
        if proposed in upheld:
            raise Conflict(
                "already_decided", "a panel already kept this idea's tier against that area"
            )
        if len(upheld) >= MAX_UPHELD_CHALLENGES:
            raise Conflict(
                "challenge_limit",
                f"this idea's tier was upheld {MAX_UPHELD_CHALLENGES} times: it is settled",
            )

    def _panel_pool(self, idea: Mapping[str, Any], challenger: str) -> list[str]:
        """Under the lock. Everyone with a nym in the idea's area (context agora:<filed
        jurisdiction>): proposers and upvoters of ideas filed there, minus this idea's proposer
        and the challenger. Sorted, so the pool does not depend on storage order."""
        rows = self._db.execute(
            "SELECT proposer_nym FROM ideas WHERE jurisdiction_id = ?"
            " UNION SELECT u.voter_nym FROM upvotes u JOIN ideas i ON i.id = u.idea_id"
            " WHERE i.jurisdiction_id = ?",
            (idea["filed_jurisdiction_id"], idea["filed_jurisdiction_id"]),
        ).fetchall()
        return sorted({r[0] for r in rows} - {idea["proposer_nym"], challenger})

    def _challenge_row(self, challenge_id: str) -> dict[str, Any]:
        cur = self._db.execute("SELECT * FROM scope_challenges WHERE id = ?", (challenge_id,))
        r = cur.fetchone()
        if r is None:
            raise UnknownChallenge("unknown_challenge", "no challenge with that id")
        return dict(zip([d[0] for d in cur.description], r, strict=True))

    def _outcome_row(self, challenge_id: str) -> dict[str, Any] | None:
        cur = self._db.execute(
            "SELECT * FROM scope_challenge_outcomes WHERE challenge_id = ?", (challenge_id,)
        )
        r = cur.fetchone()
        return None if r is None else dict(zip([d[0] for d in cur.description], r, strict=True))

    def _has_draw(self, challenge_id: str) -> bool:
        return bool(
            self._db.execute(
                "SELECT 1 FROM scope_challenge_draws WHERE challenge_id = ?", (challenge_id,)
            ).fetchone()
        )

    def _tally(self, challenge_id: str) -> tuple[int, int]:
        rows = dict(
            self._db.execute(
                "SELECT vote, COUNT(*) FROM scope_challenge_votes WHERE challenge_id = ?"
                " GROUP BY vote",
                (challenge_id,),
            ).fetchall()
        )
        return rows.get("uphold", 0), rows.get("narrow", 0)

    def _decide(
        self,
        row: Mapping[str, Any],
        outcome: str,
        decided_by: str,
        uphold: int,
        narrow: int,
        at: datetime,
    ) -> None:
        """Under the lock. Narrowed: Scope computes the tier of the proposed jurisdiction now,
        under the current Charter; nothing is set by hand. Upheld: the tier stays. When Scope
        cannot tier it (the Charter changed under the challenge), the tier stands, with a reason,
        so one bad challenge never breaks the reads that settle it."""
        reason = None
        if outcome == "narrowed":
            try:
                topics = json.loads(
                    self._db.execute(
                        "SELECT topic_ids FROM ideas WHERE id = ?", (row["idea_id"],)
                    ).fetchone()[0]
                )
                jurisdiction = row["proposed_jurisdiction_id"]
                tier = self.charter.tier({"jurisdiction_id": jurisdiction, "topic_ids": topics})
                version = self.charter.version
                if tier not in self.priority:
                    raise ValueError(f"unknown tier {tier!r}")
            except Exception as exc:  # noqa: BLE001 - any failure here keeps the tier
                log.error("ScopeChallenge %s: Scope could not tier it: %s", row["id"], exc)
                outcome = "upheld"
                reason = f"Scope could not tier {row['proposed_jurisdiction_id']}: {exc}"[:500]
        if outcome == "upheld":
            jurisdiction, tier, version = (
                row["from_jurisdiction_id"],
                row["from_tier"],
                row["charter_version"],
            )
        self._db.execute(
            "INSERT INTO scope_challenge_outcomes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                row["id"],
                outcome,
                decided_by,
                uphold,
                narrow,
                jurisdiction,
                tier,
                version,
                _timestamp(at),
                reason,
            ),
        )

    def _settle(self) -> None:
        """Close every open challenge whose window has passed. Only a majority of the drawn
        panel narrows (the vote that reaches it decides at once), so at the deadline the tier
        stands (upheld), whatever a minority voted."""
        now = self.now()
        with self._lock:
            due = self._db.execute(
                "SELECT id FROM scope_challenges c WHERE deadline <= ? AND NOT EXISTS"
                " (SELECT 1 FROM scope_challenge_outcomes o WHERE o.challenge_id = c.id)"
                " ORDER BY deadline, id",
                (_timestamp(now),),
            ).fetchall()
            for (challenge_id,) in due:
                row = self._challenge_row(challenge_id)
                uphold, narrow = self._tally(challenge_id)
                outcome = "narrowed" if narrow >= row["panel_size"] // 2 + 1 else "upheld"
                deadline = _parse_time(row["deadline"])
                self._decide(row, outcome, "deadline", uphold, narrow, deadline)

    def _draw_if_due(self, row: Mapping[str, Any]) -> None:
        """Ask the Lottery for the panel once the committed round is due. A failure (drand
        unreachable, beacon not out yet) leaves it undrawn; a read DRAW_RETRY later tries again,
        so reads do not run the Lottery CLI each time."""
        now = self.now()
        if self.lottery is None or now < _parse_time(row["opened_at"]) + DRAW_DELAY:
            return
        with self._lock:
            failed = self._draw_failed_at.get(row["id"])
            if failed is not None and now < failed + DRAW_RETRY:
                return
            self._draw_failed_at[row["id"]] = now  # held until the draw is stored
        stored = False
        try:
            stored = self._draw(row)
        finally:
            if stored:
                with self._lock:
                    self._draw_failed_at.pop(row["id"], None)

    def _draw(self, row: Mapping[str, Any]) -> bool:
        """One draw attempt; True once the panel is stored."""
        commitment = json.loads(row["commitment"])
        pool = json.loads(row["pool"])
        try:
            transcript = self.lottery.draw(commitment, pool)
        except LotteryError as exc:
            log.error("ScopeChallenge panel draw failed: %s", exc)
            return False
        if transcript is None:
            return False
        committed = {k: v for k, v in commitment.items() if k != "commitment_hash"}
        result = transcript.get("result") if isinstance(transcript, dict) else None
        selected = result.get("selected") if isinstance(result, dict) else None
        if (
            transcript.get("commitment") != committed
            or [m.get("nym") for m in transcript.get("pool", []) if isinstance(m, dict)] != pool
            or not isinstance(selected, list)
            or len(selected) != row["panel_size"]
            or not set(selected) <= set(pool)
        ):
            log.error("ScopeChallenge panel draw: the Lottery answered another draw")
            return False
        with self._lock:
            try:
                self._db.execute(
                    "INSERT INTO scope_challenge_draws VALUES (?, ?, ?)",
                    (row["id"], json.dumps(transcript, sort_keys=True), _timestamp(self.now())),
                )
            except sqlite3.DatabaseError:
                pass  # another request stored the same (deterministic) draw first
        return True

    def _view(
        self,
        row: Mapping[str, Any],
        transcript: dict[str, Any] | None,
        outcome: Mapping[str, Any] | None,
    ) -> dict[str, Any]:
        view = {
            "id": row["id"],
            "idea_id": row["idea_id"],
            "challenger_nym": row["challenger_nym"],
            "from_jurisdiction_id": row["from_jurisdiction_id"],
            "from_tier": row["from_tier"],
            "proposed_jurisdiction_id": row["proposed_jurisdiction_id"],
            "proposed_tier": row["proposed_tier"],
            "opened_at": row["opened_at"],
            "deadline": row["deadline"],
            "charter_version": row["charter_version"],
            "panel_size": row["panel_size"],
            "status": "open" if outcome is None else outcome["outcome"],
            "panel": None if transcript is None else transcript["result"]["selected"],
            "draw": {
                "pool": json.loads(row["pool"]),
                "commitment": json.loads(row["commitment"]),
                "transcript": transcript,
            },
            "outcome": None,
        }
        if outcome is not None:
            view["outcome"] = {
                "decided_by": outcome["decided_by"],
                "votes": {"uphold": outcome["uphold_votes"], "narrow": outcome["narrow_votes"]},
                "jurisdiction_id": outcome["jurisdiction_id"],
                "scope_tier": outcome["scope_tier"],
                "charter_version": outcome["charter_version"],
                "decided_at": outcome["decided_at"],
                "reason": outcome["reason"],
            }
        return view

    # --- reads --------------------------------------------------------------------------------

    def idea(self, idea_id: str) -> dict[str, Any]:
        self._settle()
        rows = self._select("WHERE i.id = ?", (idea_id,))
        if not rows:
            raise UnknownIdea("unknown_idea", "no idea with that id")
        return rows[0]

    def queue(
        self, jurisdictions: Iterable[str] | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Ideas whose current jurisdiction is one of the given ones (all when None), in queue
        order."""
        if not 1 <= limit <= LIMITS["queue_limit"]:
            raise AgoraError("invalid_field", f"limit must be 1-{LIMITS['queue_limit']}")
        wanted = None
        if jurisdictions is not None:
            wanted = set(jurisdictions)
            if len(wanted) > LIMITS["queue_jurisdictions"]:
                raise AgoraError(
                    "too_long", f"at most {LIMITS['queue_jurisdictions']} jurisdictions"
                )
        self._settle()
        rows = self._select("", ())
        if wanted is not None:
            rows = [r for r in rows if r["jurisdiction_id"] in wanted]
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
            # The last narrowing of each idea (outcomes of one idea are decided one at a time,
            # since only one challenge is open at once), and which ideas are contested.
            narrowed = {
                r[0]: r[1:]
                for r in self._db.execute(
                    "SELECT c.idea_id, o.jurisdiction_id, o.scope_tier, o.charter_version"
                    " FROM scope_challenge_outcomes o JOIN scope_challenges c"
                    " ON c.id = o.challenge_id WHERE o.outcome = 'narrowed'"
                    " ORDER BY o.decided_at, o.challenge_id"
                )
            }
            contested = {
                r[0]
                for r in self._db.execute(
                    "SELECT c.idea_id FROM scope_challenges c WHERE NOT EXISTS"
                    " (SELECT 1 FROM scope_challenge_outcomes o WHERE o.challenge_id = c.id)"
                )
            }
        now = self.now()
        out = []
        for r in rows:
            created = _parse_time(r[6])
            jurisdiction, tier, version = narrowed.get(r[0], (r[1], r[7], r[8]))
            out.append(
                {
                    "id": r[0],
                    "jurisdiction_id": jurisdiction,
                    "filed_jurisdiction_id": r[1],
                    "topic_ids": json.loads(r[2]),
                    "title": json.loads(r[3]),
                    "text": json.loads(r[4]),
                    "proposer_nym": r[5],
                    "created_at": r[6],
                    "scope_tier": tier,
                    "charter_version": version,
                    "contested": r[0] in contested,
                    "upvote_count": r[9] if now >= created + self.hidden else None,
                }
            )
        return out
