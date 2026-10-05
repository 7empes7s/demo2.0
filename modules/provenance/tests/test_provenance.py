import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import jsonschema
import pytest
from d2_provenance.__main__ import main
from d2_provenance.corpus import load
from d2_provenance.evaluate import RED_PRECISION_BAR, evaluate
from d2_provenance.grader import CHECKER_ID, Grader, NoRecord, claim_id
from d2_provenance.server import make_server
from d2_provenance.text import find_dates, fold, numbers, sentences, words

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
    ],
)
def test_council_votes(recorded, text, want):
    g = recorded.grade(text, "lu.esch.42063")
    assert g["grade"] == want
    assert "Oui : 11" in g["evidence"][0]["excerpt"]


# --- grading: record text --------------------------------------------------------------------


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
    assert recorded.model_version == f"match/1+docket:{recorded.corpus.sha256[:12]}"


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
    assert api("/claims/grade", {"text": "La Lune est faite de fromage"})[0] == 404
    assert api("/claims/grade", {"text": 3})[0] == 400
    assert api("/claims/grade", {"text": "x", "context": 3})[0] == 400
    assert api("/claims/grade", raw=b"not json")[0] == 400
    assert api("/claims/grade", raw=b"x" * (17 * 1024))[0] == 413
    status, body = api("/checkers")
    assert status == 200 and body["checkers"][0]["checker_id"] == CHECKER_ID
    status, body = api("/healthz")
    assert status == 200 and body["ok"] and body["items"] == 2


def test_cli(capsys):
    assert main(["grade", "--docket", str(SYNTHETIC), "L'État prend en charge 40 % du coût"]) == 0
    assert json.loads(capsys.readouterr().out)["grade"] in {"green", "yellow"}
    assert main(["grade", "--docket", str(SYNTHETIC), "La Lune est faite de fromage"]) == 3
    assert main(["grade", "--docket", str(FIXTURES / "missing.json"), "x"]) == 2
    capsys.readouterr()
    assert main(["eval", "--labels", str(LABELS / "synthetic-v0.json")]) == 0
    assert json.loads(capsys.readouterr().out)["passed"] is True
