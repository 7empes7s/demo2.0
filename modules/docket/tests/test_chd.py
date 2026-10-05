from pathlib import Path

from d2_docket import chd, snapshot

FIX = Path(__file__).parent / "fixtures"


def read(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


def test_bill_dossier_fields():
    d = chd.parse_dossier(read("dossier-8752-fr.html"), "8752")
    assert d.title.startswith("Projet de loi portant")
    assert d.type == "Projet de loi"
    assert d.status == "En commission"
    assert d.author == "Gilles Roth"
    assert d.deposited == "2026-05-15"
    assert d.updated == "2026-09-30"
    assert d.deposit_document.url == (
        "https://wdocs-pub.chd.lu/docs/Dossiers_parlementaires/8752/20260721_Depot.pdf"
    )
    assert d.deposit_document.kind == "depot"


def test_bill_activities_and_documents():
    d = chd.parse_dossier(read("dossier-8752-fr.html"), "8752")
    kinds = [a.kind for a in d.activities]
    assert kinds[:4] == ["Creation", "Commission-pressentie", "Commission", "Avis"]
    avis = [doc for doc in d.documents if doc.kind == "avis"]
    assert avis and avis[0].date == "2026-09-30"
    assert "Chambre de Commerce" in avis[0].label
    # every document URL is absolute and unique
    urls = [doc.url for doc in d.documents]
    assert all(u.startswith("https://") for u in urls) and len(urls) == len(set(urls))


def test_german_page_labels_are_read():
    d = chd.parse_dossier(read("dossier-8752-de.html"), "8752")
    assert d.author == "Gilles Roth"
    assert d.deposited == "2026-05-15"


def test_orientation_debate_has_no_deposit_document():
    d = chd.parse_dossier(read("dossier-8821-fr.html"), "8821")
    assert d.type == "Débat d'orientation"
    assert d.deposit_document is None
    assert snapshot.item_type(d.type) == "other"


def test_agenda_meetings_are_deduplicated_and_linked():
    meetings = chd.parse_agenda(read("agenda-fr.html"))
    ids = [m.id for m in meetings]
    assert len(ids) == len(set(ids)) and len(ids) > 5
    finance = next(m for m in meetings if m.id == "1016250")
    assert finance.body == "Commission des Finances"
    assert finance.date == "2026-10-09" and finance.time == "14:00"
    linked = {p.dossier for p in finance.points if p.dossier}
    assert {"8773", "8782", "8752"} <= linked
    step = next(p for p in finance.points if p.dossier == "8782").steps
    assert step == ["Nomination d’un rapporteur", "Présentation du projet de loi"]


def test_build_item_links_agenda_and_languages():
    d = chd.parse_dossier(read("dossier-8752-fr.html"), "8752")
    item = snapshot.build_item(d, chd.parse_agenda(read("agenda-fr.html")), documents=[])
    assert item["type"] == "bill"
    assert item["urls"]["lb"] == "https://www.chd.lu/lu/dossier/8752"
    assert any(a["meeting_id"] == "1016250" for a in item["agenda"])
