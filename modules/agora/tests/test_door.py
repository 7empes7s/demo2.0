"""Agora with Door: posts and upvotes need a Door presentation, checked by a real `d2-door serve`.

Nothing here is hand-made: the issuer key and the credentials come from `d2-door dev-world`
(mock identity provider, synthetic people), every presentation from `d2-door present` (the Rust
holder code) answering a challenge Agora issued, and every check from the Rust verifier over
HTTP. The binary is built with cargo if needed (tools/dev-setup.sh installs the toolchain).
"""

from __future__ import annotations

import base64
import functools
import hashlib
import json
import logging
import os
import shutil
import socket
import subprocess
import threading
import urllib.error
import urllib.request
from pathlib import Path

import d2_charter
import pytest
from d2_agora import Agora, Challenges, DoorNyms, IdentityError
from d2_agora.__main__ import main
from d2_agora.server import make_server

ROOT = Path(__file__).resolve().parents[3]
ESCH = "lu-commune-esch-sur-alzette"
CITY = "lu-commune-luxembourg"
COUNTRY = "lu"
CHARTER = d2_charter.Charter()
ESCH_PATH = ".".join(CHARTER.jurisdiction_path(ESCH))
CITY_PATH = ".".join(CHARTER.jurisdiction_path(CITY))


@functools.cache  # one build per test session
def _door_binary() -> Path:
    cargo = shutil.which("cargo") or str(Path.home() / ".cargo" / "bin" / "cargo")
    build = subprocess.run(
        [cargo, "build", "--quiet", "-p", "d2-door", "--bin", "d2-door"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=900,
    )
    assert build.returncode == 0, f"cargo build -p d2-door failed:\n{build.stderr}"
    # cargo resolves a relative CARGO_TARGET_DIR against its cwd (ROOT), so do the same here.
    target = ROOT / os.environ.get("CARGO_TARGET_DIR", "target")
    return target / "debug" / "d2-door"


class Door:
    """A dev world (issuer key and credentials) and a running `d2-door serve`."""

    def __init__(self, tmp: Path) -> None:
        self.bin = _door_binary()
        self.dir = tmp / "epoch1"
        self.other = tmp / "epoch2"
        self._run(
            "dev-world",
            "--out",
            str(self.dir),
            "--person",
            f"alice:adult:{ESCH_PATH}",
            "--person",
            f"bob:adult:{ESCH_PATH}",
            "--person",
            f"carol:minor:{ESCH_PATH}",
            "--person",
            f"dave:adult:{CITY_PATH}",
            "--person",
            "lu-only:adult:lu",
        )
        # Another issuer for epoch 2: Agora accepts epoch 1 only.
        self._run(
            "dev-world",
            "--out",
            str(self.other),
            "--epoch",
            "2",
            "--person",
            f"alice:adult:{ESCH_PATH}",
        )
        self.proc = subprocess.Popen(
            [self.bin, "serve", "--issuer-key", str(self.dir / "issuer-key.json"), "--port", "0"],
            stderr=subprocess.PIPE,
            text=True,
        )
        line = self.proc.stderr.readline()
        assert "d2-door verifier on http://" in line, line
        self.url = line.split()[3]

    def _run(self, *args: str) -> str:
        done = subprocess.run([self.bin, *args], capture_output=True, text=True, timeout=60)
        assert done.returncode == 0, done.stderr
        return done.stdout

    def present(self, who, context, challenge, levels=3, adult=True, epoch=1) -> dict:
        world = self.dir if epoch == 1 else self.other
        args = [
            "present",
            "--credential",
            str(world / f"{who}.credential.json"),
            "--issuer-key",
            str(world / "issuer-key.json"),
            "--context",
            context,
            "--challenge",
            challenge,
            "--levels",
            str(levels),
        ]
        return json.loads(self._run(*args, *(["--adult"] if adult else [])))

    def stop(self) -> None:
        self.proc.terminate()
        self.proc.wait(timeout=10)
        self.proc.stderr.close()


@pytest.fixture(scope="module")
def door(tmp_path_factory):
    d = Door(tmp_path_factory.mktemp("door"))
    yield d
    d.stop()


def _client(base: str):
    def call(path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(base + path, data=data)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    return call


@pytest.fixture
def agora_with(tmp_path):
    started = []

    def start(door_url: str):
        agora = Agora(tmp_path / f"agora{len(started)}.db", nyms=DoorNyms(door_url, epoch=1))
        server = make_server(agora, port=0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        started.append((agora, server))
        return agora, _client(f"http://127.0.0.1:{server.server_address[1]}")

    yield start
    for agora, server in started:
        server.shutdown()
        server.server_close()
        agora.close()


@pytest.fixture
def api(door, agora_with):
    return agora_with(door.url)[1]


def idea(jurisdiction, participant, n=1):
    return {
        "participant": participant,
        "jurisdiction_id": jurisdiction,
        "title": {"en": f"Synthetic idea {n}"},
        "text": {"en": "A synthetic test proposal."},
    }


def challenge(api) -> str:
    status, answer = api("/challenge")
    assert status == 200 and answer["expires_in"] == 120
    return answer["challenge"]


def nym_of(presentation: dict) -> str:
    """Door's short form, recomputed here: nym- + base32(SHA-256(point))[:26]."""
    digest = hashlib.sha256(bytes.fromhex(presentation["pseudonym"])).digest()
    return "nym-" + base64.b32encode(digest).decode().lower()[:26]


def ctx(jurisdiction):
    return f"agora:{jurisdiction}"


# --- the happy path, and one upvote per person ---------------------------------------------------


def test_post_and_upvote_with_a_door_presentation(door, api):
    assert api("/healthz")[1]["identity"] == "door"
    p = door.present("alice", ctx(ESCH), challenge(api))
    status, posted = api("/ideas", idea(ESCH, p))
    assert status == 201, posted
    assert posted["proposer_nym"] == nym_of(p)  # Door's nym, as Rust and Python both compute it
    assert "pseudonym" not in json.dumps(posted) and p["proof"] not in json.dumps(posted)

    upvote = f"/ideas/{posted['id']}/upvote"
    for who in ("alice", "bob"):
        p = door.present(who, ctx(ESCH), challenge(api))
        assert api(upvote, {"participant": p}) == (201, {"idea_id": posted["id"], "upvoted": True})


def test_same_person_same_nym_per_area_and_cannot_upvote_twice(door, api):
    p1 = door.present("alice", ctx(ESCH), challenge(api))
    _, posted = api("/ideas", idea(ESCH, p1))
    upvote = f"/ideas/{posted['id']}/upvote"
    p2 = door.present("alice", ctx(ESCH), challenge(api))
    assert api(upvote, {"participant": p2})[0] == 201
    # A fresh challenge and a fresh proof: still the same person in the same area.
    p3 = door.present("alice", ctx(ESCH), challenge(api))
    assert p3["proof"] != p2["proof"] and nym_of(p3) == nym_of(p2) == posted["proposer_nym"]
    status, err = api(upvote, {"participant": p3})
    assert (status, err["code"]) == (409, "duplicate_upvote")

    # Another area gives the same person an unlinkable nym.
    p4 = door.present("alice", ctx(COUNTRY), challenge(api), levels=1)
    status, national = api("/ideas", idea(COUNTRY, p4, 2))
    assert status == 201 and national["proposer_nym"] != posted["proposer_nym"]


# --- refusals ----------------------------------------------------------------------------------


def test_a_replayed_challenge_is_refused(door, api):
    p = door.present("bob", ctx(ESCH), challenge(api))
    assert api("/ideas", idea(ESCH, p))[0] == 201
    status, err = api("/ideas", idea(ESCH, p, 2))  # the same presentation again
    assert (status, err["code"]) == (400, "unknown_challenge")
    _, first = api("/queue")
    assert len(first["ideas"]) == 1

    # A challenge Agora never issued.
    p = door.present("bob", ctx(ESCH), "ab" * 32)
    assert api("/ideas", idea(ESCH, p))[1]["code"] == "unknown_challenge"


def test_a_presentation_for_another_context_is_refused(door, api):
    p = door.present("alice", ctx(COUNTRY), challenge(api), levels=1)
    status, err = api("/ideas", idea(ESCH, p))
    assert (status, err["code"]) == (403, "context_mismatch")
    # Editing the context field to match breaks the proof.
    p = door.present("alice", ctx(COUNTRY), challenge(api), levels=3)
    p["context"] = ctx(ESCH)
    assert api("/ideas", idea(ESCH, p))[1]["code"] == "invalid_proof"
    # So does editing the disclosed jurisdiction.
    p = door.present("dave", ctx(ESCH), challenge(api))
    p["disclosed"]["jurisdiction_path"] = ESCH_PATH
    assert api("/ideas", idea(ESCH, p))[1]["code"] == "invalid_proof"
    assert api("/queue")[1]["ideas"] == []


def test_a_jurisdiction_the_credential_does_not_cover_is_refused(door, api):
    # Dave lives in Luxembourg City: he cannot file or upvote in Esch.
    p = door.present("dave", ctx(ESCH), challenge(api))
    status, err = api("/ideas", idea(ESCH, p))
    assert (status, err["code"]) == (403, "jurisdiction_not_covered")
    p = door.present("alice", ctx(ESCH), challenge(api))
    _, esch_idea = api("/ideas", idea(ESCH, p))
    p = door.present("dave", ctx(ESCH), challenge(api))
    status, err = api(f"/ideas/{esch_idea['id']}/upvote", {"participant": p})
    assert (status, err["code"]) == (403, "jurisdiction_not_covered")
    # A credential that only says "lu" cannot disclose a commune.
    p = door.present("lu-only", ctx(ESCH), challenge(api), levels=1)
    assert api("/ideas", idea(ESCH, p))[1]["code"] == "missing_disclosure"
    # Disclosing fewer levels than the idea's jurisdiction has is not enough either.
    p = door.present("alice", ctx(ESCH), challenge(api), levels=2)
    assert api("/ideas", idea(ESCH, p))[1]["code"] == "missing_disclosure"

    # What remains of the widening gap: a resident may still file under an area that contains
    # their own (Esch -> lu). Pinned in test_agora.py; closing it needs a ScopeChallenge.
    p = door.present("alice", ctx(COUNTRY), challenge(api), levels=1)
    assert api("/ideas", idea(COUNTRY, p))[1]["scope_tier"] == "national"
    p = door.present("dave", ctx(CITY), challenge(api))
    assert api("/ideas", idea(CITY, p))[0] == 201


def test_a_minor_is_refused(door, api):
    p = door.present("carol", ctx(ESCH), challenge(api))
    status, err = api("/ideas", idea(ESCH, p))
    assert (status, err["code"]) == (403, "not_adult")
    # Not disclosing the adult flag at all is refused by Door.
    p = door.present("alice", ctx(ESCH), challenge(api), adult=False)
    assert api("/ideas", idea(ESCH, p))[1]["code"] == "missing_disclosure"


def test_another_epoch_is_refused(door, api):
    p = door.present("alice", ctx(ESCH), challenge(api), epoch=2)
    status, err = api("/ideas", idea(ESCH, p))
    assert (status, err["code"]) == (403, "epoch_mismatch")


@pytest.mark.parametrize(
    "participant",
    ["synthetic-participant-0001", None, 7, ["x"], ""],
)
def test_raw_participant_ids_are_refused_with_door(api, participant):
    status, err = api("/ideas", idea(ESCH, participant))
    assert (status, err["code"]) == (400, "presentation_required")


def test_a_malformed_presentation_is_refused(door, api):
    p = door.present("alice", ctx(ESCH), challenge(api))
    p["pseudonym"] = "00"
    status, err = api("/ideas", idea(ESCH, p))
    assert (status, err["code"]) == (400, "malformed")
    p = door.present("alice", ctx(ESCH), challenge(api))
    p["proof"] = p["proof"][:-2]
    assert api("/ideas", idea(ESCH, p))[1]["code"] == "malformed"


# --- Door down: writes fail closed, reads work ---------------------------------------------------


def _dead_url() -> str:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    return f"http://127.0.0.1:{port}"


def test_door_down_writes_fail_closed_reads_work(door, agora_with):
    agora, api = agora_with(door.url)
    p = door.present("alice", ctx(ESCH), challenge(api))
    _, posted = api("/ideas", idea(ESCH, p))

    # Same database, Door gone.
    agora.nyms = DoorNyms(_dead_url(), epoch=1)
    p = door.present("bob", ctx(ESCH), challenge(api))
    status, err = api("/ideas", idea(ESCH, p, 2))
    assert (status, err["code"]) == (503, "door_unavailable")
    p = door.present("bob", ctx(ESCH), challenge(api))
    status, err = api(f"/ideas/{posted['id']}/upvote", {"participant": p})
    assert (status, err["code"]) == (503, "door_unavailable")

    assert api("/healthz")[0] == 200
    assert [i["id"] for i in api("/queue")[1]["ideas"]] == [posted["id"]]
    assert api(f"/ideas/{posted['id']}")[0] == 200
    assert agora._db.execute("SELECT COUNT(*) FROM upvotes").fetchone() == (0,)


@pytest.mark.parametrize(
    "answer",
    [
        (500, {"error": "boom", "code": "internal"}),
        (200, {"nym": "not a nym", "disclosed": {}}),
        (200, {"nym": "nym-" + "a" * 26}),
        (200, ["not", "an", "object"]),
        (404, {"error": "not found", "code": "not_found"}),
        (422, {"code": "Not A Code"}),
        (400, {"code": "Not A Code"}),
        OSError("connection refused"),
        ValueError("not JSON"),
    ],
)
def test_door_answering_nonsense_is_unavailable(answer):
    def post(url, body, timeout):
        if isinstance(answer, Exception):
            raise answer
        return answer

    challenges = Challenges()
    nyms = DoorNyms(
        "http://127.0.0.1:1", epoch=1, charter=CHARTER, challenges=challenges, post=post
    )
    with pytest.raises(IdentityError) as err:
        nyms.nym({"challenge": challenges.issue()["challenge"]}, ctx(ESCH))
    assert (err.value.status, err.value.code) == (503, "door_unavailable")


@pytest.mark.parametrize("code", ["invalid_body", "something_new"])
def test_door_finding_agoras_request_bad_is_a_server_problem(code, caplog):
    # Door's 400 (other than a malformed presentation) means Agora sent something Door cannot
    # take, such as a Charter path deeper than Door's levels: 503 for the user, logged here.
    challenges = Challenges()
    nyms = DoorNyms(
        "http://127.0.0.1:1",
        epoch=1,
        charter=CHARTER,
        challenges=challenges,
        post=lambda url, body, timeout: (400, {"error": "secret detail", "code": code}),
    )
    presentation = {"challenge": challenges.issue()["challenge"], "pseudonym": "ab" * 48}
    with caplog.at_level(logging.ERROR, logger="d2_agora"):
        with pytest.raises(IdentityError) as err:
            nyms.nym(presentation, ctx(ESCH))
    assert (err.value.status, err.value.code) == (503, "door_unavailable")
    assert [r.getMessage() for r in caplog.records] == [
        f"Door answered 400 {code} to Agora's request"
    ]
    assert presentation["pseudonym"] not in caplog.text and "secret detail" not in caplog.text


def test_door_nyms_asks_door_for_the_idea_depth_and_the_one_epoch():
    seen = []

    def post(url, body, timeout):
        seen.append((url, body))
        return 200, {
            "nym": "nym-" + "a" * 26,
            "disclosed": {"jurisdiction_path": ESCH_PATH, "adult": True},
        }

    challenges = Challenges()
    nyms = DoorNyms(
        "http://door.local/", epoch=7, charter=CHARTER, challenges=challenges, post=post
    )
    c = challenges.issue()["challenge"]
    assert nyms.nym({"challenge": c}, ctx(ESCH)) == "nym-" + "a" * 26
    url, body = seen[0]
    assert url == "http://door.local/presentations/verify"
    assert body["epoch"] == 7 and body["context"] == ctx(ESCH) and body["challenge"] == c
    assert body["require"] == {"jurisdiction_levels": 3, "adult": True}
    with pytest.raises(IdentityError) as err:  # used up
        nyms.nym({"challenge": c}, ctx(ESCH))
    assert err.value.code == "unknown_challenge"
    for bad in (("ftp://x", 1), ("http://x", -1), ("http://x", True), ("http://x", 2**32)):
        with pytest.raises(ValueError):
            DoorNyms(*bad, charter=CHARTER)


# --- challenges -------------------------------------------------------------------------------


def test_challenges_are_single_use_short_lived_and_bounded():
    now = [1000.0]
    c = Challenges(ttl=120, max_outstanding=3, clock=lambda: now[0])
    first = c.issue()["challenge"]
    assert len(first) == 64 and int(first, 16) >= 0
    assert c.consume(first) == first
    with pytest.raises(IdentityError):
        c.consume(first)

    late = c.issue()["challenge"]
    now[0] += 120
    with pytest.raises(IdentityError):
        c.consume(late)

    issued = [c.issue()["challenge"] for _ in range(3)]  # `late` expired: pruned, not counted
    with pytest.raises(IdentityError) as err:  # full: refuse, never drop a live challenge
        c.issue()
    assert (err.value.status, err.value.code) == (503, "challenge_capacity")
    assert [c.consume(x) for x in issued] == issued
    now[0] += 1
    more = [c.issue()["challenge"] for _ in range(3)]
    now[0] += 120  # all expired: room again
    c.issue()
    with pytest.raises(IdentityError):
        c.consume(more[0])
    for bad in (None, 7, "", "zz", "AB" * 32, "a" * 129):
        with pytest.raises(IdentityError) as err:
            c.consume(bad)
        assert err.value.code == "unknown_challenge"


def test_a_flood_of_challenges_cannot_cancel_a_legitimate_one():
    c = Challenges(max_outstanding=1000)
    mine = c.issue()["challenge"]
    refused = 0
    for _ in range(5000):
        try:
            c.issue()
        except IdentityError as exc:
            assert exc.code == "challenge_capacity"
            refused += 1
    assert refused == 5000 - 999
    assert c.consume(mine) == mine


def test_challenge_capacity_over_http(door, tmp_path):
    agora = Agora(tmp_path / "agora.db", nyms=DoorNyms(door.url, epoch=1))
    agora.nyms.challenges = Challenges(max_outstanding=2)
    server = make_server(agora, port=0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    api = _client(f"http://127.0.0.1:{server.server_address[1]}")
    try:
        mine = challenge(api)
        challenge(api)
        status, err = api("/challenge")
        assert (status, err["code"]) == (503, "challenge_capacity")
        p = door.present("alice", ctx(ESCH), mine)
        assert api("/ideas", idea(ESCH, p))[0] == 201
    finally:
        server.shutdown()
        server.server_close()
        agora.close()


# --- epoch ------------------------------------------------------------------------------------


def test_the_database_keeps_its_door_epoch(tmp_path):
    db = tmp_path / "agora.db"
    agora = Agora(db, nyms=DoorNyms("http://127.0.0.1:1", epoch=1, charter=CHARTER))
    agora.accept_door_epoch(1)
    agora.accept_door_epoch(1)
    agora.close()
    agora = Agora(db, nyms=DoorNyms("http://127.0.0.1:1", epoch=2, charter=CHARTER))
    with pytest.raises(ValueError) as err:
        agora.accept_door_epoch(2)
    assert err.value.code == "epoch_changed"
    agora.accept_door_epoch(2, new=True)
    agora.accept_door_epoch(2)
    with pytest.raises(ValueError):
        agora.accept_door_epoch(1)
    agora.close()


def test_cli_refuses_another_door_epoch_without_new_epoch(tmp_path, monkeypatch, capsys):
    db = tmp_path / "agora.db"
    agora = Agora(db, nyms=DoorNyms("http://127.0.0.1:1", epoch=1, charter=CHARTER))
    agora.accept_door_epoch(1)
    agora.close()
    monkeypatch.setenv("DOOR_URL", "http://127.0.0.1:1")
    assert main(["serve", "--db", str(db), "--port", "0", "--door-epoch", "2"]) == 2
    assert "--new-epoch" in capsys.readouterr().err
    # With --new-epoch the epoch is stored; stop at serving (a bad host fails after the check).
    args = ["serve", "--db", str(db), "--door-epoch", "2", "--new-epoch", "--host", "256.0.0.1"]
    assert main(args) == 2
    agora = Agora(db, nyms=DoorNyms("http://127.0.0.1:1", epoch=2, charter=CHARTER))
    agora.accept_door_epoch(2)  # now the stored one
    agora.close()


# --- CLI ----------------------------------------------------------------------------------------


def test_cli_door_configuration(tmp_path, monkeypatch, capsys):
    db = str(tmp_path / "agora.db")
    monkeypatch.setenv("DOOR_URL", "http://127.0.0.1:8092")
    monkeypatch.delenv("DOOR_EPOCH", raising=False)
    assert main(["serve", "--db", db, "--port", "0"]) == 2
    assert "DOOR_EPOCH" in capsys.readouterr().err
    args = ["serve", "--db", db, "--door-epoch", "1", "--dev-identity", "--dev-insecure-key"]
    assert main(args) == 2
    assert "Door is configured" in capsys.readouterr().err
    assert main(["serve", "--db", db, "--door-epoch", "1", "--dev-insecure-key"]) == 2
    assert "--dev-identity" in capsys.readouterr().err
    assert main(["serve", "--db", db, "--door-epoch", "x"]) == 2
    monkeypatch.setenv("DOOR_URL", "file:///etc/passwd")
    assert main(["serve", "--db", db, "--door-epoch", "1"]) == 2
