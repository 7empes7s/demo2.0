"""ScopeChallenge v1: contesting an idea's tier, decided by a Lottery panel.

Every idea, participant and district here is synthetic. Panels are drawn by the real Lottery CLI
from a recorded drand beacon (see conftest.py), so no test touches the network.
"""

import json
import sqlite3
import subprocess
import threading
import urllib.error
import urllib.request
from datetime import timedelta
from pathlib import Path

import d2_charter
import pytest
from d2_agora import Agora, AgoraError, KeyedNyms, LotteryCli, ReadOnly
from d2_agora.agora import DRAW_DELAY
from d2_agora.server import make_server
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

SPEC = Path(__file__).resolve().parents[3] / "spec" / "schemas"
_SCHEMAS = [json.loads(p.read_text()) for p in SPEC.glob("*.schema.json")]
_REGISTRY = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in _SCHEMAS)


def _validator(name):
    return Draft202012Validator(
        json.loads((SPEC / f"{name}.schema.json").read_text()),
        registry=_REGISTRY,
        format_checker=FormatChecker(),
    )


IDEA_SCHEMA = _validator("idea")
CHALLENGE_SCHEMA = _validator("scope-challenge")

COUNTRY = "lu"  # national
CANTON_ESCH = "lu-canton-esch-sur-alzette"  # regional
CANTON_LUX = "lu-canton-luxembourg"  # regional
CITY = "lu-commune-luxembourg"  # regional, inside CANTON_LUX
ESCH = "lu-commune-esch-sur-alzette"  # local
DISTRICT = "synthetic-district-1"  # minor: a test-only place with 500 people, inside ESCH
NYMS = KeyedNyms(b"synthetic-test-key-not-a-secret-0123456789")
PROPOSER, CHALLENGER = 1, 2
RESIDENTS = range(10, 17)  # seven residents who upvote, so the pool has 7 besides those two


def who(n: int) -> str:
    return f"synthetic-participant-{n:04d}"


def nym(n: int, jurisdiction: str) -> str:
    return NYMS.nym(who(n), f"agora:{jurisdiction}")


class Clock:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t

    def tick(self, **kw):
        self.t += timedelta(**kw)


CHARTER = d2_charter.Charter(
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


@pytest.fixture
def clock(open_at):
    return Clock(open_at - timedelta(minutes=10))


@pytest.fixture
def agora(clock, lottery):
    a = Agora(charter=CHARTER, nyms=NYMS, now=clock, lottery=lottery)
    yield a
    a.close()


def post(agora, jurisdiction, n=PROPOSER, title="Synthetic commune bench repair"):
    return agora.post_idea(
        {
            "participant": who(n),
            "jurisdiction_id": jurisdiction,
            "topic_ids": ["synthetic.parks"],
            "title": {"en": title},
            "text": {"en": "A synthetic test proposal."},
        }
    )


def widened(agora, clock, open_at, jurisdiction=COUNTRY):
    """An Esch matter filed under a wider area, upvoted by seven residents; the clock then
    stands at the moment the recorded round is one hour away."""
    idea = post(agora, jurisdiction)
    for n in RESIDENTS:
        agora.upvote(idea["id"], who(n))
    clock.t = open_at
    return idea


def contest(agora, idea, n=CHALLENGER, jurisdiction=ESCH):
    return agora.open_challenge(
        idea["id"], {"participant": who(n), "jurisdiction_id": jurisdiction}
    )


def drawn(agora, clock, challenge):
    clock.tick(seconds=DRAW_DELAY.total_seconds())
    ch = agora.challenge(challenge["id"])
    assert ch["panel"] is not None
    return ch


def panel_members(ch, jurisdiction=COUNTRY):
    by_nym = {nym(n, jurisdiction): n for n in range(1, 50)}
    return [by_nym[p] for p in ch["panel"]]


def vote(agora, ch, n, choice):
    return agora.vote_challenge(ch["id"], {"participant": who(n), "vote": choice})


def code(fn, *args):
    with pytest.raises(AgoraError) as exc:
        fn(*args)
    return exc.value.status, exc.value.code


# --- opening ------------------------------------------------------------------------------------


def test_opening_a_challenge_marks_the_idea_contested_and_keeps_its_tier(
    agora, clock, open_at, beacons
):
    idea = widened(agora, clock, open_at)
    other = post(agora, COUNTRY, n=3, title="Synthetic national rail plan")
    assert [i["id"] for i in agora.queue()] == [idea["id"], other["id"]]

    ch = contest(agora, idea)
    assert not list(CHALLENGE_SCHEMA.iter_errors(ch))
    assert ch["status"] == "open" and ch["panel"] is None and ch["outcome"] is None
    assert (ch["from_jurisdiction_id"], ch["from_tier"]) == (COUNTRY, "national")
    assert (ch["proposed_jurisdiction_id"], ch["proposed_tier"]) == (ESCH, "local")
    assert ch["challenger_nym"] == nym(CHALLENGER, COUNTRY)
    assert ch["panel_size"] == CHARTER.param("scope_challenge.panel_size") == 5
    assert ch["deadline"] == "2023-01-30T12:09:30.000000Z"  # opened_at + 7 days (Charter)
    commitment = ch["draw"]["commitment"]
    assert commitment["purpose"] == "scope-challenge"
    assert commitment["context"] == f"agora.scope-challenge.{ch['id']}"
    assert beacons(commitment["round"]) is not None  # the recorded round, an hour away
    # The pool: the seven upvoters and the other national idea's proposer.
    assert commitment["pool_size"] == len(ch["draw"]["pool"]) == len(RESIDENTS) + 1

    stored = agora.idea(idea["id"])
    assert stored["contested"] is True and stored["scope_tier"] == "national"
    assert not list(IDEA_SCHEMA.iter_errors(stored))
    # Contested ideas keep their place until the panel decides.
    assert [i["id"] for i in agora.queue()] == [idea["id"], other["id"]]
    assert [c["id"] for c in agora.challenges_of(idea["id"])] == [ch["id"]]
    assert agora.idea(other["id"])["contested"] is False


def test_the_pool_is_the_area_minus_proposer_and_challenger(agora, clock, open_at):
    idea = widened(agora, clock, open_at)
    # Activity in another area does not put anyone in this pool: nyms are per area.
    elsewhere = post(agora, ESCH, n=40)
    agora.upvote(elsewhere["id"], who(41))
    ch = contest(agora, idea)
    assert ch["draw"]["pool"] == sorted(nym(n, COUNTRY) for n in RESIDENTS)
    assert nym(PROPOSER, COUNTRY) not in ch["draw"]["pool"]
    assert nym(CHALLENGER, COUNTRY) not in ch["draw"]["pool"]


def test_a_participant_challenges_an_idea_once_and_one_challenge_is_open_at_a_time(
    agora, clock, open_at
):
    idea = widened(agora, clock, open_at, jurisdiction=CANTON_ESCH)
    ch = contest(agora, idea)
    assert code(contest, agora, idea) == (409, "duplicate_challenge")
    assert code(contest, agora, idea, 3) == (409, "challenge_open")
    # Upheld by the panel: the same participant still cannot try again, someone else can.
    ch = drawn(agora, clock, ch)
    for n in panel_members(ch, CANTON_ESCH)[:3]:
        vote(agora, ch, n, "uphold")
    assert agora.challenge(ch["id"])["status"] == "upheld"
    assert code(contest, agora, idea) == (409, "duplicate_challenge")
    assert contest(agora, idea, 3)["status"] == "open"


def test_the_proposer_cannot_challenge_their_own_idea(agora, clock, open_at):
    idea = widened(agora, clock, open_at)
    assert code(contest, agora, idea, PROPOSER) == (403, "own_idea")
    assert agora.idea(idea["id"])["contested"] is False


@pytest.mark.parametrize(
    "filed,proposed,want",
    [
        (ESCH, COUNTRY, "not_narrower"),  # wider: a challenge never raises a tier
        (ESCH, CANTON_ESCH, "not_narrower"),  # the parent area
        (ESCH, CITY, "not_narrower"),  # a sibling commune, not inside
        (ESCH, ESCH, "not_narrower"),  # the same area
        (CANTON_LUX, CITY, "not_narrower"),  # inside, but the same tier (both regional)
        (COUNTRY, "lu-commune-nowhere", "unknown_jurisdiction"),
        (COUNTRY, "LU", "invalid_field"),
    ],
)
def test_a_challenge_cannot_widen_a_tier_or_name_a_same_tier_area(
    agora, clock, open_at, filed, proposed, want
):
    idea = widened(agora, clock, open_at, jurisdiction=filed)
    assert code(contest, agora, idea, CHALLENGER, proposed) == (400, want)
    assert agora.idea(idea["id"])["contested"] is False


def test_the_body_is_exactly_participant_and_jurisdiction(agora, clock, open_at):
    idea = widened(agora, clock, open_at)
    body = {"participant": who(CHALLENGER), "jurisdiction_id": ESCH}
    assert code(agora.open_challenge, idea["id"], {**body, "scope_tier": "minor"}) == (
        400,
        "unknown_field",
    )
    assert code(agora.open_challenge, idea["id"], {"participant": who(2)}) == (400, "invalid_body")
    assert code(agora.open_challenge, idea["id"], []) == (400, "invalid_body")
    assert code(agora.open_challenge, "0" * 26, body) == (404, "unknown_idea")
    assert code(agora.challenge, "0" * 26) == (404, "unknown_challenge")


def test_too_few_participants_for_a_panel(agora, clock, open_at):
    idea = post(agora, COUNTRY)
    for n in list(RESIDENTS)[:4]:
        agora.upvote(idea["id"], who(n))
    clock.t = open_at
    assert code(contest, agora, idea) == (409, "panel_pool_too_small")


def test_without_a_lottery_challenges_are_unavailable(clock, open_at):
    a = Agora(charter=CHARTER, nyms=NYMS, now=clock)
    idea = widened(a, clock, open_at)
    assert code(contest, a, idea) == (503, "lottery_unavailable")
    broken = Agora(charter=CHARTER, nyms=NYMS, now=clock, lottery=LotteryCli(["false"]))
    idea = widened(broken, clock, open_at)
    assert code(contest, broken, idea) == (503, "lottery_unavailable")
    assert broken.idea(idea["id"])["contested"] is False


# --- the panel draw -----------------------------------------------------------------------------


def test_the_panel_is_drawn_only_when_the_round_is_due(agora, clock, open_at):
    idea = widened(agora, clock, open_at)
    ch = contest(agora, idea)
    # The recorded beacon is at hand, but the round is not due yet: no panel.
    clock.tick(seconds=DRAW_DELAY.total_seconds() - 1)
    assert agora.challenge(ch["id"])["panel"] is None
    assert code(vote, agora, ch, RESIDENTS[0], "narrow") == (409, "panel_not_drawn")
    clock.tick(seconds=1)
    ch = agora.challenge(ch["id"])
    assert len(ch["panel"]) == 5 and set(ch["panel"]) <= set(ch["draw"]["pool"])
    assert not list(CHALLENGE_SCHEMA.iter_errors(ch))
    assert agora.challenge(ch["id"])["panel"] == ch["panel"]  # stored once, stable


def test_the_panel_draw_is_reproducible_from_the_published_inputs(
    agora, clock, open_at, tmp_path, lottery_cmd, beacons
):
    idea = widened(agora, clock, open_at)
    ch = drawn(agora, clock, contest(agora, idea))
    transcript = ch["draw"]["transcript"]
    assert transcript["result"]["selected"] == ch["panel"]
    assert [m["nym"] for m in transcript["pool"]] == ch["draw"]["pool"]

    # Anyone verifies the transcript with the Lottery's own verifier...
    path = tmp_path / "transcript.json"
    path.write_text(json.dumps(transcript))
    done = subprocess.run(
        [*lottery_cmd, "verify", "--transcript", str(path)], capture_output=True, text=True
    )
    assert done.returncode == 0, done.stderr
    assert done.stdout.startswith("ok: 5 selected from 7 (round 2634945)")

    # ...and re-running the draw from the stored commitment, pool and beacon gives the same panel.
    again = LotteryCli(lottery_cmd, chain="default", beacon=beacons).draw(
        ch["draw"]["commitment"], ch["draw"]["pool"]
    )
    assert again["result"]["selected"] == ch["panel"]


def test_a_failed_draw_leaves_the_panel_undrawn_and_is_retried(
    clock, open_at, lottery, lottery_cmd
):
    flaky = LotteryCli(lottery_cmd, chain="default", beacon=lambda r: None)
    a = Agora(charter=CHARTER, nyms=NYMS, now=clock, lottery=flaky)
    idea = widened(a, clock, open_at)
    ch = contest(a, idea)
    clock.tick(hours=2)
    assert a.challenge(ch["id"])["panel"] is None  # beacon not available
    a.lottery = LotteryCli(["false"])
    assert a.challenge(ch["id"])["panel"] is None  # Lottery failing
    a.lottery = lottery
    assert len(a.challenge(ch["id"])["panel"]) == 5


# --- votes and the decision ---------------------------------------------------------------------


def test_a_majority_to_narrow_recomputes_the_tier_with_scope(agora, clock, open_at):
    idea = widened(agora, clock, open_at)
    rival = post(agora, COUNTRY, n=3, title="Synthetic national rail plan")
    honest = post(agora, ESCH, n=4, title="Synthetic Esch library hours")
    ch = drawn(agora, clock, contest(agora, idea))
    members = panel_members(ch)
    outsider = next(n for n in RESIDENTS if n not in members)
    assert code(vote, agora, ch, outsider, "narrow") == (403, "not_on_panel")
    assert code(vote, agora, ch, CHALLENGER, "narrow") == (403, "not_on_panel")
    assert code(vote, agora, ch, members[0], "maybe") == (400, "invalid_field")

    assert vote(agora, ch, members[0], "narrow") == {"challenge_id": ch["id"], "voted": True}
    assert code(vote, agora, ch, members[0], "uphold") == (409, "duplicate_vote")
    vote(agora, ch, members[1], "uphold")
    vote(agora, ch, members[2], "narrow")
    assert agora.challenge(ch["id"])["status"] == "open"
    vote(agora, ch, members[3], "narrow")  # 3 of 5: decided at once

    ch = agora.challenge(ch["id"])
    assert not list(CHALLENGE_SCHEMA.iter_errors(ch))
    assert ch["status"] == "narrowed"
    assert ch["outcome"]["decided_by"] == "majority"
    assert ch["outcome"]["votes"] == {"uphold": 1, "narrow": 3}
    want = CHARTER.tier({"jurisdiction_id": ESCH, "topic_ids": ["synthetic.parks"]})
    assert (ch["outcome"]["jurisdiction_id"], ch["outcome"]["scope_tier"]) == (ESCH, want)
    assert code(vote, agora, ch, members[4], "uphold") == (409, "challenge_closed")

    now = agora.idea(idea["id"])
    assert not list(IDEA_SCHEMA.iter_errors(now))
    assert (now["jurisdiction_id"], now["filed_jurisdiction_id"]) == (ESCH, COUNTRY)
    assert (now["scope_tier"], now["contested"]) == ("local", False)
    assert now["charter_version"] == CHARTER.version
    # The queue now ranks it as the commune matter it is, among Esch's ideas, not the country's.
    assert [i["id"] for i in agora.queue()] == [rival["id"], idea["id"], honest["id"]]
    assert [i["id"] for i in agora.queue([COUNTRY])] == [rival["id"]]
    assert {i["id"] for i in agora.queue([ESCH])} == {idea["id"], honest["id"]}
    # The stored idea row itself is untouched (append-only): only an outcome row was added.
    row = agora._db.execute(
        "SELECT jurisdiction_id, scope_tier FROM ideas WHERE id = ?", (idea["id"],)
    )
    assert row.fetchone() == (COUNTRY, "national")


def test_a_majority_to_uphold_keeps_the_tier(agora, clock, open_at):
    idea = widened(agora, clock, open_at)
    ch = drawn(agora, clock, contest(agora, idea))
    for n in panel_members(ch)[:3]:
        vote(agora, ch, n, "uphold")
    ch = agora.challenge(ch["id"])
    assert ch["status"] == "upheld" and ch["outcome"]["votes"] == {"uphold": 3, "narrow": 0}
    now = agora.idea(idea["id"])
    assert (now["jurisdiction_id"], now["scope_tier"], now["contested"]) == (
        COUNTRY,
        "national",
        False,
    )


def test_a_narrowed_idea_cannot_be_challenged_back_up(agora, clock, open_at):
    idea = widened(agora, clock, open_at, jurisdiction=CANTON_ESCH)
    ch = drawn(agora, clock, contest(agora, idea))
    for n in panel_members(ch, CANTON_ESCH)[:3]:
        vote(agora, ch, n, "narrow")
    assert agora.idea(idea["id"])["scope_tier"] == "local"
    # Back to the canton or the country: refused. Further down (the district): allowed.
    assert code(contest, agora, idea, 3, CANTON_ESCH) == (400, "not_narrower")
    assert code(contest, agora, idea, 3, COUNTRY) == (400, "not_narrower")
    deeper = contest(agora, idea, 3, DISTRICT)
    assert (deeper["from_jurisdiction_id"], deeper["from_tier"]) == (ESCH, "local")
    assert deeper["proposed_tier"] == "minor"


def test_after_narrowing_upvotes_still_count_once_per_participant(agora, clock, open_at):
    idea = widened(agora, clock, open_at)
    ch = drawn(agora, clock, contest(agora, idea))
    for n in panel_members(ch)[:3]:
        vote(agora, ch, n, "narrow")
    # The nym context stays the filed area, so nobody gets a second nym for the same idea.
    assert code(agora.upvote, idea["id"], who(RESIDENTS[0])) == (409, "duplicate_upvote")
    agora.upvote(idea["id"], who(CHALLENGER))
    clock.tick(days=2)
    assert agora.idea(idea["id"])["upvote_count"] == len(RESIDENTS) + 1


# --- the deadline -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "votes,want",
    [
        (["narrow", "narrow", "uphold"], "narrowed"),  # more narrow than uphold among votes cast
        (["narrow", "uphold"], "upheld"),  # a tie keeps the tier
        ([], "upheld"),  # nobody voted: the tier stays
        (["uphold"], "upheld"),
    ],
)
def test_at_the_deadline_the_votes_cast_decide(agora, clock, open_at, votes, want):
    idea = widened(agora, clock, open_at)
    ch = drawn(agora, clock, contest(agora, idea))
    for n, choice in zip(panel_members(ch), votes, strict=False):
        vote(agora, ch, n, choice)
    clock.t = open_at + timedelta(days=7) - timedelta(microseconds=1)
    assert agora.idea(idea["id"])["contested"] is True
    clock.tick(microseconds=1)
    # Any read settles it: the queue shows the outcome without anyone opening the challenge.
    listed = next(i for i in agora.queue() if i["id"] == idea["id"])
    assert listed["contested"] is False
    assert listed["scope_tier"] == ("local" if want == "narrowed" else "national")
    ch = agora.challenge(ch["id"])
    assert ch["status"] == want and ch["outcome"]["decided_by"] == "deadline"
    assert ch["outcome"]["decided_at"] == ch["deadline"]
    assert ch["outcome"]["votes"] == {
        "uphold": votes.count("uphold"),
        "narrow": votes.count("narrow"),
    }
    assert code(vote, agora, ch, panel_members(ch)[4], "narrow") == (409, "challenge_closed")


def test_a_panel_never_drawn_by_the_deadline_upholds(clock, open_at, lottery_cmd):
    a = Agora(
        charter=CHARTER,
        nyms=NYMS,
        now=clock,
        lottery=LotteryCli(lottery_cmd, chain="default", beacon=lambda r: None),
    )
    idea = widened(a, clock, open_at)
    ch = contest(a, idea)
    clock.tick(days=8)
    ch = a.challenge(ch["id"])
    assert (ch["status"], ch["panel"], ch["outcome"]["decided_by"]) == ("upheld", None, "deadline")


# --- storage and HTTP ---------------------------------------------------------------------------


def test_challenge_tables_are_append_only(agora, clock, open_at):
    idea = widened(agora, clock, open_at)
    ch = drawn(agora, clock, contest(agora, idea))
    for n in panel_members(ch)[:3]:
        vote(agora, ch, n, "uphold")
    for sql in (
        "UPDATE scope_challenge_outcomes SET outcome = 'narrowed'",
        "DELETE FROM scope_challenge_outcomes",
        "UPDATE scope_challenges SET proposed_jurisdiction_id = 'lu'",
        "DELETE FROM scope_challenge_votes",
        "DELETE FROM scope_challenge_draws",
        "INSERT OR REPLACE INTO scope_challenge_outcomes SELECT challenge_id, 'narrowed',"
        " decided_by, uphold_votes, narrow_votes, jurisdiction_id, scope_tier, charter_version,"
        " decided_at FROM scope_challenge_outcomes",
    ):
        with pytest.raises(sqlite3.DatabaseError, match="append-only"):
            agora._db.execute(sql)
    assert agora.challenge(ch["id"])["status"] == "upheld"


def _client(base):
    def call(path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(base + path, data=data)) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    return call


@pytest.fixture
def serve():
    started = []

    def start(agora):
        server = make_server(agora, port=0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        started.append(server)
        return _client(f"http://127.0.0.1:{server.server_address[1]}")

    yield start
    for server in started:
        server.shutdown()
        server.server_close()


def test_http_api(agora, clock, open_at, serve):
    api = serve(agora)
    idea = widened(agora, clock, open_at)
    status, ch = api(
        f"/ideas/{idea['id']}/challenges", {"participant": who(CHALLENGER), "jurisdiction_id": ESCH}
    )
    assert status == 201 and ch["status"] == "open"
    assert api(f"/ideas/{idea['id']}")[1]["contested"] is True
    assert api(f"/challenges/{ch['id']}")[1]["panel"] is None
    assert api(f"/ideas/{idea['id']}/challenges") == (200, {"challenges": [ch]})
    status, err = api(
        f"/ideas/{idea['id']}/challenges", {"participant": who(PROPOSER), "jurisdiction_id": ESCH}
    )
    assert (status, err["code"]) == (403, "own_idea")
    status, err = api(
        f"/ideas/{idea['id']}/challenges", {"participant": who(3), "jurisdiction_id": ESCH}
    )
    assert (status, err["code"]) == (409, "challenge_open")
    assert api(f"/challenges/{'0' * 26}")[0] == 404

    clock.tick(seconds=DRAW_DELAY.total_seconds())
    status, ch = api(f"/challenges/{ch['id']}")
    assert status == 200 and len(ch["panel"]) == 5
    for n in panel_members(ch)[:3]:
        assert api(f"/challenges/{ch['id']}/votes", {"participant": who(n), "vote": "narrow"}) == (
            201,
            {"challenge_id": ch["id"], "voted": True},
        )
    status, err = api(f"/challenges/{ch['id']}/votes", {"participant": who(1), "vote": "x", "y": 1})
    assert (status, err["code"]) == (400, "invalid_body")
    assert api(f"/challenges/{ch['id']}")[1]["status"] == "narrowed"
    status, page = api(f"/queue?jurisdiction={ESCH}")
    assert [i["id"] for i in page["ideas"]] == [idea["id"]]
    assert page["ideas"][0]["scope_tier"] == "local"


def test_read_only_refuses_challenges_and_votes(clock, serve):
    a = Agora(charter=CHARTER, nyms=ReadOnly(), now=clock)
    api = serve(a)
    for path in (f"/ideas/{'0' * 26}/challenges", f"/challenges/{'0' * 26}/votes"):
        status, err = api(path, {"participant": "x"})
        assert (status, err["code"]) == (403, "read_only")
    a.close()
