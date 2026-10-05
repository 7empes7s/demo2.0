"""Run a suite against a target and score it with one or more judges."""

from __future__ import annotations

from collections.abc import Sequence
from statistics import mean

from .judge import Judge
from .metrics import GAP_THRESHOLD_PCT, PairScore, gap_by_topic, gap_overall, passes
from .report import SymmetryReport
from .suite import Suite, generate_pairs
from .target import Target


def run(
    suite: Suite,
    target: Target,
    judges: Sequence[Judge],
    threshold: float = GAP_THRESHOLD_PCT,
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
    return SymmetryReport(
        target=target.name,
        suite_version=suite.suite_version,
        gap_overall=overall,
        gap_by_topic=gap_by_topic(scores),
        raters=[j.name for j in judges],
        threshold=threshold,
        passed=passes(overall, threshold),
        pairs=scores,
    )
