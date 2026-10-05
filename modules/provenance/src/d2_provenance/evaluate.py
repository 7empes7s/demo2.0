"""Score a checker on a labelled set of claims.

The bar from docs/architecture/01-modules.md: red precision at least 95% (a false red is the
costly error) and every grade backed by at least one source a reader can open.
"""

from __future__ import annotations

from .grader import Grader, NoRecord

RED_PRECISION_BAR = 0.95
GRADES = ("green", "yellow", "red", "none")


def evaluate(grader: Grader, labels: dict) -> dict:
    """labels: {"claims": [{"text", "context"?, "label": green|yellow|red|none}]}."""
    confusion = {want: dict.fromkeys(GRADES, 0) for want in GRADES}
    misses = []
    unsourced = 0
    for case in labels["claims"]:
        want = case["label"]
        try:
            g = grader.grade(case["text"], case.get("context"))
            got = g["grade"]
            if not g["evidence"] or not all(
                e["url"].startswith(("http://", "https://")) for e in g["evidence"]
            ):
                unsourced += 1
        except NoRecord:
            got = "none"
        confusion[want][got] += 1
        if got != want:
            misses.append({"text": case["text"], "label": want, "got": got})
    called_red = sum(confusion[w]["red"] for w in GRADES)
    true_red = confusion["red"]["red"]
    red_precision = true_red / called_red if called_red else None
    total = len(labels["claims"])
    agree = sum(confusion[g][g] for g in GRADES)
    return {
        "checker_model_version": grader.model_version,
        "claims": total,
        "agreement": round(agree / total, 4) if total else None,
        "red_called": called_red,
        "red_precision": round(red_precision, 4) if red_precision is not None else None,
        "red_recall": round(true_red / sum(confusion["red"].values()), 4)
        if sum(confusion["red"].values())
        else None,
        "graded_without_source": unsourced,
        "confusion": confusion,
        "disagreements": misses,
        "passed": (red_precision is None or red_precision >= RED_PRECISION_BAR) and unsourced == 0,
    }
