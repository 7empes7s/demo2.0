"""Agora v1. Every idea, participant and district here is synthetic."""

import json
import random
import socket
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path

import d2_charter
import pytest
from d2_agora import (
    LIMITS,
    Agora,
    AgoraError,
    DuplicateUpvote,
    KeyedNyms,
    MissingKey,
    UnknownIdea,
    rank_key,
)
from d2_agora.__main__ import main
from d2_agora.server import MAX_BODY, make_server
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

SPEC = Path(__file__).resolve().parents[3] / "spec" / "schemas"
_SCHEMAS = [json.loads(p.read_text()) for p in SPEC.glob("*.schema.json")]
_REGISTRY = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in _SCHEMAS)
IDEA_SCHEMA = Draft202012Validator(
    json.loads((SPEC / "idea.schema.json").read_text()),
    registry=_REGISTRY,
    format_checker=FormatChecker(),
)

ESCH = "lu-commune-esch-sur-alzette"  # local in Charter 0.1.0
CITY = "lu-commune-luxembourg"  # regional
COUNTRY = "lu"  # national
DISTRICT = "synthetic-district-1"  # minor: a test-only place with 500 people
T0 = datetime(2026, 10, 6, 9, 0, tzinfo=UTC)
NYMS = KeyedNyms(b"synthetic-test-key-not-a-secret-0123456789")  # injected; no key file in git


def who(n: int) -> str:
    return f"synthetic-participant-{n:04d}"


class Clock:
    def __init__(self):
        self.t = T0

    def __call__(self):
        return self.t

    def tick(self, **kw):
        self.t += timedelta(**kw)


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def agora(clock):
    charter = d2_charter.Charter(
        extra_jurisdictions=[
            {
                "id": DISTRICT,
                "parent_id": ESCH,
                "kind": "district",
                "name": {"en": "Synthetic district"},
                "population": 500,
            }
        ]
    )
    a = Agora(charter=charter, nyms=NYMS, now=clock)
    yield a
    a.close()


def body(jurisdiction=ESCH, n=1, **extra):
    return {
        "participant": who(n),
        "jurisdiction_id": jurisdiction,
        "topic_ids": ["synthetic.parks"],
        "title": {"en": f"Synthetic idea {n}"},
        "text": {"en": "A synthetic test proposal.\nSecond line."},
        **extra,
    }


def upvotes(agora, idea, k, start=100):
    for i in range(k):
        agora.upvote(idea["id"], who(start + i))


# --- scope tier comes from the Charter, never from the proposer -------------------------------


@pytest.mark.parametrize(
    "jurisdiction,want",
    [(COUNTRY, "national"), (CITY, "regional"), (ESCH, "local"), (DISTRICT, "minor")],
)
def test_tier_is_scope_of_the_jurisdiction(agora, jurisdiction, want):
    idea = agora.post_idea(body(jurisdiction))
    assert idea["scope_tier"] == want
    assert idea["scope_tier"] == agora.charter.tier(
        {"jurisdiction_id": jurisdiction, "topic_ids": idea["topic_ids"]}
    )
    assert idea["charter_version"] == agora.charter.version
    assert not list(IDEA_SCHEMA.iter_errors(idea))


@pytest.mark.parametrize(
    "label", ["scope_tier", "claimed_tier", "affected_population", "queue_priority", "upvote_count"]
)
def test_a_proposer_cannot_label_its_own_tier(agora, label):
    with pytest.raises(AgoraError) as exc:
        agora.post_idea(body(ESCH, **{label: "national" if "tier" in label else 10**6}))
    assert exc.value.code == "unknown_field"
    assert agora.count() == 0


def test_unknown_jurisdiction_is_refused(agora):
    with pytest.raises(AgoraError) as exc:
        agora.post_idea(body("lu-commune-nowhere"))
    assert exc.value.code == "unknown_jurisdiction"


def test_stored_ideas_and_upvotes_cannot_be_rewritten(agora):
    # A matter cannot change its own tier after the fact either: the store is append-only.
    idea = agora.post_idea(body(ESCH))
    agora.upvote(idea["id"], who(2))
    for sql in (
        "UPDATE ideas SET scope_tier = 'national'",
        "UPDATE ideas SET jurisdiction_id = 'lu'",
        "DELETE FROM ideas",
        "UPDATE upvotes SET voter_nym = 'x'",
        "DELETE FROM upvotes",
    ):
        with pytest.raises(sqlite3.DatabaseError, match="append-only"):
            agora._db.execute(sql)
    # REPLACE deletes the old row without firing DELETE triggers; the INSERT triggers stop it.
    stored = agora._db.execute("SELECT * FROM ideas").fetchone()
    vote = agora._db.execute("SELECT * FROM upvotes").fetchone()
    wider = (*stored[:1], "lu", *stored[2:7], "national", *stored[8:])
    for verb in ("INSERT OR REPLACE INTO", "REPLACE INTO", "INSERT OR IGNORE INTO"):
        with pytest.raises(sqlite3.DatabaseError, match="append-only"):
            agora._db.execute(f"{verb} ideas VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", wider)
        with pytest.raises(sqlite3.DatabaseError, match="append-only"):
            agora._db.execute(f"{verb} upvotes VALUES (?, ?, ?)", (*vote[:2], "2099"))
    assert agora._db.execute("SELECT * FROM ideas").fetchall() == [stored]
    assert agora._db.execute("SELECT * FROM upvotes").fetchall() == [vote]
    assert agora.idea(idea["id"])["scope_tier"] == "local"


def test_known_gap_a_proposer_can_widen_the_jurisdiction_to_raise_the_tier(agora):
    # KNOWN v1 GAP, pinned on purpose (README "Not done yet", STATE.md): the proposer picks the
    # jurisdiction, so a commune matter filed under "lu" is stored as national and jumps the
    # queue. Closing it needs Door eligibility (the proposer's area) or a ScopeChallenge. When
    # that lands this test must change to expect a refusal or a challenge.
    commune_matter = {**body(ESCH), "title": {"en": "Synthetic commune bench repair"}}
    honest = agora.post_idea(commune_matter)
    widened = agora.post_idea({**commune_matter, "jurisdiction_id": COUNTRY})
    assert (honest["scope_tier"], widened["scope_tier"]) == ("local", "national")
    assert [i["id"] for i in agora.queue([ESCH, COUNTRY])] == [widened["id"], honest["id"]]


# --- ranking ----------------------------------------------------------------------------------


def test_queue_ranks_by_tier_then_upvotes_then_age(agora, clock):
    local_hot = agora.post_idea(body(ESCH, 1))
    clock.tick(minutes=1)
    national_cold = agora.post_idea(body(COUNTRY, 2))
    clock.tick(minutes=1)
    minor_hot = agora.post_idea(body(DISTRICT, 3))
    clock.tick(minutes=1)
    regional = agora.post_idea(body(CITY, 4))
    clock.tick(minutes=1)
    national_warm = agora.post_idea(body(COUNTRY, 5))
    clock.tick(minutes=1)
    local_tied_older = agora.post_idea(body(ESCH, 6))
    clock.tick(minutes=1)
    local_tied_newer = agora.post_idea(body(ESCH, 7))
    upvotes(agora, local_hot, 9)
    upvotes(agora, minor_hot, 12)
    upvotes(agora, national_cold, 1)
    upvotes(agora, national_warm, 3)
    upvotes(agora, regional, 2)
    upvotes(agora, local_tied_older, 4)
    upvotes(agora, local_tied_newer, 4)
    clock.tick(hours=24)

    order = [i["id"] for i in agora.queue()]
    assert order == [
        national_warm["id"],  # national, 3
        national_cold["id"],  # national, 1
        regional["id"],  # regional, 2
        local_hot["id"],  # local, 9
        local_tied_older["id"],  # local, 4, posted first
        local_tied_newer["id"],  # local, 4, posted later
        minor_hot["id"],  # minor, 12: the most upvotes, still last
    ]
    counts = [i["upvote_count"] for i in agora.queue()]
    assert counts == [3, 1, 2, 9, 4, 4, 12]


def test_queue_filters_by_jurisdiction(agora):
    a = agora.post_idea(body(ESCH, 1))
    b = agora.post_idea(body(COUNTRY, 2))
    agora.post_idea(body(CITY, 3))
    assert [i["id"] for i in agora.queue([ESCH, COUNTRY])] == [b["id"], a["id"]]
    assert agora.queue(["lu-commune-nowhere"]) == []
    assert len(agora.queue()) == 3
    assert len(agora.queue(limit=1)) == 1


def test_rank_key_is_a_total_order_independent_of_input_order():
    prio = {"national": 1, "regional": 2, "local": 3, "minor": 4}
    ideas = [
        {"id": f"{n:026d}", "scope_tier": t, "upvote_count": c, "created_at": f"2026-10-0{d}"}
        for n, (t, c, d) in enumerate(
            [(t, c, d) for t in prio for c in (None, 0, 2) for d in (1, 2)] * 2
        )
    ]
    want = sorted(ideas, key=lambda i: rank_key(i, prio))
    for seed in range(5):
        shuffled = ideas[:]
        random.Random(seed).shuffle(shuffled)
        assert sorted(shuffled, key=lambda i: rank_key(i, prio)) == want
    assert len({rank_key(i, prio) for i in ideas}) == len(ideas)


def test_counts_are_hidden_and_do_not_rank_for_the_first_24_hours(agora, clock):
    old = agora.post_idea(body(ESCH, 1))
    clock.tick(hours=23)
    young = agora.post_idea(body(ESCH, 2))
    upvotes(agora, young, 5)
    clock.tick(hours=1)  # old is 24 h old now, young is 1 h old
    q = agora.queue()
    assert [i["id"] for i in q] == [old["id"], young["id"]]
    assert [i["upvote_count"] for i in q] == [0, None]
    assert agora.idea(young["id"])["upvote_count"] is None
    assert not list(IDEA_SCHEMA.iter_errors(agora.idea(young["id"])))
    clock.tick(hours=23)
    q = agora.queue()
    assert [i["id"] for i in q] == [young["id"], old["id"]]
    assert [i["upvote_count"] for i in q] == [5, 0]


# --- one upvote per participant ---------------------------------------------------------------


def test_a_second_upvote_by_the_same_participant_is_refused(agora, clock):
    idea = agora.post_idea(body(ESCH, 1))
    other = agora.post_idea(body(ESCH, 2))
    assert agora.upvote(idea["id"], who(10)) == {"idea_id": idea["id"], "upvoted": True}
    clock.tick(hours=30)  # a later try is still a duplicate
    with pytest.raises(DuplicateUpvote) as exc:
        agora.upvote(idea["id"], who(10))
    assert exc.value.code == "duplicate_upvote" and exc.value.status == 409
    agora.upvote(other["id"], who(10))  # the same participant on another idea is fine
    agora.upvote(idea["id"], who(11))
    assert agora.idea(idea["id"])["upvote_count"] == 2
    assert agora.idea(other["id"])["upvote_count"] == 1


def test_upvoting_an_unknown_idea(agora):
    with pytest.raises(UnknownIdea):
        agora.upvote("0" * 26, who(1))


def test_the_published_nym_is_derived_per_area_not_the_participant(agora):
    p = who(1)
    esch = [agora.post_idea(body(ESCH, 1)) for _ in range(2)]
    country = agora.post_idea(body(COUNTRY, 1))
    nyms = {i["proposer_nym"] for i in esch}
    assert len(nyms) == 1  # stable within an area
    assert country["proposer_nym"] not in nyms  # not linkable across areas
    for idea in (*esch, country):
        assert idea["proposer_nym"] != p and p not in idea["proposer_nym"]
        assert not list(IDEA_SCHEMA.iter_errors(idea))
    assert p not in json.dumps(agora.queue())
    assert agora._db.execute(
        "SELECT COUNT(*) FROM ideas WHERE proposer_nym = ?", (p,)
    ).fetchone() == (0,)
    # The nym depends on the key too: another server key gives other nyms.
    other = KeyedNyms(b"another-synthetic-test-key-0123456789")
    assert other.nym(p, f"agora:{ESCH}") != NYMS.nym(p, f"agora:{ESCH}")


def test_one_upvote_per_participant_holds_with_derived_nyms(agora):
    # Enforced on the derived nym of the idea's own area: an idea has one area, so one
    # participant has exactly one nym per idea.
    esch = agora.post_idea(body(ESCH, 1))
    country = agora.post_idea(body(COUNTRY, 2))
    for idea in (esch, country):
        agora.upvote(idea["id"], who(10))
        with pytest.raises(DuplicateUpvote):
            agora.upvote(idea["id"], who(10))
    assert agora._db.execute("SELECT COUNT(*) FROM upvotes").fetchone() == (2,)


def test_there_is_no_default_nym_key(monkeypatch, tmp_path):
    with pytest.raises(TypeError):
        Agora()  # nyms is required
    for bad in (b"", b"x" * 31, "a" * 64):
        with pytest.raises(MissingKey):
            KeyedNyms(bad)
    monkeypatch.delenv("AGORA_NYM_KEY_FILE", raising=False)
    with pytest.raises(MissingKey):
        KeyedNyms.from_env()
    monkeypatch.setenv("AGORA_NYM_KEY_FILE", str(tmp_path / "missing"))
    with pytest.raises(MissingKey):
        KeyedNyms.from_env()
    key = tmp_path / "nym.key"
    key.write_bytes(b"k" * 32 + b"\n")
    monkeypatch.setenv("AGORA_NYM_KEY_FILE", str(key))
    assert KeyedNyms.from_env().nym(who(1), "c") == KeyedNyms(b"k" * 32).nym(who(1), "c")


def test_cli_refuses_to_start_without_a_nym_key(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("AGORA_NYM_KEY_FILE", raising=False)
    assert main(["serve", "--db", str(tmp_path / "agora.db"), "--port", "0"]) == 2
    assert "nym key" in capsys.readouterr().err
    short = tmp_path / "short.key"
    short.write_bytes(b"too short")
    args = ["serve", "--db", str(tmp_path / "agora.db"), "--nym-key-file", str(short)]
    assert main(args) == 2


def test_a_tz_naive_clock_is_refused_at_construction():
    with pytest.raises(TypeError, match="timezone-aware"):
        Agora(nyms=NYMS, now=lambda: datetime(2026, 10, 6, 9, 0))


@pytest.mark.parametrize(
    "participant", ["short", "someone@example.org", "+352 000 000 000", "a" * 129, 12345, None]
)
def test_participant_must_be_an_opaque_id(agora, participant):
    with pytest.raises(AgoraError) as exc:
        agora.post_idea({**body(ESCH), "participant": participant})
    assert exc.value.code == "invalid_participant"


# --- input limits -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "change,code",
    [
        ({"title": {"en": "x" * (LIMITS["title_chars"] + 1)}}, "too_long"),
        ({"text": {"en": "x" * (LIMITS["text_chars"] + 1)}}, "too_long"),
        ({"topic_ids": [f"synthetic.t{i}" for i in range(LIMITS["topics"] + 1)]}, "too_long"),
        ({"topic_ids": ["synthetic.a", "synthetic.a"]}, "invalid_field"),
        ({"topic_ids": ["Not A Topic"]}, "invalid_field"),
        ({"topic_ids": "synthetic.parks"}, "invalid_field"),
        ({"title": {"xx": "Synthetic"}}, "invalid_field"),
        ({"title": {}}, "invalid_field"),
        ({"title": {"en": "   "}}, "invalid_field"),
        ({"title": "Synthetic"}, "invalid_field"),
        ({"title": {"en": "two\nlines"}}, "invalid_field"),
        ({"text": {"en": "bell\x07"}}, "invalid_field"),
        ({"text": {"en": "flip\u202eme"}}, "invalid_field"),
        ({"text": {"en": "a\ud800b"}}, "invalid_field"),  # lone surrogate
        ({"title": {"en": "lone \udfff"}}, "invalid_field"),
        ({"title": {"en": "line\u2028separator"}}, "invalid_field"),
        ({"title": {"en": "para\u2029separator"}}, "invalid_field"),
        ({"title": {"en": "zero\u200bwidth"}}, "invalid_field"),
        ({"title": {"en": "word\u2060joiner"}}, "invalid_field"),
        ({"jurisdiction_id": 3}, "invalid_field"),
        ({"jurisdiction_id": "LU COMMUNE"}, "invalid_field"),
    ],
)
def test_input_limits(agora, change, code):
    with pytest.raises(AgoraError) as exc:
        agora.post_idea({**body(ESCH), **change})
    assert exc.value.code == code
    assert agora.count() == 0


def test_limits_are_inclusive_and_text_is_trimmed(agora):
    idea = agora.post_idea(
        {
            **body(ESCH),
            "title": {"en": "  " + "t" * LIMITS["title_chars"] + "  "},
            "text": {"fr": "x" * LIMITS["text_chars"], "lb": "Synthetesch"},
            "topic_ids": [f"synthetic.t{i}" for i in range(LIMITS["topics"])],
        }
    )
    assert idea["title"]["en"] == "t" * LIMITS["title_chars"]
    assert set(idea["text"]) == {"fr", "lb"}


def test_text_is_nfc_normalised(agora):
    # "e" + combining acute is stored as one character, so it counts once against the limit.
    decomposed = "Caf" + "e\u0301" * LIMITS["title_chars"]
    idea = agora.post_idea({**body(ESCH), "title": {"fr": decomposed[: LIMITS["title_chars"]]}})
    assert "\u0301" not in idea["title"]["fr"]
    idea = agora.post_idea({**body(ESCH), "text": {"fr": "Caf" + "e\u0301"}})
    assert idea["text"]["fr"] == "Caf\u00e9"
    title = "x" * (LIMITS["title_chars"] - 1) + "e\u0301"  # 201 code points in, 200 stored
    assert len(agora.post_idea({**body(ESCH), "title": {"en": title}})["title"]["en"]) == 200


def test_queue_limits(agora):
    with pytest.raises(AgoraError):
        agora.queue([f"j{i}" for i in range(LIMITS["queue_jurisdictions"] + 1)])
    with pytest.raises(AgoraError):
        agora.queue(limit=0)
    with pytest.raises(AgoraError):
        agora.queue(limit=LIMITS["queue_limit"] + 1)


def test_an_empty_agora_has_an_empty_queue(tmp_path):
    a = Agora(tmp_path / "agora.db", nyms=NYMS)
    assert a.queue() == [] and a.count() == 0
    a.close()


def test_ideas_survive_a_restart(tmp_path):
    a = Agora(tmp_path / "agora.db", nyms=NYMS)
    idea = a.post_idea(body(ESCH))
    a.upvote(idea["id"], who(2))
    a.close()
    b = Agora(tmp_path / "agora.db", nyms=NYMS)
    assert b.idea(idea["id"])["title"] == idea["title"]
    with pytest.raises(DuplicateUpvote):
        b.upvote(idea["id"], who(2))
    b.close()


# --- HTTP API ---------------------------------------------------------------------------------


@pytest.fixture
def api(agora):
    server = make_server(agora, port=0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    def call(path, payload=None, raw=None):
        data = raw if raw is not None else (None if payload is None else json.dumps(payload))
        if isinstance(data, str):
            data = data.encode()
        req = urllib.request.Request(base + path, data=data)
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    yield call
    server.shutdown()
    server.server_close()


def test_http_api(api, clock):
    assert api("/healthz") == (200, {"ok": True, "ideas": 0})
    assert api("/queue") == (200, {"charter_version": "0.1.0", "ideas": []})

    status, local = api("/ideas", body(ESCH, 1))
    assert status == 201 and local["scope_tier"] == "local"
    assert not list(IDEA_SCHEMA.iter_errors(local))
    status, national = api("/ideas", body(COUNTRY, 2))
    assert status == 201 and national["scope_tier"] == "national"

    upvote = f"/ideas/{local['id']}/upvote"
    assert api(upvote, {"participant": who(9)}) == (201, {"idea_id": local["id"], "upvoted": True})
    assert api(upvote, {"participant": who(10)})[0] == 201
    status, err = api(upvote, {"participant": who(9)})
    assert status == 409 and err["code"] == "duplicate_upvote"
    assert api(upvote, {"participant": who(9), "extra": 1})[0] == 400
    assert api(upvote, {"participant": "me@example.org"})[1]["code"] == "invalid_participant"
    assert api(f"/ideas/{'0' * 26}/upvote", {"participant": who(9)})[0] == 404

    clock.tick(hours=24)
    status, q = api(f"/queue?jurisdiction={ESCH}&jurisdiction={COUNTRY}")
    assert status == 200
    assert [(i["scope_tier"], i["upvote_count"]) for i in q["ideas"]] == [
        ("national", 0),
        ("local", 2),
    ]
    for idea in q["ideas"]:
        assert not list(IDEA_SCHEMA.iter_errors(idea))
    assert api(f"/queue?jurisdiction={CITY}")[1]["ideas"] == []
    assert len(api("/queue?limit=1")[1]["ideas"]) == 1
    assert api("/queue?limit=abc")[0] == 400
    assert api("/queue?limit=%C2%B2")[1]["code"] == "invalid_field"  # "²" is a digit, not ASCII
    assert api("/queue?limit=%EF%BC%95")[0] == 400  # full-width 5
    assert api("/queue?limit=0")[0] == 400
    assert api(f"/ideas/{local['id']}")[1]["upvote_count"] == 2
    assert api(f"/ideas/{'0' * 26}") == (
        404,
        {"error": "no idea with that id", "code": "unknown_idea"},
    )
    assert api("/nope")[0] == 404
    assert api("/healthz") == (200, {"ok": True, "ideas": 2})


def test_http_api_refuses_relabelling_and_bad_scope(api):
    status, err = api("/ideas", body(ESCH, scope_tier="national"))
    assert (status, err["code"]) == (400, "unknown_field")
    status, err = api("/ideas", body("lu-commune-nowhere"))
    assert (status, err["code"]) == (400, "unknown_jurisdiction")
    assert api("/healthz")[1]["ideas"] == 0


def test_http_api_input_limits(api):
    assert api("/ideas", raw=b"x" * (MAX_BODY + 1))[0] == 413
    lone = json.dumps(body(ESCH)).replace("A synthetic", "\\ud800 synthetic")
    assert "\\ud800" in lone
    assert api("/ideas", raw=lone) == (
        400,
        {"error": "text.en has control characters", "code": "invalid_field"},
    )
    assert api("/ideas", raw=b"not json")[0] == 400
    assert api("/ideas", raw=b"[" * 8000 + b"]" * 8000)[0] == 400
    assert api("/ideas", [1, 2])[1]["code"] == "invalid_body"
    status, err = api("/ideas", {**body(ESCH), "title": {"en": "x" * 201}})
    assert (status, err["code"]) == (400, "too_long")
    assert api("/healthz")[1]["ideas"] == 0


def test_a_maximum_length_escaped_post_fits(api):
    # Every field at its limit, every character astral and sent as an escaped surrogate pair
    # (12 bytes each), as json.dumps / JSON.stringify-with-escaping would send it.
    def longest(n):
        return {lang: "\U0001f333" * n for lang in ("lb", "fr", "de", "en", "pt")}

    post = {
        "participant": "p" * 128,
        "jurisdiction_id": ESCH,
        "topic_ids": [".".join(f"{i}{'t' * 31}" for _ in range(6))[: 32 * 6 + 5] for i in range(8)],
        "title": longest(LIMITS["title_chars"]),
        "text": longest(LIMITS["text_chars"]),
    }
    raw = json.dumps(post, ensure_ascii=True)
    assert 21_000 * 12 < len(raw) <= MAX_BODY
    status, idea = api("/ideas", raw=raw)
    assert status == 201 and idea["text"]["pt"] == "\U0001f333" * LIMITS["text_chars"]


def test_http_api_hides_internal_errors(api, agora, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("secret path /var/lib/agora.db and SQL")

    monkeypatch.setattr(agora, "queue", boom)
    monkeypatch.setattr(agora, "post_idea", boom)
    assert api("/queue") == (500, {"error": "internal error", "code": "internal"})
    assert api("/ideas", body(ESCH)) == (500, {"error": "internal error", "code": "internal"})


def test_http_api_needs_a_length_and_times_out_a_slow_body(agora):
    server = make_server(agora, port=0, timeout=0.5)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with socket.create_connection(server.server_address, timeout=5) as conn:
            conn.sendall(b"POST /ideas HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\n{")
            assert conn.recv(4096).startswith(b"HTTP/1.0 408")
        with socket.create_connection(server.server_address, timeout=5) as conn:
            conn.sendall(b"POST /ideas HTTP/1.1\r\nHost: x\r\n\r\n")
            assert conn.recv(4096).startswith(b"HTTP/1.0 411")
    finally:
        server.shutdown()
        server.server_close()


def test_a_slow_drip_body_gets_408_within_the_total_deadline(agora):
    # One byte every 0.2 s never trips a per-recv timeout of 1 s; the 1 s total deadline does.
    server = make_server(agora, port=0, timeout=1.0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with socket.create_connection(server.server_address, timeout=10) as conn:
            conn.sendall(b"POST /ideas HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\n")
            start = time.monotonic()
            conn.setblocking(False)
            reply = b""
            while not reply and time.monotonic() - start < 8:
                try:
                    conn.sendall(b" ")
                except OSError:
                    pass
                time.sleep(0.2)
                try:
                    reply = conn.recv(4096)
                except BlockingIOError:
                    pass
            assert reply.startswith(b"HTTP/1.0 408")
            assert time.monotonic() - start < 3
    finally:
        server.shutdown()
        server.server_close()


def test_connections_beyond_the_cap_get_503(agora):
    server = make_server(agora, port=0, timeout=5.0, max_connections=1)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with socket.create_connection(server.server_address, timeout=5) as held:
            held.sendall(b"POST /ideas HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\n")
            time.sleep(0.3)  # the only slot is now busy reading this body
            with socket.create_connection(server.server_address, timeout=5) as extra:
                extra.sendall(b"GET /healthz HTTP/1.1\r\nHost: x\r\n\r\n")
                reply = extra.recv(4096)
                assert reply.startswith(b"HTTP/1.0 503") and b'"busy"' in reply
        deadline = time.monotonic() + 5
        while True:  # the slot comes back once the held connection ends
            with socket.create_connection(server.server_address, timeout=5) as conn:
                conn.sendall(b"GET /healthz HTTP/1.1\r\nHost: x\r\n\r\n")
                if conn.recv(4096).startswith(b"HTTP/1.0 200"):
                    break
            assert time.monotonic() < deadline
            time.sleep(0.1)
    finally:
        server.shutdown()
        server.server_close()


def test_server_binds_loopback_by_default(agora):
    server = make_server(agora, port=0)
    try:
        assert server.server_address[0] == "127.0.0.1"
    finally:
        server.server_close()


def test_cli_reports_a_database_it_cannot_open(tmp_path, capsys):
    db = str(tmp_path / "missing-dir" / "agora.db")
    assert main(["serve", "--db", db, "--port", "0", "--dev-insecure-key"]) == 2
    assert "d2-agora" in capsys.readouterr().err
