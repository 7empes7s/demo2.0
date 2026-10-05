"""Bridging ranker tests on synthetic two-camp data."""

import json
import random
import subprocess
import sys

import numpy as np
import pytest
from d2_commons import (
    NEEDS_MORE_RATINGS,
    SCORED,
    RankerParams,
    Rating,
    code_hash,
    rank,
    ranker_version,
    top_arguments,
)

# Arguments: two per camp, one that both camps find strong.
STANCES = {"yes-1": "yes", "yes-2": "yes", "no-1": "no", "no-2": "no", "bridge": "yes"}
CAMP_ARGS = {"A": ["yes-1", "yes-2"], "B": ["no-1", "no-2"]}


def two_camps(per_camp: int = 30, seed: int = 1) -> list[Rating]:
    """Camp A loves yes-*, rejects no-*; camp B the mirror. Both mostly rate `bridge` strong.

    yes-1 is the one-camp favourite: every A rater calls it strong, every B rater does not.
    """
    rng = np.random.default_rng(seed)
    out = []
    for camp, other in (("A", "B"), ("B", "A")):
        for n in range(per_camp):
            nym = f"{camp}{n}"
            for arg in CAMP_ARGS[camp]:
                out.append(Rating(arg, nym, arg == "yes-1" or rng.random() < 0.85))
            for arg in CAMP_ARGS[other]:
                out.append(Rating(arg, nym, rng.random() < 0.1 and arg != "yes-1"))
            out.append(Rating("bridge", nym, rng.random() < 0.7))
    return out


def brigade(n_raters: int, camp: str = "A") -> list[Rating]:
    """Extra raters from one camp mass-rating their own side strong and the other side not."""
    other = "B" if camp == "A" else "A"
    out = []
    for n in range(n_raters):
        nym = f"brigade-{camp}{n}"
        out += [Rating(a, nym, True) for a in CAMP_ARGS[camp]]
        out += [Rating(a, nym, False) for a in CAMP_ARGS[other]]
    return out


PARAMS = RankerParams()
# A brigade (up to 10x the camp's size) may move any argument's score by at most this much...
BRIGADE_TOLERANCE = 0.08
# ...and the gap between the two camps' arguments (mean yes-* minus mean no-*) by at most this.
GAP_TOLERANCE = 0.11


def scores(ratings, params=PARAMS):
    return {s.argument_id: s.score for s in rank(ratings, params=params, stances=STANCES)}


def order(ratings):
    return [s.argument_id for s in rank(ratings, params=PARAMS, stances=STANCES)]


def test_cross_camp_argument_outranks_one_camp_favourite():
    ranked = order(two_camps())
    assert ranked[0] == "bridge"
    assert ranked.index("bridge") < ranked.index("yes-1")


def test_factor_is_reported_but_does_not_score():
    by_id = {s.argument_id: s for s in rank(two_camps(), params=PARAMS)}
    # Camp arguments sit at opposite ends of the factor; the bridge sits near the middle.
    assert by_id["yes-1"].factor[0] * by_id["no-1"].factor[0] < 0
    assert abs(by_id["bridge"].factor[0]) < abs(by_id["yes-1"].factor[0])


def camp_gap(s):
    return (s["yes-1"] + s["yes-2"]) / 2 - (s["no-1"] + s["no-2"]) / 2


@pytest.mark.parametrize("brigade_size", [30, 90, 300])
def test_brigade_moves_every_score_less_than_tolerance(brigade_size):
    base = scores(two_camps())
    attacked = scores(two_camps() + brigade(brigade_size, camp="A"))
    for arg in STANCES:
        assert abs(attacked[arg] - base[arg]) < BRIGADE_TOLERANCE, arg
    assert abs(camp_gap(attacked) - camp_gap(base)) < GAP_TOLERANCE
    assert order(two_camps() + brigade(brigade_size, camp="A"))[0] == "bridge"


def test_single_issue_raters_are_left_out():
    # Throwaway raters who only rate their side's argument strong are left out of the fit.
    flood = [Rating("yes-1", f"z{n}", True) for n in range(300)]
    assert scores(two_camps() + flood) == scores(two_camps())


def test_unrelated_ratings_do_not_move_scores():
    base = scores(two_camps())
    extra = [Rating(f"other-{j}", f"x{n}", (n + j) % 2 == 0) for n in range(300) for j in range(3)]
    attacked = scores(two_camps() + extra)
    for arg in STANCES:
        assert abs(attacked[arg] - base[arg]) < 1e-6, arg


def test_duplicate_ratings_count_once_and_last_wins():
    raters = [f"A{n}" for n in range(3)]
    dup = [Rating("solo", "A0", True)] * 5
    by_id = {s.argument_id: s for s in rank(two_camps() + dup, params=PARAMS)}
    assert by_id["solo"].n_ratings == 1 and by_id["solo"].status == NEEDS_MORE_RATINGS
    flip = [Rating("bridge", u, False) for u in raters] + [
        Rating("bridge", u, True) for u in raters
    ]
    assert scores(two_camps() + flip) == scores(
        [x for x in two_camps() if not (x.argument_id == "bridge" and x.rater_nym in raters)]
        + [Rating("bridge", u, True) for u in raters]
    )


def test_deterministic_and_order_independent():
    ratings = two_camps()
    first = rank(ratings, params=PARAMS, stances=STANCES)
    shuffled = ratings[:]
    random.Random(7).shuffle(shuffled)
    assert rank(ratings, params=PARAMS, stances=STANCES) == first
    assert rank(shuffled, params=PARAMS, stances=STANCES) == first


def test_min_ratings_rule():
    ratings = two_camps() + [Rating("new", f"A{n}", True) for n in range(4)]
    by_id = {s.argument_id: s for s in rank(ratings, params=RankerParams(min_ratings=5))}
    assert by_id["new"].status == NEEDS_MORE_RATINGS
    assert by_id["new"].score is None and by_id["new"].n_ratings == 4
    assert by_id["bridge"].status == SCORED
    ranked = rank(ratings, params=RankerParams(min_ratings=5))
    assert ranked[-1].argument_id == "new"
    by_id = {s.argument_id: s for s in rank(ratings, params=RankerParams(min_ratings=4))}
    assert by_id["new"].status == SCORED


def test_top_arguments_by_stance():
    scored = rank(two_camps() + [Rating("yes-3", "A0", True)], params=PARAMS, stances=STANCES)
    top_yes = top_arguments(scored, "yes", 2)
    assert [s.argument_id for s in top_yes][0] == "bridge"
    assert len(top_yes) == 2 and all(s.stance_option_id == "yes" for s in top_yes)
    assert {s.argument_id for s in top_arguments(scored, "no", 5)} == {"no-1", "no-2"}


def test_code_hash_stable_and_in_version():
    h = code_hash()
    assert h == code_hash() and len(h) == 64
    v = ranker_version(PARAMS)
    assert v.code_hash == h and v.algorithm == "bridging-mf"
    assert v.params["min_ratings"] == PARAMS.min_ratings
    assert ranker_version(PARAMS) == v
    assert ranker_version(RankerParams(seed=1)).id != v.id


def test_cli(tmp_path):
    data = {
        "ratings": [
            {"argument_id": r.argument_id, "rater_nym": r.rater_nym, "strong": r.strong}
            for r in two_camps()
        ],
        "stances": STANCES,
    }
    path = tmp_path / "ratings.json"
    path.write_text(json.dumps(data))
    out = subprocess.run(
        [sys.executable, "-m", "d2_commons.rank", str(path)],
        capture_output=True,
        text=True,
        check=True,
    )
    result = json.loads(out.stdout)
    assert result["ranker"]["code_hash"] == code_hash()
    assert result["arguments"][0]["argument_id"] == "bridge"


@pytest.mark.parametrize("bad", ["false", 0, 1.0, None])
def test_cli_rejects_non_boolean_strong(tmp_path, bad):
    path = tmp_path / "ratings.json"
    path.write_text(json.dumps([{"argument_id": "a", "rater_nym": "u", "strong": bad}]))
    out = subprocess.run(
        [sys.executable, "-m", "d2_commons.rank", str(path)], capture_output=True, text=True
    )
    assert out.returncode == 2
    assert "strong must be true or false" in out.stderr
