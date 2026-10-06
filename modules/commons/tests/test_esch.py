"""Seeding Commons from Esch-sur-Alzette's public sources, and reading it back over HTTP and CLI.

Fixtures are recorded, not invented:
- docket-recorded.json: a Docket snapshot built with Docket's parsers from pages Docket
  recorded (Esch council of 2026-10-02, councillor names already removed).
- esch-participation-projet-650.html: participation.esch.lu, Budget participatif 2026,
  recorded by Docket.
"""

from __future__ import annotations

import copy
import json
import threading
import urllib.request
from pathlib import Path

import pytest
from d2_commons import esch, ingest, library
from d2_commons.__main__ import main
from d2_commons.server import make_server
from jsonschema import Draft202012Validator, FormatChecker

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
SEED = HERE.parent / "seed" / "esch.json"
SCHEMA = HERE.parents[2] / "spec" / "schemas" / "argument.schema.json"
PROJECT_URL = "https://participation.esch.lu/projet/650/budget-participatif-2026"
POINT = "lu.esch.42063"
PROJECT = "lu.esch.participation.project.650"


def snapshot() -> dict:
    return json.loads((FIXTURES / "docket-recorded.json").read_text(encoding="utf-8"))


def project_page() -> str:
    return (FIXTURES / "esch-participation-projet-650.html").read_text(encoding="utf-8")


def built() -> library.Library:
    return ingest.build(snapshot(), [(PROJECT_URL, project_page())], "2026-10-06T00:00:00Z")


def test_council_votes_become_one_position_per_group_and_side():
    args = esch.positions_from_docket(snapshot())
    assert {a["matter_id"] for a in args} == {POINT}
    by_side = {
        s: sorted(a["attribution"] for a in args if a["stance_option_id"] == s)
        for s in ("yes", "no")
    }
    assert [x.split(" group")[0] for x in by_side["yes"]] == ["CSV", "DP", "déi gréng"]
    assert [x.split(" group")[0] for x in by_side["no"]] == ["ADR", "LSAP", "déi Lénk"]
    lsap = next(a for a in args if a["attribution"].startswith("LSAP"))
    assert lsap["text"] == (
        "LSAP: 6 councillors voted against at the Esch-sur-Alzette municipal council on 2026-10-02."
    )
    assert lsap["kind"] == "position"
    assert lsap["source_url"] == (
        "https://administration.esch.lu/sessions_conseil/conseil-communal-du-02-octobre-2026/"
    )


def test_positions_never_name_councillors_and_skip_abstentions():
    snap = snapshot()
    point = next(i for i in snap["items"] if i["id"] == POINT)
    point["votes"]["members"] = [{"name": "Example Councillor", "party": "CSV", "vote": "Oui"}]
    point["votes"]["by_party"]["CSV"]["Abstention"] = 1
    point["votes"]["by_party"][""] = {"Oui": 1}
    args = esch.positions_from_docket(snap)
    assert len(args) == 6
    assert "Example Councillor" not in json.dumps(args, ensure_ascii=False)


def test_project_page_proposals_are_attributed_to_the_platform_not_a_person():
    args = esch.proposals_from_project_page(project_page(), PROJECT_URL)
    assert len(args) == 8
    assert {a["matter_id"] for a in args} == {PROJECT}
    assert len({a["stance_option_id"] for a in args}) == 8
    first = args[0]
    assert first["text"].startswith("Improving public gym and calisthenics facilities: The public")
    assert first["source_url"] == (
        "https://participation.esch.lu/shout/3958989/improving-public-gym-and-calisthenics-facilities"
    )
    assert first["kind"] == "proposal" and first["attribution"].startswith("A resident")
    dumped = json.dumps(args, ensure_ascii=False)
    # Image links carry the poster's Hoplr user id; the city's contact line is not a proposal.
    for leak in ("uid", "hoplrcontent", "@", "621 357 733", "inter-actions"):
        assert leak not in dumped


def test_scrub_removes_contact_details_and_keeps_dates():
    text = "Call +352 621 123 456 or 26 12 34 56, mail jo.doe@example.lu, see www.example.lu/x"
    out = esch.scrub(text + "\nFrom 2026-09-19 to 31.10.2026, 200 books")
    assert "621" not in out and "26 12" not in out and "@" not in out and "example.lu" not in out
    assert out.count(esch.REMOVED) == 4
    assert "2026-09-19" in out and "31.10.2026" in out and "200 books" in out


def test_every_seeded_argument_matches_the_spec_schema():
    validator = Draft202012Validator(
        json.loads(SCHEMA.read_text(encoding="utf-8")), format_checker=FormatChecker()
    )
    lib = built()
    assert len(lib.arguments) == 14
    for arg in lib.arguments:
        assert not list(validator.iter_errors(arg)), arg["id"]


def test_committed_seed_is_what_the_fixtures_build():
    assert library.load(SEED).to_json() == built().to_json()


def test_bad_page_is_reported_not_fatal():
    errors: list[dict] = []
    lib = ingest.build(
        None, [("https://participation.esch.lu/news/1", "<html></html>")], "t", errors
    )
    assert lib.arguments == [] and errors[0]["url"].endswith("/news/1")
    with pytest.raises(ValueError):
        ingest.build(None, [("https://participation.esch.lu/news/1", "<html></html>")], "t")


def test_fetcher_waits_three_seconds_between_requests_and_stays_on_esch():
    now = [100.0]
    slept: list[float] = []

    def sleep(s: float) -> None:
        slept.append(s)
        now[0] += s

    f = ingest.Fetcher(clock=lambda: now[0], sleep=sleep)
    f._open = lambda url: b"<html></html>"
    for _ in range(3):
        f.get(PROJECT_URL)
        now[0] += 0.5  # parsing takes half a second
    assert slept == [2.5, 2.5]
    with pytest.raises(ValueError):
        f.get("https://example.org/")


def test_project_urls_come_from_the_snapshot():
    snap = {"items": [{"id": PROJECT, "urls": {"fr": PROJECT_URL}}, {"id": POINT, "urls": {}}]}
    assert ingest.project_urls(snap) == [PROJECT_URL]


def test_library_rejects_duplicates_and_bad_links():
    arg = copy.deepcopy(built().arguments[0])
    with pytest.raises(ValueError):
        library.Library([arg, arg])
    with pytest.raises(ValueError):
        library.Library([{**arg, "source_url": "javascript:alert(1)"}])


@pytest.fixture()
def api():
    server = make_server(library.load(SEED), port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    def get(path: str) -> tuple[int, dict]:
        try:
            with urllib.request.urlopen(base + path, timeout=5) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    yield get
    server.shutdown()
    server.server_close()


def test_http_api_returns_arguments_for_a_docket_item(api):
    assert api("/healthz") == (200, {"ok": True, "arguments": 14, "matters": 2})
    status, body = api(f"/matters/{POINT}/arguments")
    assert status == 200 and body["ranker"] is None and len(body["arguments"]) == 6
    status, body = api(f"/matters/{POINT}/arguments?stance=no")
    assert [a["stance_option_id"] for a in body["arguments"]] == ["no", "no", "no"]
    assert all(a["source_url"].startswith("https://") for a in body["arguments"])
    assert api("/matters/lu.chd.8752/arguments")[1]["arguments"] == []
    assert api("/matters/x/other")[0] == 404


def test_cli_prints_arguments_and_builds_the_seed(tmp_path, capsys):
    assert main(["arguments", "--library", str(SEED), POINT, "--stance", "yes"]) == 0
    assert len(json.loads(capsys.readouterr().out)["arguments"]) == 3
    out = tmp_path / "lib.json"
    page = f"{PROJECT_URL}={FIXTURES / 'esch-participation-projet-650.html'}"
    docket = str(FIXTURES / "docket-recorded.json")
    args = ["ingest", "--out", str(out), "--docket", docket, "--page", page]
    assert main([*args, "--generated-at", "2026-10-06T00:00:00Z"]) == 0
    assert out.read_text(encoding="utf-8") == SEED.read_text(encoding="utf-8")
    assert main(["arguments", "--library", str(tmp_path / "missing.json"), POINT]) == 2
