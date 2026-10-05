import random

import pytest
from d2_lottery import Member, Pool, PoolError, check_inclusion


def test_leaf_encoding_and_root_match_vectors(vectors):
    pool = Pool(vectors["pool"]["members"])
    assert [m.leaf_data().decode() for m in pool.members] == vectors["pool"]["leaf_data"]
    assert vectors["pool"]["leaf_data"][0].startswith("d2.lottery.member/1\nnym-")
    assert pool.root_hex == vectors["pool"]["root"]


def test_root_ignores_input_order(vectors):
    members = list(vectors["pool"]["members"])
    random.Random(7).shuffle(members)
    assert Pool(members).root_hex == vectors["pool"]["root"]


def test_root_matches_rfc9162_by_hand():
    import hashlib

    pool = Pool([{"nym": "a"}, {"nym": "b"}, {"nym": "c"}])
    tag = b"\x00d2.lottery.member/1\n"
    leaf = [hashlib.sha256(tag + n + b"\n").digest() for n in (b"a", b"b", b"c")]
    node = hashlib.sha256(b"\x01" + leaf[0] + leaf[1]).digest()
    assert pool.root == hashlib.sha256(b"\x01" + node + leaf[2]).digest()


def test_every_inclusion_proof_verifies(vectors):
    for proof in vectors["pool"]["inclusion"]:
        check_inclusion(vectors["pool"]["root"], 5, proof)


def test_inclusion_proofs_for_every_size():
    for n in range(1, 18):
        pool = Pool([{"nym": f"n{i:02d}"} for i in range(n)])
        for m in pool.members:
            check_inclusion(pool.root_hex, n, pool.inclusion_proof(m.nym))


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p["member"].update(nym="nym-other"),
        lambda p: p["member"]["strata"].update(age="35-54"),
        lambda p: p.update(index=(p["index"] + 1) % p["size"]),
        lambda p: p["proof"].append(p["proof"][0]),
        lambda p: p["proof"].pop(),
        lambda p: p.update(size=p["size"] + 1),
    ],
)
def test_tampered_inclusion_proofs_fail(vectors, mutate):
    import copy

    proof = copy.deepcopy(vectors["pool"]["inclusion"][1])
    mutate(proof)
    with pytest.raises(PoolError):
        check_inclusion(vectors["pool"]["root"], 5, proof)


def test_pool_rules():
    with pytest.raises(PoolError):
        Pool([])
    with pytest.raises(PoolError):
        Pool([{"nym": "a"}, {"nym": "a", "strata": {"age": "18-34"}}])
    for bad in ["", "has space", "new\nline", "x" * 257]:
        with pytest.raises(PoolError):
            Member(bad)
    for strata in [{"a=b": "c"}, {"age": "18 34"}, {"age": ""}, {"-x": "y"}]:
        with pytest.raises(PoolError):
            Member("nym", strata)
    with pytest.raises(PoolError):
        Member.from_dict({"nym": "a", "extra": 1})
