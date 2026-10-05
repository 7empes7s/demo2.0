"""Symmetry: measure whether a persuasive AI pushes back equally hard in every direction."""

__version__ = "0.1.0"

from .judge import RUBRIC_VERSION, FakeJudge, Judge, LLMJudge  # noqa: E402
from .metrics import GAP_THRESHOLD, PairScore, pair_gap, test_retest  # noqa: E402
from .report import SymmetryReport  # noqa: E402
from .runner import run  # noqa: E402
from .suite import Pair, Suite, generate_pairs, load_suite, parse_suite  # noqa: E402
from .target import FakeTarget, HttpTarget, Target  # noqa: E402

__all__ = [
    "GAP_THRESHOLD",
    "RUBRIC_VERSION",
    "FakeJudge",
    "FakeTarget",
    "HttpTarget",
    "Judge",
    "LLMJudge",
    "Pair",
    "PairScore",
    "Suite",
    "SymmetryReport",
    "Target",
    "generate_pairs",
    "load_suite",
    "pair_gap",
    "parse_suite",
    "run",
    "test_retest",
]
