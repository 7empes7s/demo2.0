"""Boards built by testgen (from the spec): tallies, parallel path, edge cases."""

import copy

import pytest
from d2_booth_verify import BoardError, verify
from d2_booth_verify.testgen import build
from d2_booth_verify.vectors import _rehash_from, mutate
from d2_booth_verify.verify import _ed25519_key_ok


@pytest.fixture(scope="module")
def generated():
    return build(voters=24, revotes=4, guardians=4, threshold=3, decrypting=[2, 3, 4])


def test_generated_board_tally(generated):
    board, tally = generated
    # voters vote v mod 3; voters 0..3 re-vote (v + 1) mod 3
    assert tally["counts"] == [7, 9, 8]
    assert verify(board).as_spec() == tally


def test_parallel_proof_checks_give_the_same_result(generated):
    board, tally = generated
    assert verify(board, jobs=2).as_spec() == tally


def test_tampered_ballot_fails_the_same_way_on_one_or_more_cores(generated):
    board, _ = generated
    # Swap two responses inside the first ballot's first bit proof; rehash the chain. The
    # signature covers it, so re-sign is impossible: expect bad_signature before any proof.
    first = next(e["seq"] for e in board["entries"] if e["kind"] == "ballot")
    p = board["entries"][first]["payload"]["bit_proofs"][0]
    bad = mutate(
        board,
        {
            "op": "set",
            "seq": first,
            "pointer": "/payload/bit_proofs/0/response_0",
            "value": p["response_1"],
            "rehash": True,
        },
    )
    for jobs in (1, 2):
        with pytest.raises(BoardError) as err:
            verify(bad, jobs=jobs)
        assert err.value.code == "bad_signature"


def test_a_round_with_no_ballots_has_no_tally():
    board, _ = build(voters=3)
    keep = ("round.params", "guardian.commitment", "round.key", "signup", "round.close")
    entries = [copy.deepcopy(e) for e in board["entries"] if e["kind"] in keep]
    _rehash_from(entries, 0)
    empty = {"schema": board["schema"], "entries": entries}
    with pytest.raises(BoardError) as err:
        verify(empty)
    assert err.value.code == "no_tally"
    # A partial decryption of the empty aggregates proves nothing: still no tally.
    entries.append(
        copy.deepcopy(next(e for e in board["entries"] if e["kind"] == "partial.decryption"))
    )
    _rehash_from(entries, 0)
    with pytest.raises(BoardError) as err:
        verify(empty)
    assert err.value.code == "no_tally"


def test_small_order_ed25519_keys_are_refused():
    identity = (1).to_bytes(32, "little")
    order_two = (2**255 - 20).to_bytes(32, "little")  # y = -1
    assert not _ed25519_key_ok(identity)
    assert not _ed25519_key_ok(order_two)
    assert not _ed25519_key_ok((2**255 - 19).to_bytes(32, "little"))  # y = p: non-canonical
    assert _ed25519_key_ok(bytes.fromhex("58" + "66" * 31))  # the basepoint


def test_signup_with_small_order_key_is_malformed(generated):
    board, _ = generated
    seq = next(e["seq"] for e in board["entries"] if e["kind"] == "signup")
    bad = mutate(
        board,
        {
            "op": "set",
            "seq": seq,
            "pointer": "/payload/voter_key",
            "value": "01" + "00" * 31,
            "rehash": True,
        },
    )
    with pytest.raises(BoardError) as err:
        verify(bad)
    assert err.value.code == "malformed"
