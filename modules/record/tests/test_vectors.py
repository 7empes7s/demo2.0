"""The shared vectors are current, and this implementation agrees with them."""

import json
from pathlib import Path

import pytest
from d2_record import vectors
from d2_record.entry import Entry
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
    with pytest.raises((VerifyError, ValueError)):
        if case["kind"] == "inclusion":
            check_inclusion(case["checkpoint"], VKEY, case["entry"], case["proof"])
        else:
            check_consistency(case["old"], case["new"], VKEY, case["proof"])


def test_key_encodings_round_trip():
    signer = Signer.generate("example.org/x")
    assert Signer.parse(signer.encode()) == signer
    assert Verifier.parse(signer.verifier.encode()) == signer.verifier
    assert signer.encode().startswith("PRIVATE+KEY+example.org/x+")
    with pytest.raises(ValueError):
        Verifier.parse(V["vkey"].replace("+4f", "+00", 1))


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
    cp = Checkpoint.verify(V["checkpoints"]["13"], VKEY)
    assert cp.size == 13 and cp.timestamp == vectors.T0 + 13
