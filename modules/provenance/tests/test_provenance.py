import json
import socket
import threading
import urllib.error
import urllib.request
from pathlib import Path

import jsonschema
import pytest
from d2_provenance.__main__ import main
from d2_provenance.corpus import load
from d2_provenance.evaluate import RED_PRECISION_BAR, evaluate
from d2_provenance.grader import CHECKER_ID, Grader, NoRecord, UnknownContext, claim_id
from d2_provenance.server import make_server
from d2_provenance.text import (
    comparators,
    find_dates,
    fold,
    has_negation,
    mixed_scripts,
    numbers,
    sentences,
    words,
)

HERE = Path(__file__).parent
FIXTURES = HERE / "fixtures"
LABELS = HERE.parent / "labels"
RECORDED = FIXTURES / "docket-recorded.json"
SYNTHETIC = FIXTURES / "docket-synthetic.json"
SPEC = HERE.parents[2] / "spec" / "schemas"


def schema(name: str) -> dict:
    return json.loads((SPEC / f"{name}.schema.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def recorded() -> Grader:
    return Grader(load(RECORDED))


@pytest.fixture(scope="module")
def synthetic() -> Grader:
    return Grader(load(SYNTHETIC))


# --- text ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "le 15 mai 2026",
        "on 15 May 2026",
        "on May 15th, 2026",
        "am 15. Mai 2026",
        "em 15 de maio de 2026",
        "le 15/05/2026",
        "am 15.05.2026",
        "2026-05-15",
    ],
)
def test_dates_in_five_languages(text):
    assert [d for d, _, _ in find_dates(fold(text))] == ["2026-05-15"]


def test_impossible_dates_are_dropped():
    assert find_dates(fold("le 31/13/2026")) == []


@pytest.mark.parametrize(
    "text,values",
    [
        ("plus de 5.000 habitants", ["5000"]),
        ("plus de 5 000 habitants", ["5000"]),
        ("plus de 5,000 habitants", ["5000"]),
        ("un taux de 12,5 %", ["12.5"]),
        ("les années 2026 2027", ["2026", "2027"]),
        ("le règlement (UE) 2024/2809 du 23 octobre 2024", []),
        ("le document 8752/01", []),
    ],
)
def test_numbers(text, values):
    assert [n.value for n in numbers(fold(text))] == values


def test_numbers_carry_the_counted_word():
    (n,) = numbers(fold("40 % du coût"))
    assert (n.value, n.unit) == ("40", "%")
    (n,) = numbers(fold("12 millions d'euros"))
    assert n.unit == "millio"


def test_fold_joins_pdf_hyphenation_and_strips_accents():
    assert fold("les com-\nmunes rurales de l’État") == "les communes rurales de l'etat"
    assert words(fold("Les communes")) == ["commun"]


def test_fold_drops_invisible_characters_and_reads_any_digit():
    assert fold("1\u200b2 mi\u00adllions") == "12 millions"
    assert [n.value for n in numbers(fold("\u0661\u0662 millions"))] == ["12"]
    assert [n.value for n in numbers(fold("\uff11\uff12 millions"))] == ["12"]


@pytest.mark.parametrize(
    "text", ["Bill 8752 wasn't filed", "The council didn’t approve it", "It cannot be"]
)
def test_english_contractions_are_negations(text):
    assert has_negation(fold(text))


def test_comparators_and_mixed_alphabets():
    assert comparators(fold("plus de 5.000")) == {"gt"}
    assert comparators(fold("moins de 5.000")) == {"lt"}
    assert comparators(fold("at least 5")) == {"ge"}
    assert mixed_scripts("Le c\u043e\u00fbt total")  # Cyrillic о inside a French word
    assert not mixed_scripts("Le coût total, mise en œuvre")


def test_sentences_split_on_full_stops_and_blank_lines():
    got = sentences("Première phrase. Deuxième phrase avec 5.000 habitants.\n\nTroisième")
    assert got == ["Première phrase.", "Deuxième phrase avec 5.000 habitants.", "Troisième"]


# --- corpus ----------------------------------------------------------------------------------


def test_corpus_reads_a_recorded_snapshot():
    corpus = load(RECORDED)
    assert set(corpus.items) >= {"lu.chd.8752", "lu.chd.8821", "lu.esch.42063"}
    bill = corpus.items["lu.chd.8752"]
    assert bill.deposited == "2026-05-15"
    assert bill.url == "https://www.chd.lu/fr/dossier/8752"
    assert corpus.items["lu.esch.42063"].votes == {"Non": 8, "Oui": 11}
    assert len(corpus.sha256) == 64
    for item in corpus.items.values():
        assert all(s.url.startswith("https://") for s in item.sentences)


def test_corpus_rejects_other_json(tmp_path):
    path = tmp_path / "x.json"
    path.write_text('{"schema": "something/1", "items": []}')
    with pytest.raises(ValueError):
        load(path)


# --- grading: structured facts --------------------------------------------------------------


@pytest.mark.parametrize(
    "text,want",
    [
        ("Le projet de loi 8752 a été déposé le 15 mai 2026", "green"),
        ("Bill 8752 was filed on 21 July 2026", "red"),
        ("Das Gesetzesprojet 8752 wurde am 15. Mai 2026 eingereicht", "green"),
        ("Le projet de loi 8752 n'a pas été déposé le 15 mai 2026", "yellow"),
        ("Bill 8752 wasn't filed on 15 May 2026", "yellow"),
        # a matching date supports green only when the record states the rest of the claim too
        ("Le projet de loi 8752 a été déposé le 15 mai 2026 et adopté à l'unanimité", "yellow"),
        ("Le projet de loi 8752 a été déposé et voté le 15 mai 2026", "yellow"),
        ("Le projet de loi 8752 a été déposé par l'opposition le 15 mai 2026", "yellow"),
        ("Le projet de loi 8752 a été déposé le 15 mai 2026 à la Cour de justice", "yellow"),
        ("Le projet de loi 8752 sera déposé le 15 mai 2026", "yellow"),
        # another document deposited on another day is not the dossier's deposit
        (
            "L'avis de la Chambre de Commerce sur le projet de loi 8752 a été déposé le "
            "30 septembre 2026",
            "yellow",
        ),
        ("Le rapport sur le projet de loi 8752 sera déposé le 9 octobre 2026", "yellow"),
    ],
)
def test_deposit_dates(recorded, text, want):
    g = recorded.grade(text)
    assert g["grade"] == want
    assert g["evidence"][0]["url"] == "https://www.chd.lu/fr/dossier/8752"


@pytest.mark.parametrize(
    "text,want",
    [
        ("Le conseil a approuvé le PAP Quai Neiduerf par 11 voix contre 8", "green"),
        ("The council approved it by 12 votes to 7", "red"),
        # "rejected by 11 to 8" means 11 against: the record has 11 for
        ("Le point a été rejeté par 11 voix contre 8", "red"),
        ("Le PAP Quai Neiduerf a été voté à l'unanimité", "red"),
        ("Le vote de 11 voix contre 8 est un scandale", "yellow"),
        # the outcome is checked, not only the numbers
        ("Le PAP Quai Neiduerf a été rejeté par 8 voix contre 11", "red"),
        ("The plan failed, 11 votes to 8", "red"),
        ("The plan lost by 11 votes to 8", "red"),
        ("Le PAP a été approuvé par 11 voix pour, 8 contre et 3 abstentions", "red"),
        ("Le PAP Quai Neiduerf a été adopté par 8 voix contre 11", "yellow"),
        # matching figures support green only when the record states the rest of the claim
        ("Le PAP a été approuvé par 11 voix contre 8 le 3 octobre 2026", "yellow"),
        ("Le PAP a été approuvé par 11 voix contre 8 par le conseil de Differdange", "yellow"),
    ],
)
def test_council_votes(recorded, text, want):
    g = recorded.grade(text, "lu.esch.42063")
    assert g["grade"] == want
    assert "Oui : 11" in g["evidence"][0]["excerpt"]


def test_a_negated_vote_claim_is_never_green(recorded):
    text = "The council didn't approve the Quai Neiduerf plan by 11 votes to 8"
    assert recorded.grade(text, "lu.esch.42063")["grade"] == "yellow"


@pytest.mark.parametrize(
    "text",
    [
        "The Quai Neiduerf plan, debated from 2024 to 2026, was approved by the council",
        "Le PAP Quai Neiduerf, discuté de 2024 à 2026, a été approuvé",
        "Le PAP prévoit 120 logements contre 80 auparavant",
    ],
)
def test_a_range_of_years_is_not_a_vote_tally(recorded, text):
    assert recorded.grade(text, "lu.esch.42063")["grade"] == "yellow"


def test_a_dossier_named_in_the_claim_wins_over_context(recorded):
    text = "Le projet de loi 8752 a été déposé le 15 mai 2026"
    for ctx in ("lu.chd.8821", "lu.esch.42063", "lu.chd.8752", None):
        g = recorded.grade(text, ctx)
        assert g["grade"] == "green"
        assert g["evidence"][0]["url"] == "https://www.chd.lu/fr/dossier/8752"


def test_an_unknown_context_is_reported(recorded):
    with pytest.raises(UnknownContext):
        recorded.grade("Le projet de loi 8752 a été déposé le 15 mai 2026", "nonexistent")


# --- grading: record text --------------------------------------------------------------------


OBJECT = "Le présent projet de loi a pour objet d'"
NET = "un réseau cyclable continu d'ici 2030"
ROAD = "un réseau routier continu d'ici 2030"
BROKEN = "un réseau cyclable discontinu d'ici 2030"


@pytest.mark.parametrize(
    "text,want",
    [
        ("L'État prend en charge 40 % du coût des travaux", "green"),
        ("L'État prend en charge 50 % du coût des travaux", "red"),
        ("Le coût total est estimé à 12 millions d'euros", "green"),
        ("Le coût total est estimé à 20 millions d'euros", "red"),
        # negation differs from the record: never green or red
        ("Les communes de moins de 5.000 habitants sont concernées par l'obligation", "yellow"),
        ("Les communes de moins de 5.000 habitants ne sont pas concernées", "green"),
        # an opinion is never green or red, even next to a matching record
        ("Le coût de 12 millions d'euros est trop élevé pour les communes rurales", "yellow"),
        # one claim word the record lacks ("fonds" vs "Il") keeps it yellow
        ("Le fonds finance la construction de 1.200 logements abordables par an", "yellow"),
        # "plus de" is not "moins de"
        ("Les communes de plus de 5.000 habitants ne sont pas concernées", "yellow"),
        # one swapped word in a long copied sentence is not green
        (
            OBJECT + "interdire à chaque commune de plus de 5.000 habitants de créer " + NET,
            "yellow",
        ),
        (OBJECT + "obliger chaque commune de moins de 5.000 habitants à créer " + NET, "yellow"),
        (OBJECT + "obliger chaque région de plus de 5.000 habitants à créer " + NET, "yellow"),
        (OBJECT + "obliger chaque commune de plus de 5.000 habitants à créer " + ROAD, "yellow"),
        (OBJECT + "obliger chaque commune de plus de 5.000 habitants à créer " + BROKEN, "yellow"),
        # red needs every figure for the counted thing to differ; one matching figure: yellow
        (
            "Le coût total est estimé à 12 millions d'euros sur cinq ans, et 2 millions d'euros",
            "yellow",
        ),
        ("Le coût total est estimé à 12 millions d'euros, dont 3 millions d'euros", "yellow"),
        ("L'État prend en charge 40 % du coût des travaux et 60 % du coût des travaux", "yellow"),
        # other digits and invisible characters read as the number they show
        ("Le coût total est estimé à \u0661\u0662 millions d'euros", "green"),
        ("Le coût total est estimé à 1\u200b2 millions d'euros", "green"),
        ("Les communes de moins de 5.000 habitants n\u200be sont pa\u200bs concernées", "green"),
        # a word mixing alphabets is never compared
        ("Le c\u043e\u00fbt total est estimé à 20 millions d'euros", "yellow"),
    ],
)
def test_record_text(synthetic, text, want):
    assert synthetic.grade(text)["grade"] == want


def test_the_dossier_number_is_not_a_figure(synthetic):
    g = synthetic.grade(
        "Le projet de loi 0002 dote le fonds de 250 millions d'euros", "lu.chd.0002"
    )
    assert g["grade"] == "yellow"  # "dote" is not in the record: yellow, but not red over 0002
    g = synthetic.grade(
        "Le projet de loi 0001 a pour objet d'obliger chaque commune de plus de 5.000 habitants"
        " à créer un réseau cyclable continu d'ici 2030"
    )
    assert g["grade"] == "green"


def test_red_quotes_the_contradicting_sentence(synthetic):
    g = synthetic.grade("Le fonds dispose d'une dotation initiale de 300 millions d'euros")
    assert g["grade"] == "red"
    ev = g["evidence"][0]
    assert "250 millions" in ev["excerpt"]
    assert ev["url"] == "https://example.org/depot-0002.pdf"


def test_source_document_id_is_the_fetched_hash(synthetic):
    g = synthetic.grade("L'État prend en charge 40 % du coût des travaux")
    assert g["evidence"][0]["source_document_id"] == "sha256:" + "1" * 64


def test_no_record_means_no_grade(recorded):
    with pytest.raises(NoRecord):
        recorded.grade("Le Luxembourg a gagné la Coupe du monde de football")


def test_bad_claims(recorded):
    with pytest.raises(ValueError):
        recorded.grade("   ")
    with pytest.raises(ValueError):
        recorded.grade("x" * 2001)


def test_grades_match_the_spec_schema(recorded, synthetic):
    grade_schema, claim_schema = schema("grade"), schema("claim")
    for grader, path in ((recorded, "recorded-v0.json"), (synthetic, "synthetic-v0.json")):
        for case in json.loads((LABELS / path).read_text(encoding="utf-8"))["claims"]:
            try:
                g = grader.grade(case["text"], case.get("context"))
            except NoRecord:
                continue
            jsonschema.validate(g, grade_schema)
            claim = {"id": g["claim_id"], "text": case["text"], "context_ref": case.get("context")}
            jsonschema.validate(claim, claim_schema)
            assert g["checker_id"] == CHECKER_ID


def test_evidence_links_come_from_the_records(recorded):
    links = set(json.dumps(json.loads(RECORDED.read_text(encoding="utf-8"))).split('"'))
    for text, ctx in (
        ("Bill 8752 was filed on 21 July 2026", None),
        ("Le PAP Quai Neiduerf a été voté à l'unanimité", "lu.esch.42063"),
    ):
        for ev in recorded.grade(text, ctx)["evidence"]:
            assert ev["url"] in links


def test_claim_id_is_stable():
    assert claim_id("a", None) == claim_id("a", None) != claim_id("a", "lu.chd.1")


def test_model_version_names_the_corpus(recorded):
    assert recorded.model_version == f"match/2+docket:{recorded.corpus.sha256[:12]}"


# --- labelled sets ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["recorded-v0.json", "synthetic-v0.json"])
def test_labelled_sets_meet_the_red_precision_bar(name):
    labels = json.loads((LABELS / name).read_text(encoding="utf-8"))
    report = evaluate(Grader(load(LABELS / labels["docket"])), labels)
    assert report["passed"]
    assert report["red_precision"] is not None and report["red_precision"] >= RED_PRECISION_BAR
    assert report["red_called"] >= 5
    assert report["graded_without_source"] == 0
    # a false green is the next most costly error: none on these sets
    assert sum(report["confusion"][w]["green"] for w in ("yellow", "red", "none")) == 0


class _Unsourced:
    model_version = "test"

    def __init__(self, url):
        self.url = url

    def grade(self, text, context=None):
        return {"grade": "yellow", "evidence": [{"url": self.url}] if self.url else []}


@pytest.mark.parametrize("url", [None, "https://", "javascript:alert(1)", "ftp://example.org/x"])
def test_the_source_check_fails_on_a_grade_no_reader_can_open(url):
    report = evaluate(_Unsourced(url), {"claims": [{"text": "x", "label": "yellow"}]})
    assert report["graded_without_source"] == 1
    assert report["passed"] is False


def test_corpus_drops_links_without_a_host(tmp_path):
    path = tmp_path / "s.json"
    item = {"id": "lu.chd.0009", "number": "0009", "title": {"fr": "Projet de loi"}}
    item["urls"] = {"fr": "https://"}
    path.write_text(json.dumps({"schema": "d2.docket.snapshot/2", "items": [item]}))
    assert load(path).items["lu.chd.0009"].url is None


# --- HTTP API and CLI ------------------------------------------------------------------------


@pytest.fixture
def api(synthetic):
    server = make_server(synthetic, port=0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    def call(path, body=None, raw=None):
        data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
        req = urllib.request.Request(base + path, data=data)
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    yield call
    server.shutdown()
    server.server_close()


def test_http_api(api):
    status, g = api("/claims/grade", {"text": "L'État prend en charge 50 % du coût des travaux"})
    assert status == 200 and g["grade"] == "red"
    jsonschema.validate(g, schema("grade"))
    status, g = api("/claims/grade", {"text": "Le projet de loi 0001 a été déposé le 15/01/2026"})
    assert status == 200 and g["grade"] == "green"
    assert api("/claims/grade", {"text": "La Lune est faite de fromage"}) == (
        404,
        {"error": "no record mentions this claim", "code": "no_record"},
    )
    # a wrong path is a plain 404, never mistaken for "no record"
    assert api("/claims/nope", {"text": "x"}) == (404, {"error": "not found"})
    assert api("/claims/grade", {"text": 3})[0] == 400
    assert api("/claims/grade", {"text": "x", "context": 3})[0] == 400
    assert api("/claims/grade", raw=b"not json")[0] == 400
    assert api("/claims/grade", raw=b"x" * (17 * 1024))[0] == 413
    status, body = api("/checkers")
    assert status == 200 and body["checkers"][0]["checker_id"] == CHECKER_ID
    status, body = api("/healthz")
    assert status == 200 and body["ok"] and body["items"] == 2
    status, body = api("/claims/grade", {"text": "x", "context": "lu.chd.9999"})
    assert status == 400 and "unknown context" in body["error"]
    assert body["code"] == "unknown_context"
    assert "code" not in api("/claims/grade", {"text": 3})[1]
    # deep nesting under the size limit is bad input, not a crash
    assert api("/claims/grade", raw=b"[" * 8000 + b"]" * 8000)[0] == 400


def test_http_api_times_out_a_body_that_never_arrives(synthetic):
    server = make_server(synthetic, port=0, timeout=0.5)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with socket.create_connection(server.server_address, timeout=5) as conn:
            conn.sendall(b"POST /claims/grade HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\n{")
            assert conn.recv(4096).startswith(b"HTTP/1.0 408")
    finally:
        server.shutdown()
        server.server_close()


def test_cli(capsys):
    assert main(["grade", "--docket", str(SYNTHETIC), "L'État prend en charge 40 % du coût"]) == 0
    assert json.loads(capsys.readouterr().out)["grade"] == "green"
    assert main(["grade", "--docket", str(SYNTHETIC), "--context", "nope", "x y z"]) == 2
    assert main(["grade", "--docket", str(SYNTHETIC), "La Lune est faite de fromage"]) == 3
    assert main(["grade", "--docket", str(FIXTURES / "missing.json"), "x"]) == 2
    capsys.readouterr()
    assert main(["eval", "--labels", str(LABELS / "synthetic-v0.json")]) == 0
    assert json.loads(capsys.readouterr().out)["passed"] is True
