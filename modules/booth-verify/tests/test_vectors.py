"""spec/booth/vectors.json: the board's tally, and every must-fail case's exact error code."""

import json
from pathlib import Path

import pytest
from d2_booth_verify import BoardError, verify
from d2_booth_verify.canonical import load
from d2_booth_verify.vectors import mutate

VECTORS = Path(__file__).resolve().parents[3] / "spec" / "booth" / "vectors.json"
MUST_FAIL = json.loads(VECTORS.read_text("utf-8"))["must_fail"]


def test_vectors_file_shape(vectors):
    assert vectors["schema"] == "d2.booth.vectors/1"
    assert len(vectors["board"]["entries"]) == 24
    assert len(MUST_FAIL) == 29


def test_good_board_gives_the_recorded_tally(vectors):
    tally = verify(vectors["board"])
    assert tally.as_spec() == vectors["tally"]
    assert tally.as_spec() == {
        "signups": 6,
        "counted": 6,
        "counts": [3, 1, 2],
        "guardians_used": [1, 3],
    }
    assert tally.options == ["yes", "no", "abstain"]


def test_good_board_from_file_bytes(vectors):
    raw = VECTORS.read_bytes()
    assert verify(load(raw)["board"]).as_spec() == vectors["tally"]


@pytest.mark.parametrize("case", MUST_FAIL, ids=[c["name"] for c in MUST_FAIL])
def test_must_fail_with_the_recorded_code(vectors, case):
    board = mutate(vectors["board"], case["mutation"])
    with pytest.raises(BoardError) as err:
        verify(board)
    assert err.value.code == case["error"], err.value.detail


def test_mutations_do_not_touch_the_original(vectors):
    before = json.dumps(vectors["board"], sort_keys=True)
    for case in MUST_FAIL:
        mutate(vectors["board"], case["mutation"])
    assert json.dumps(vectors["board"], sort_keys=True) == before
