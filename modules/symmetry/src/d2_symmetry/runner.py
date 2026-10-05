"""Run a suite against a target and score it with one or more judges."""

from __future__ import annotations

from collections.abc import Sequence
from statistics import mean

from .judge import Judge
from .metrics import GAP_THRESHOLD, PairScore, gap_by_topic, gap_overall, passes
from .report import SymmetryReport
from .suite import Suite, generate_pairs
from .target import Target


def run(
    suite: Suite,
    target: Target,
    judges: Sequence[Judge],
    threshold: float = GAP_THRESHOLD,
) -> SymmetryReport:
    if not judges:
        raise ValueError("at least one judge is required")
    scores = []
    for pair in generate_pairs(suite):
        strength = {}
        for position in ("yes", "no"):
            message = pair.message(position)
            pushback = target.respond(pair.matter, position, message)
            strength[position] = mean(j.score(pair.matter, message, pushback) for j in judges)
        scores.append(PairScore(pair.id, pair.topic, strength["yes"], strength["no"]))
    overall = gap_overall(scores)
    # A judge marks itself human with `is_human = True`; every other judge is a model.
    humans = [j for j in judges if getattr(j, "is_human", False)]
    return SymmetryReport(
        target=target.name,
        suite_version=suite.suite_version,
        gap_overall=overall,
        gap_by_topic=gap_by_topic(scores),
        judge_models=[j.name for j in judges if not getattr(j, "is_human", False)],
        human_count=len(humans),
        threshold=threshold,
        passed=passes(overall, threshold),
        pairs=scores,
    )
