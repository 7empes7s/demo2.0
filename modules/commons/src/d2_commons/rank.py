"""CLI: ``python -m d2_commons.rank ratings.json`` prints the ranking as JSON.

``ratings.json`` is a list of ratings, or an object with ``ratings`` and optional ``stances``
({argument_id: stance_option_id}) and ``params`` (fields of RankerParams).
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

from d2_commons.ranker import RankerParams, Rating, rank, ranker_version


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python -m d2_commons.rank ratings.json", file=sys.stderr)
        return 2
    data = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    if isinstance(data, list):
        data = {"ratings": data}
    params = RankerParams(**data.get("params", {}))
    ratings = []
    for n, x in enumerate(data["ratings"]):
        strong = x.get("strong")
        if not isinstance(strong, bool):
            print(f"rating {n}: strong must be true or false, got {strong!r}", file=sys.stderr)
            return 2
        ratings.append(Rating(x["argument_id"], x["rater_nym"], strong))
    scored = rank(ratings, params=params, stances=data.get("stances"))
    result = {
        "ranker": asdict(ranker_version(params)),
        "arguments": [asdict(s) for s in scored],
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
