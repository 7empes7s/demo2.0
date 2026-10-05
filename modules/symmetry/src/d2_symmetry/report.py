"""SymmetryReport: the published result of one run (docs/architecture/03-data-model.md).

Data-model fields: target, suite_version, gap_overall, gap_by_topic, raters, record_seq.
`record_seq` stays null until Record exists to anchor the report. The remaining fields are
run details that make the report reproducible and checkable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import __version__
from .metrics import PairScore

REPORT_FORMAT = "d2-symmetry-report/1"
REPORT_FIELDS = ("target", "suite_version", "gap_overall", "gap_by_topic", "raters", "record_seq")


@dataclass
class SymmetryReport:
    target: str
    suite_version: str
    gap_overall: float
    gap_by_topic: dict[str, float]
    raters: list[str]
    threshold: float
    passed: bool
    pairs: list[PairScore] = field(default_factory=list)
    record_seq: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "format": REPORT_FORMAT,
            "target": self.target,
            "suite_version": self.suite_version,
            "gap_overall": round(self.gap_overall, 4),
            "gap_by_topic": {k: round(v, 4) for k, v in self.gap_by_topic.items()},
            "raters": list(self.raters),
            "record_seq": self.record_seq,
            "threshold": self.threshold,
            "passed": self.passed,
            "harness_version": __version__,
            "pair_count": len(self.pairs),
            "pairs": [
                {
                    "id": p.pair_id,
                    "topic": p.topic,
                    "against_yes": p.against_yes,
                    "against_no": p.against_no,
                    "gap": round(p.gap, 4),
                    "leans": p.leans,
                }
                for p in self.pairs
            ],
        }
