import copy
from collections import Counter
from pathlib import Path

import pytest
from d2_lottery import (
    KNOWN_CHAINS,
    MIN_SEED_DELAY_SECONDS,
    ChainInfo,
    Commitment,
    DrawError,
    Pool,
    Stream,
    commit,
    panel,
    panel_size_range,
    run_draw,
    seed,
    verify,
)
from d2_lottery import vectors as gen

DRAWS = Path(__file__).resolve().parents[3] / "spec" / "lottery" / "vectors" / "draws.json"


def test_vectors_file_is_up_to_date():
    assert DRAWS.read_text("utf-8") == gen.render(), (
        "run: uv run python -m d2_lottery.vectors --out spec/lottery/vectors/draws.json"
    )


def test_stream_vectors(vectors):
    for v in vectors["streams"]:
        s = Stream(bytes.fromhex(v["seed"]))
        assert [str(s.u64()) for _ in v["u64"]] == v["u64"]
        s = Stream(bytes.fromhex(v["seed"]))
        assert [str(s.below(int(b["n"]))) for b in v["below"]] == [b["value"] for b in v["below"]]


def test_below_is_uniform_enough():
    s = Stream(bytes(32))
    counts = Counter(s.below(6) for _ in range(60000))
    assert set(counts) == set(range(6))
    assert all(abs(c - 10000) < 400 for c in counts.values()), counts


def test_rejection_sampling_rejects_the_biased_tail():
    class Fixed(Stream):
        def __init__(self, words):
            self.words = list(words)

        def u64(self):
            return self.words.pop(0)

    n = 3
    limit = (1 << 64) - ((1 << 64) % n)
    assert Fixed([limit, limit - 1]).below(n) == (limit - 1) % n
    assert Fixed([(1 << 64) - 1, 5]).below(n) == 5 % n


def test_commitment_text_and_seed_match_vectors(vectors):
    for d in vectors["draws"]:
        c = Commitment.from_dict(d["transcript"]["commitment"])
        assert c.text() == d["commitment_text"]
        assert c.hash().hex() == d["transcript"]["result"]["commitment_hash"]
        assert seed(c, bytes.fromhex(d["transcript"]["beacon"]["randomness"])).hex() == d["seed"]
    assert vectors["draws"][1]["commitment_text"].endswith(
        "stratify-by age\nquota 18-34 2\nquota 35-54 2\nquota 55-plus 2\n"
    )


def _trusted(d):
    info = d["trusted_chain_info"]
    if info is None:
        return None
    chain = ChainInfo.from_dict(info)
    return {chain.hash: chain}


def test_every_published_draw_reproduces(vectors):
    for d in vectors["draws"]:
        assert verify(d["transcript"], _trusted(d)) == d["transcript"]["result"]


@pytest.mark.parametrize("i", range(15))
def test_invalid_transcripts_fail(vectors, i):
    case = vectors["invalid"][i]
    with pytest.raises(DrawError):
        verify(case["transcript"], _trusted(case))


def test_stratified_draw_honours_quotas(vectors):
    d = vectors["draws"][1]["transcript"]
    pool = {m["nym"]: m["strata"]["age"] for m in d["pool"]}
    ages = Counter(pool[n] for n in d["result"]["selected"])
    assert ages == {"18-34": 2, "35-54": 2, "55-plus": 2}
    for g in d["result"]["groups"]:
        assert sorted(g["order"]) == sorted(n for n, a in pool.items() if a == g["stratum"])


def test_replacements_come_from_the_same_order(vectors):
    r = vectors["replacements"]
    result = next(d for d in vectors["draws"] if d["name"] == r["draw"])["transcript"]["result"]
    assert panel(result, r["declined"]) == r["panel"]
    assert panel(result, reversed(r["declined"])) == r["panel"]
    g = result["groups"][0]
    # Declining the whole stratum leaves its seats short, never filled from another stratum.
    assert panel(result, g["order"])["short"] == g["quota"]
    assert panel(result)["members"] == result["selected"]


def _pool(n=12):
    ages = ("18-34", "35-54", "55-plus")
    return Pool([{"nym": f"nym-{i:03d}", "strata": {"age": ages[i % 3]}} for i in range(n)])


def test_commit_reads_panel_size_from_charter():
    assert panel_size_range("local") == (5, 9)
    assert panel_size_range("minor") == (3, 3)
    chain = KNOWN_CHAINS["quicknet"]
    now = 1_800_000_000
    c = commit(
        _pool(),
        purpose="review",
        context="m-1",
        size=5,
        committed_at=now,
        chain=chain,
        tier="local",
    )
    assert chain.round_time(c.round) >= now + MIN_SEED_DELAY_SECONDS
    assert chain.round_time(c.round - 1) < now + MIN_SEED_DELAY_SECONDS
    with pytest.raises(DrawError, match="local panel has 5 to 9"):
        commit(
            _pool(),
            purpose="review",
            context="m-1",
            size=4,
            committed_at=now,
            chain=chain,
            tier="local",
        )


def test_commit_refuses_a_round_too_soon():
    chain = KNOWN_CHAINS["quicknet"]
    now = 1_800_000_000
    soon = chain.first_round_at_or_after(now + 60)
    with pytest.raises(DrawError, match="before committed_at"):
        commit(_pool(), purpose="p", context="c", size=3, committed_at=now, chain=chain, round=soon)


@pytest.mark.parametrize(
    "kw",
    [
        {"stratify_by": "age", "quotas": {"18-34": 1, "35-54": 1}},  # sums to 2, size 3
        {"stratify_by": "age", "quotas": {"18-34": 5, "35-54": 0, "55-plus": 0}},  # only 4 have it
        {"stratify_by": "age", "quotas": {"18-34": 3}},  # others have no quota
        {"stratify_by": "age", "quotas": {"18-34": 1, "35-54": 1, "55-plus": 0, "x": 1}},
        {"stratify_by": "commune", "quotas": {"esch": 3}},  # nobody has a commune
        {"quotas": {"18-34": 3}},
        {"stratify_by": "age"},
    ],
)
def test_commit_refuses_unsatisfiable_quotas(kw):
    with pytest.raises(DrawError):
        commit(
            _pool(),
            purpose="p",
            context="c",
            size=3,
            committed_at=0,
            chain=KNOWN_CHAINS["quicknet"],
            **kw,
        )


def test_size_cannot_exceed_pool():
    with pytest.raises(DrawError):
        commit(
            _pool(3),
            purpose="p",
            context="c",
            size=4,
            committed_at=0,
            chain=KNOWN_CHAINS["quicknet"],
        )


def test_draw_is_a_permutation_and_depends_on_every_input():
    pool = _pool(30)
    c = commit(
        pool, purpose="p", context="c", size=5, committed_at=0, chain=KNOWN_CHAINS["quicknet"]
    )
    r = run_draw(c, pool, bytes(32))
    assert sorted(r["groups"][0]["order"]) == sorted(m.nym for m in pool.members)
    assert run_draw(c, pool, bytes(32)) == r
    assert run_draw(c, pool, b"\x01" + bytes(31))["selected"] != r["selected"]
    other = Commitment.from_dict({**c.to_dict(), "context": "c2"})
    assert run_draw(other, pool, bytes(32))["selected"] != r["selected"]


def test_each_member_is_equally_likely():
    # 6000 draws of 2 from 6: each member should be picked about 2000 times.
    pool = _pool(6)
    c = commit(
        pool, purpose="p", context="c", size=2, committed_at=0, chain=KNOWN_CHAINS["quicknet"]
    )
    counts = Counter()
    for i in range(6000):
        counts.update(run_draw(c, pool, i.to_bytes(32, "big"))["selected"])
    assert all(abs(n - 2000) < 150 for n in counts.values()), counts


def test_commitment_rejects_unknown_fields_and_versions(vectors):
    raw = copy.deepcopy(vectors["draws"][0]["transcript"]["commitment"])
    with pytest.raises(DrawError):
        Commitment.from_dict({**raw, "extra": 1})
    with pytest.raises(DrawError):
        Commitment.from_dict({**raw, "version": "d2.lottery.draw/2"})
    with pytest.raises(DrawError):
        Commitment.from_dict({**raw, "purpose": "has space"})
