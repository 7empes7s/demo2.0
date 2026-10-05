import hashlib
from datetime import date
from pathlib import Path

import pytest
from d2_docket import chd, esch, snapshot
from d2_docket.__main__ import main, sources_arg
from d2_docket.fetch import Fetched, FetchError

FIX = Path(__file__).parent / "fixtures"


def read(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


def test_sessions_list_has_dates_and_official_links():
    links = esch.parse_sessions_list(read("esch-seances-2026.html"))
    assert [link.date for link in links[:3]] == ["2026-10-23", "2026-10-02", "2026-09-16"]
    oct2 = links[1]
    assert oct2.url == (
        "https://administration.esch.lu/sessions_conseil/conseil-communal-du-02-octobre-2026/"
    )
    assert oct2.title == "Séance Ordinaire"
    assert oct2.duration == "De 08:30 à 13:00"
    assert oct2.closed_duration == "De 09:00 à 09:30"
    assert links[2].closed_duration is None  # 16 September had no closed part
    assert len(links) == 9


def test_session_page_votes_and_video():
    past = esch.parse_session_page(read("esch-session-2026-10-02.html"))
    assert 42065 in past.voted_item_ids and 42063 in past.voted_item_ids
    assert 42146 not in past.voted_item_ids  # the swearing-in has no vote
    upcoming = esch.parse_session_page(read("esch-session-2026-10-23.html"))
    assert upcoming.voted_item_ids == []
    assert upcoming.live and upcoming.video_url.startswith("https://esch.tv/stream/")


def test_sessions_api():
    sessions = esch.parse_sessions_api(read("esch-api-sessions-2026.json"))
    oct2 = next(s for s in sessions if s.id == 1522)
    assert oct2.date == "2026-10-02" and oct2.announced == "2026-09-25"
    assert oct2.nature == "Ordinaire"
    assert "Sarah Moreira" in oct2.present and oct2.excused == []
    assert [d.kind for d in oct2.documents] == ["ordre_du_jour", "ordre_du_jour"]
    assert oct2.documents[0].url == (
        "https://workflow.esch.lu/api/api/v1/Sessions/GetDocument/1522/427066"
    )
    oct23 = next(s for s in sessions if s.id == 1547)
    assert oct23.date == "2026-10-23" and oct23.present == [] and oct23.documents == []


def test_points_api():
    points = esch.parse_points_api(read("esch-api-agendaitems-1522.json"), "2026-10-02")
    assert len(points) == 72
    assert points[0].number is None and points[0].title.startswith("Assermentation")
    pap = next(p for p in points if p.id == 42063)
    assert pap.number == "6.1"
    assert pap.title.startswith("PAP Quai Neiduerf ; vote complémentaire")
    assert pap.status == "Délibéré" and pap.category == "Plans d'Aménagement"
    assert pap.group == "Développement urbain"
    assert len(pap.documents) == 6 and pap.documents[0].kind == "deliberation"
    assert pap.documents[0].url.endswith("/AgendaItems/GetDocument/42063/427441")
    assert next(p for p in points if p.title.startswith("Contrat de locatioin")).number == "8.10"
    assert next(p for p in points if p.id == 42066).status == "En cours"


def test_votes_api():
    votes = esch.parse_votes_api(read("esch-api-votes-42063.json"))
    assert votes["counts"] == {"Oui": 11, "Non": 8}
    assert sum(votes["by_party"]["LSAP"].values()) >= 1
    assert {"name": "Ben Funck", "party": "LSAP", "vote": "Non"} in votes["members"]
    assert all(set(m) == {"name", "party", "vote"} for m in votes["members"])  # no login names
    assert esch.parse_votes_api("[]") is None


def test_votes_without_a_vote_or_party_are_never_keyed_null():
    raw = '[{"vote": null, "politicalMember": {"user": {"displayName": "A B"}}}, {"vote": "Oui"}]'
    votes = esch.parse_votes_api(raw)
    assert votes["counts"] == {"": 1, "Oui": 1}
    assert votes["by_party"] == {"": {"": 1, "Oui": 1}}
    assert votes["members"][0] == {"name": "A B", "party": None, "vote": None}


def test_dates_and_times():
    assert esch.iso_french("19 sept. 2026") == "2026-09-19"
    assert esch.iso_french("31 déc. 2026") == "2026-12-31"
    assert esch.iso_french("Terminé le 16 juillet 2026") == "2026-07-16"
    assert esch.iso_french("452 jours restants") is None
    # impossible days are no date, not a crash
    assert esch.iso_slash("31/02/2026") is None
    assert esch.iso_french("32 janvier 2026") is None
    assert esch.time_range("De 08:30 à 13:00") == ("08:30", "13:00")
    assert esch.time_range("") == (None, None)


def test_participation_home():
    tiles = esch.parse_participation_home(read("esch-participation-home.html"))
    by_id = {t.id: t for t in tiles}
    assert set(by_id) == {"650", "5nz2vmj7zj", "1z8l57r68j", "b215h5nzxl", "lvdzxa76kz"}
    project = by_id["650"]
    assert project.kind == "project" and project.type_label == "Projet"
    assert project.status == "Actif" and project.title == "Budget participatif 2026"
    assert project.url == "https://participation.esch.lu/projet/650/budget-participatif-2026"
    survey = by_id["5nz2vmj7zj"]
    assert survey.kind == "survey" and survey.type_label == "Enquête"
    assert survey.status == "Passé" and survey.when == "Terminé le 16 juillet 2026"


def test_participation_pages():
    survey = esch.parse_participation_page(read("esch-participation-enquete-1z8l57r68j.html"))
    assert (survey.start, survey.end) == ("2026-02-24", "2026-03-02")
    assert survey.phases == []
    assert survey.attachments[0].label == "Data Protection Information Notice (GDPR).pdf"
    project = esch.parse_participation_page(read("esch-participation-projet-650.html"))
    assert [p.start for p in project.phases][:2] == ["2026-09-19", "2026-11-01"]
    assert project.phases[2].title.startswith("Vote des citoyen.nes")
    assert (project.start, project.end) == ("2026-09-19", "2027-12-31")
    assert project.attachments[0].url == (
        "https://participation.esch.lu/proje/650/attachment/152/budget_participatif_vde.pdf"
    )


class FakeFetcher:
    """Serves recorded fixtures by URL; anything not recorded fails like a network error.

    A value is a fixture name, raw bytes served as they are, or an exception to raise."""

    def __init__(self, pages: dict[str, str | bytes | Exception]):
        self.pages, self.asked = pages, []

    def get(self, url: str) -> Fetched:
        self.asked.append(url)
        if url not in self.pages:
            raise RuntimeError(f"not recorded: {url}")
        page = self.pages[url]
        if isinstance(page, Exception):
            raise page
        body = page if isinstance(page, bytes) else read(page).encode("utf-8")
        return Fetched(url, "2026-10-05T00:00:00Z", hashlib.sha256(body).hexdigest(), "", body)


RECORDED = {
    esch.sessions_url(2026): "esch-seances-2026.html",
    esch.sessions_api_url(2026): "esch-api-sessions-2026.json",
    "https://administration.esch.lu/sessions_conseil/conseil-communal-du-02-octobre-2026/": (
        "esch-session-2026-10-02.html"
    ),
    "https://administration.esch.lu/sessions_conseil/conseil-communal-du-23-octobre-2026/": (
        "esch-session-2026-10-23.html"
    ),
    esch.points_api_url(1522): "esch-api-agendaitems-1522.json",
    esch.votes_api_url(42063): "esch-api-votes-42063.json",
    "https://participation.esch.lu/": "esch-participation-home.html",
    "https://participation.esch.lu/enquete/1z8l57r68j": (
        "esch-participation-enquete-1z8l57r68j.html"
    ),
    "https://participation.esch.lu/projet/650/budget-participatif-2026": (
        "esch-participation-projet-650.html"
    ),
}


def test_build_esch_from_recorded_pages():
    fetcher = FakeFetcher(RECORDED)
    snap = snapshot.build(fetcher, sources=("esch",), today=date(2026, 10, 5))
    assert snap["schema"] == "d2.docket.snapshot/2"
    assert [s["id"] for s in snap["sources"]] == ["esch"]
    assert [m["id"] for m in snap["meetings"]] == ["esch-1522", "esch-1547"]
    oct2, oct23 = snap["meetings"]
    assert oct2["url"].endswith("conseil-communal-du-02-octobre-2026/")
    assert oct2["time"] == "08:30" and oct2["video_url"] is None and oct2["live_url"] is None
    assert oct23["live_url"].startswith("https://esch.tv/stream/")
    # the 23 October agenda (AgendaItems/1547) is not recorded: its fetch fails, the session is
    # still listed without points, and the failure is recorded rather than hidden
    assert oct23["points"] == []
    assert esch.points_api_url(1547) in fetcher.asked
    assert any(e.get("session") == 1547 and "not recorded" in e["error"] for e in snap["errors"])

    items = {i["id"]: i for i in snap["items"]}
    pap = items["lu.esch.42063"]
    assert pap["jurisdiction_id"] == "lu-esch" and pap["source"] == "esch.lu"
    assert pap["number"] == "6.1" and pap["type"] == "agenda"
    assert pap["urls"] == {"fr": oct2["url"]}
    assert pap["agenda"][0]["meeting_id"] == "esch-1522"
    assert items["lu.esch.42146"]["votes"] is None  # no vote chart, so no vote was asked for
    # same item shape as the Chamber's: every key a Chamber item has, an Esch item has too
    dossier = chd.parse_dossier(read("dossier-8752-fr.html"), "8752")
    chamber_keys = set(snapshot.build_item(dossier, [], documents=[]))
    assert chamber_keys <= set(pap)
    assert chamber_keys <= set(items["lu.esch.participation.project.650"])

    budget = items["lu.esch.participation.project.650"]
    assert budget["status"] == "Actif" and budget["opens"] == "2026-09-19"
    survey = items["lu.esch.participation.survey.1z8l57r68j"]
    assert (survey["opens"], survey["closes"]) == ("2026-02-24", "2026-03-02")
    unrecorded = items["lu.esch.participation.survey.5nz2vmj7zj"]
    assert unrecorded["opens"] is None  # page not fetched: left empty, not guessed

    # votes are only requested for points whose page shows a vote chart
    asked_votes = [u for u in fetcher.asked if "/Votes/" in u]
    assert esch.votes_api_url(42146) not in asked_votes
    assert all(e["source"] in ("esch.lu", "participation.esch.lu") for e in snap["errors"])
    # after the first failed votes request (42065 is not recorded), no more are made
    assert asked_votes == [esch.votes_api_url(42065)]
    skipped = next(e for e in snap["errors"] if "points" in e)
    assert 42063 in skipped["points"] and pap["votes"] is None


def test_votes_are_read_when_the_api_answers():
    pages = {**RECORDED, esch.votes_api_url(42065): "esch-api-votes-42063.json"}
    snap = snapshot.build(FakeFetcher(pages), sources=("esch",), today=date(2026, 10, 5))
    items = {i["id"]: i for i in snap["items"]}
    assert items["lu.esch.42065"]["votes"]["counts"] == {"Oui": 11, "Non": 8}


def test_unknown_source_is_rejected():
    assert sources_arg("chd, esch") == ("chd", "esch")
    with pytest.raises(Exception, match="unknown source"):
        sources_arg("chd,paris")
    with pytest.raises(ValueError):
        snapshot.build(FakeFetcher({}), sources=("paris",))


def test_one_unreachable_source_does_not_sink_the_other():
    snap = snapshot.build(FakeFetcher(RECORDED), sources=("chd", "esch"), today=date(2026, 10, 5))
    assert [s["id"] for s in snap["sources"]] == ["chd", "esch"]
    assert any(e["source"] == "chd" for e in snap["errors"])
    assert any(i["id"].startswith("lu.esch.") for i in snap["items"])


def test_esch_is_fetched_at_most_one_request_per_three_seconds():
    class Timed(FakeFetcher):
        delay = 1.0

        def get(self, url):
            self.delays = [*getattr(self, "delays", []), self.delay]
            return super().get(url)

    fetcher = Timed(RECORDED)
    snapshot.build(fetcher, sources=("esch",), today=date(2026, 10, 5))
    assert set(fetcher.delays) == {snapshot.ESCH_DELAY}
    assert fetcher.delay == 1.0  # restored for the other sources


CHAMBER = {
    "https://www.chd.lu/fr/agenda": "agenda-fr.html",
    chd.dossier_url("8752", "fr"): "dossier-8752-fr.html",
}
HTML_ERROR = b"<html><body>Service Unavailable</body></html>"


def test_an_html_error_page_from_the_workflow_api_keeps_the_chamber_and_participation():
    pages = {**CHAMBER, **RECORDED, esch.sessions_api_url(2026): HTML_ERROR}
    snap = snapshot.build(FakeFetcher(pages), sources=("chd", "esch"), today=date(2026, 10, 5))
    ids = [i["id"] for i in snap["items"]]
    assert "lu.chd.8752" in ids
    assert "lu.esch.participation.project.650" in ids
    assert not any(i.startswith("lu.esch.4") for i in ids)  # no council points without the API
    assert any(e["source"] == "esch.lu" and "Expecting value" in e["error"] for e in snap["errors"])


def test_an_impossible_date_does_not_crash_the_snapshot():
    sessions = (FIX / "esch-api-sessions-2026.json").read_text(encoding="utf-8")
    broken = sessions.replace('"02/10/2026"', '"31/02/2026"', 1).encode("utf-8")
    assert broken != sessions.encode("utf-8")
    pages = {**CHAMBER, **RECORDED, esch.sessions_api_url(2026): broken}
    snap = snapshot.build(FakeFetcher(pages), sources=("chd", "esch"), today=date(2026, 10, 5))
    ids = [i["id"] for i in snap["items"]]
    assert "lu.chd.8752" in ids and "lu.esch.participation.project.650" in ids
    # the session with no real date is left out; the others are still read
    assert "esch-1547" in [m["id"] for m in snap["meetings"]]


def test_council_down_keeps_participation():
    pages = {k: v for k, v in RECORDED.items() if "administration.esch.lu" not in k}
    pages = {k: v for k, v in pages.items() if "workflow.esch.lu" not in k}
    snap = snapshot.build(FakeFetcher(pages), sources=("esch",), today=date(2026, 10, 5))
    ids = [i["id"] for i in snap["items"]]
    assert "lu.esch.participation.project.650" in ids
    assert snap["meetings"] == [] and snap["sources"][0]["sha256"] is None
    assert any(e["source"] == "esch.lu" for e in snap["errors"])


def test_sessions_list_page_down_keeps_the_council_points():
    pages = {k: v for k, v in RECORDED.items() if k != esch.sessions_url(2026)}
    snap = snapshot.build(FakeFetcher(pages), sources=("esch",), today=date(2026, 10, 5))
    ids = [i["id"] for i in snap["items"]]
    assert "lu.esch.42063" in ids and "lu.esch.participation.project.650" in ids
    assert all(m["url"] is None for m in snap["meetings"])  # no session page links
    assert snap["sources"][0]["sha256"] is None


def test_previous_year_unavailable_keeps_this_year_and_participation():
    # early January: no session before today in 2026, and the 2025 pages are not recorded
    snap = snapshot.build(FakeFetcher(RECORDED), sources=("esch",), today=date(2026, 1, 5))
    ids = [i["id"] for i in snap["items"]]
    assert "lu.esch.participation.project.650" in ids
    assert "esch-1522" in [m["id"] for m in snap["meetings"]]
    assert any(esch.sessions_api_url(2025) in e.get("url", "") for e in snap["errors"])


def test_participation_down_keeps_the_council():
    pages = {k: v for k, v in RECORDED.items() if "participation.esch.lu" not in k}
    snap = snapshot.build(FakeFetcher(pages), sources=("esch",), today=date(2026, 10, 5))
    ids = [i["id"] for i in snap["items"]]
    assert "lu.esch.42063" in ids
    assert not any("participation" in i for i in ids)
    assert any(e["source"] == "participation.esch.lu" for e in snap["errors"])


def test_a_404_for_one_vote_does_not_stop_the_others():
    page = esch.parse_session_page(read("esch-session-2026-10-02.html"))
    answered = {esch.votes_api_url(i): "esch-api-votes-42063.json" for i in page.voted_item_ids}
    missing = FetchError("could not fetch: HTTP Error 404: Not Found", status=404)
    fetcher = FakeFetcher({**RECORDED, **answered, esch.votes_api_url(42065): missing})
    snap = snapshot.build(fetcher, sources=("esch",), today=date(2026, 10, 5))
    items = {i["id"]: i for i in snap["items"]}
    asked = [u for u in fetcher.asked if "/Votes/" in u]
    assert asked[0] == esch.votes_api_url(42065)  # the first one asked is the missing one
    assert items["lu.esch.42065"]["votes"] is None
    assert items["lu.esch.42063"]["votes"]["counts"] == {"Oui": 11, "Non": 8}
    assert len(asked) == len(page.voted_item_ids)
    assert any(e.get("point") == 42065 for e in snap["errors"])
    assert not any("points" in e for e in snap["errors"])  # nothing skipped


def test_votes_stop_after_repeated_failures():
    page = esch.parse_session_page(read("esch-session-2026-10-02.html"))
    missing = {
        esch.votes_api_url(i): FetchError("HTTP Error 404", status=404) for i in page.voted_item_ids
    }
    fetcher = FakeFetcher({**RECORDED, **missing})
    snap = snapshot.build(fetcher, sources=("esch",), today=date(2026, 10, 5))
    asked = [u for u in fetcher.asked if "/Votes/" in u]
    assert len(asked) == snapshot.VOTES_GIVE_UP_AFTER < len(page.voted_item_ids)
    assert any("points" in e for e in snap["errors"])


def test_negative_past_sessions_is_rejected(capsys):
    with pytest.raises(SystemExit):
        main(["snapshot", "--out", "x.json", "--esch-past-sessions", "-1"])
    assert "0 or more" in capsys.readouterr().err
