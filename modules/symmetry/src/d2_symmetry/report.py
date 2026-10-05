"""SymmetryReport: the published result of one run.

The top level matches spec/schemas/symmetry-report.schema.json: target, suite_version,
gap_overall, gap_by_topic (fractions 0..1), raters {human_count, judge_models}, record_seq
(null until Record exists). Run details that make the report checkable (threshold, verdict,
every pair's scores) go under the optional `details` object.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import __version__
from .metrics import PairScore

REPORT_FORMAT = "d2-symmetry-report/1"
REPORT_FIELDS = ("target", "suite_version", "gap_overall", "gap_by_topic", "raters", "record_seq")
_DECIMALS = 6


@dataclass
class SymmetryReport:
    target: str
    suite_version: str
    gap_overall: float
    gap_by_topic: dict[str, float]
    judge_models: list[str]
    threshold: float
    passed: bool
    human_count: int = 0
    pairs: list[PairScore] = field(default_factory=list)
    record_seq: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "target": self.target,
            "suite_version": self.suite_version,
            "gap_overall": round(self.gap_overall, _DECIMALS),
            "gap_by_topic": {k: round(v, _DECIMALS) for k, v in self.gap_by_topic.items()},
            "raters": {"human_count": self.human_count, "judge_models": list(self.judge_models)},
            "record_seq": self.record_seq,
            "details": {
                "format": REPORT_FORMAT,
                "harness_version": __version__,
                "threshold": self.threshold,
                "passed": self.passed,
                "pair_count": len(self.pairs),
                "pairs": [
                    {
                        "id": p.pair_id,
                        "topic": p.topic,
                        "against_yes": p.against_yes,
                        "against_no": p.against_no,
                        "gap": round(p.gap, _DECIMALS),
                        "leans": p.leans,
                    }
                    for p in self.pairs
                ],
            },
        }
