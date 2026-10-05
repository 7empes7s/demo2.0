"""The shared vectors are current, and this implementation agrees with them."""

import json
from pathlib import Path

import pytest
from d2_record import vectors
from d2_record.entry import Entry, EntryError
from d2_record.note import Checkpoint, Signer, Verifier, open_note, sign_note
from d2_record.verify import VerifyError, check_consistency, check_inclusion

PATH = Path(__file__).resolve().parents[3] / "spec" / "record" / "vectors" / "d2-log.json"
V = json.loads(PATH.read_text(encoding="utf-8"))
VKEY = Verifier.parse(V["vkey"])


def test_vectors_file_is_up_to_date():
    assert PATH.read_text(encoding="utf-8") == vectors.render(), (
        "run: uv run python -m d2_record.vectors --out spec/record/vectors/d2-log.json"
    )


def test_leaf_encoding():
    e = Entry.from_dict(V["entries"][0])
    assert e.leaf_data().decode() == V["leaf_data_0"]
    assert V["leaf_data_0"].startswith("d2.record.entry/1\nmatter.created\nsha256:")
    assert V["inclusion"][0]["leaf_hash"]


def test_every_inclusion_proof_verifies():
    for proof in V["inclusion"]:
        entry = V["entries"][proof["seq"]]
        check_inclusion(V["checkpoints"][str(proof["size"])], VKEY, entry, proof)


def test_every_consistency_proof_verifies():
    for proof in V["consistency"]:
        old, new = (V["checkpoints"][str(proof[k])] for k in ("from", "to"))
        check_consistency(old, new, VKEY, proof)


@pytest.mark.parametrize("case", V["invalid"], ids=lambda c: c["reason"])
def test_invalid_cases_fail(case):
    with pytest.raises(VerifyError):
        if case["kind"] == "inclusion":
            check_inclusion(case["checkpoint"], VKEY, case["entry"], case["proof"])
        else:
            check_consistency(case["old"], case["new"], VKEY, case["proof"])


def test_invalid_cases_cover_notes_checkpoints_and_entry_encodings():
    assert len(V["invalid"]) == 29


def _inclusion_case():
    proof = next(p for p in V["inclusion"] if p["seq"] == 4 and p["size"] == 11)
    return V["checkpoints"]["11"], V["entries"][4], json.loads(json.dumps(proof))


@pytest.mark.parametrize(
    "change",
    [
        {"seq": True},
        {"size": True},
        {"seq": -1},
        {"seq": "4"},
        {"proof": "not a list"},
        {"proof": [1, 2]},
        {"proof": ["not base64!"]},
        {"leaf_hash": 7},
        {"leaf_hash": "not base64!"},
    ],
)
def test_malformed_inclusion_proofs_raise_verify_error(change):
    note, entry, proof = _inclusion_case()
    check_inclusion(note, VKEY, entry, proof)
    with pytest.raises(VerifyError):
        check_inclusion(note, VKEY, entry, {**proof, **change})
    with pytest.raises(VerifyError):
        check_inclusion(note, VKEY, entry, [proof])
    with pytest.raises(VerifyError):
        check_inclusion(note, VKEY, "entry", proof)


def test_malformed_consistency_proofs_raise_verify_error():
    proof = next(p for p in V["consistency"] if p["from"] == 1 and p["to"] == 2)
    old, new = V["checkpoints"]["1"], V["checkpoints"]["2"]
    check_consistency(old, new, VKEY, proof)
    for bad in (
        {**proof, "from": True},
        {**proof, "proof": None},
        [proof],
        {**proof, "proof": [0]},
    ):
        with pytest.raises(VerifyError):
            check_consistency(old, new, VKEY, bad)


def test_entries_must_be_valid_utf8_text():
    e = V["entries"][0]
    for field in ("type", "payload_uri"):
        with pytest.raises(EntryError, match="UTF-8"):
            Entry.from_dict({**e, field: e[field] + "\ud800"})


def test_key_encodings_round_trip():
    signer = Signer.generate("example.org/x")
    assert Signer.parse(signer.encode()) == signer
    assert Verifier.parse(signer.verifier.encode()) == signer.verifier
    assert signer.encode().startswith("PRIVATE+KEY+example.org/x+")
    with pytest.raises(ValueError):
        Verifier.parse(V["vkey"].replace("+4f", "+00", 1))
    for padded in (" " + V["vkey"], V["vkey"] + "\n"):  # parsed exactly as given
        with pytest.raises(ValueError):
            Verifier.parse(padded)


def test_note_signatures():
    signer = vectors.LOG_KEY
    note = sign_note("hello\n", signer)
    assert note.startswith("hello\n\n— example.org/d2-record-test ")
    assert open_note(note, signer.verifier) == "hello\n"
    with pytest.raises(ValueError):
        open_note(note.replace("hello", "jello"), signer.verifier)
    with pytest.raises(ValueError):
        open_note(note, vectors.OTHER_KEY.verifier)
    with pytest.raises(ValueError):
        sign_note("a\n\nb\n", signer)
    with pytest.raises(ValueError, match="malformed signature line"):
        open_note("hello\n\n— nospace\n", signer.verifier)
    cp = Checkpoint.verify(V["checkpoints"]["13"], VKEY)
    assert cp.size == 13 and cp.timestamp == vectors.T0 + 13
