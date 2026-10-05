"""Bridging ranker for Commons arguments (algorithm ``bridging-mf``).

Each rating r (1 = strong, 0 = not strong) of argument a by rater u is modelled as

    r ~ mu + i_u + i_a + f_u . f_a

The factors f soak up camp alignment ("people like me like arguments like this"). The argument
intercept is what is left: support that alignment cannot explain. The factor never counts.

Where the factor's zero point sits decides how much of a camp's support lands in the intercept.
Left to the regulariser it drifts to the average rater, so a camp that floods in raters drags it
towards itself and lifts its own arguments. The score is therefore the argument's predicted
rating, minus mu, for a rater at the **midpoint between the two camps** that rated it: the mean
factor position of its raters on each side of the split, averaged with the two sides weighted
equally. Extra raters from one camp do not move that midpoint, only that camp's average opinion.

Guards and fit details:
- One rating per (argument, rater); the last one given wins.
- Raters with fewer than ``min_rater_ratings`` ratings are left out. A rater with one rating has
  no measurable camp, so the model would read their rating as neutral support.
- Penalties are fixed per entity and mu is fixed at 0.5, so an argument's score never depends on
  how many ratings other, unrelated arguments received.
- Alternating ridge regression in numpy; every entity's starting factor is derived from its id,
  so the fit is deterministic and independent of input order.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

ALGORITHM = "bridging-mf"
SCORED = "scored"
NEEDS_MORE_RATINGS = "needs more ratings"
MU = 0.5  # fixed global offset: the middle of the 0..1 scale


@dataclass(frozen=True)
class Rating:
    argument_id: str
    rater_nym: str
    strong: bool


@dataclass(frozen=True)
class RankerParams:
    factor_dim: int = 1
    lambda_intercept: float = 1.0
    lambda_factor: float = 0.1
    iterations: int = 100
    seed: int = 0
    min_ratings: int = 5
    min_rater_ratings: int = 3


@dataclass(frozen=True)
class RankerVersion:
    id: str
    algorithm: str
    params: dict
    code_hash: str


@dataclass(frozen=True)
class ScoredArgument:
    argument_id: str
    stance_option_id: str | None
    status: str
    n_ratings: int
    score: float | None = None
    factor: tuple[float, ...] | None = field(default=None)


def code_hash() -> str:
    """sha256 of this source file: ties a published ranking to the exact code."""
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def ranker_version(params: RankerParams) -> RankerVersion:
    p = asdict(params)
    h = code_hash()
    blob = json.dumps({"algorithm": ALGORITHM, "params": p, "code_hash": h}, sort_keys=True)
    vid = f"{ALGORITHM}@{hashlib.sha256(blob.encode()).hexdigest()[:12]}"
    return RankerVersion(id=vid, algorithm=ALGORITHM, params=p, code_hash=h)


def _init(ids: list[str], k: int, seed: int) -> np.ndarray:
    """Small starting factors derived from each id, so adding other ids changes nothing."""
    rows = []
    for x in ids:
        digest = hashlib.sha256(f"{seed}:{x}".encode()).digest()
        rows.append([(digest[j] / 255.0 - 0.5) * 0.2 for j in range(k)])
    return np.array(rows, dtype=float).reshape(len(ids), k)


def _ridge_rows(rows, cols, target, other_f, n_rows, lam_i, lam_f):
    """For each row entity, solve ridge for (intercept, factor) given the other side's factors."""
    k = other_f.shape[1]
    x = np.hstack([np.ones((len(cols), 1)), other_f[cols]])  # features per rating
    a = np.zeros((n_rows, k + 1, k + 1))
    b = np.zeros((n_rows, k + 1))
    np.add.at(a, rows, x[:, :, None] * x[:, None, :])
    np.add.at(b, rows, x * target[:, None])
    a += np.diag([lam_i] + [lam_f] * k)
    sol = np.linalg.solve(a, b[:, :, None])[:, :, 0]
    return sol[:, 0], sol[:, 1:]


def _split_point(f_u: np.ndarray) -> float:
    """Where to split raters into two camps on the first factor (1-D two-means)."""
    c = float(np.median(f_u[:, 0]))
    for _ in range(50):
        side = f_u[:, 0] >= c
        if side.all() or not side.any():
            break
        c = (f_u[side, 0].mean() + f_u[~side, 0].mean()) / 2
    return c


def _scores(users, items, f_u, i_a, f_a, n_items):
    """Each argument's predicted rating (minus mu) for a rater midway between its two camps."""
    side = f_u[users, 0] >= _split_point(f_u)
    k = f_u.shape[1]
    sums = np.zeros((n_items, 2, k))
    counts = np.zeros((n_items, 2))
    np.add.at(sums, (items, side.astype(int)), f_u[users])
    np.add.at(counts, (items, side.astype(int)), 1.0)
    means = sums / np.maximum(counts, 1.0)[:, :, None]
    both = (counts > 0).all(1)
    # Rated by one camp only: no cross-camp evidence, so fall back to the bare intercept.
    centre = np.where(both[:, None], means.mean(1), 0.0)
    return i_a + np.sum(centre * f_a, 1)


def _fit(users, items, r, nyms, arg_ids, params: RankerParams):
    k = params.factor_dim
    f_u = _init(nyms, k, params.seed)
    f_a = _init(arg_ids, k, params.seed + 1)
    i_a = np.zeros(len(arg_ids))
    lam_i, lam_f = params.lambda_intercept, params.lambda_factor
    for _ in range(params.iterations):
        i_u, f_u = _ridge_rows(users, items, r - MU - i_a[items], f_a, len(nyms), lam_i, lam_f)
        i_a, f_a = _ridge_rows(items, users, r - MU - i_u[users], f_u, len(arg_ids), lam_i, lam_f)
    return _scores(users, items, f_u, i_a, f_a, len(arg_ids)), f_a


def rank(
    ratings: Iterable[Rating],
    *,
    params: RankerParams,
    stances: Mapping[str, str] | None = None,
) -> list[ScoredArgument]:
    """Score every rated argument. Scored ones come first, best first; ties break by id.

    ``n_ratings`` counts distinct raters whose ratings the fit used.
    """
    stances = stances or {}
    # One rating per (argument, rater): the last one wins.
    latest = {(x.argument_id, x.rater_nym): x for x in ratings}
    all_args = sorted({a for a, _ in latest})
    per_rater: dict[str, int] = {}
    for _, u in latest:
        per_rater[u] = per_rater.get(u, 0) + 1
    used = sorted(
        (x for (_, u), x in latest.items() if per_rater[u] >= params.min_rater_ratings),
        key=lambda x: (x.argument_id, x.rater_nym),
    )
    counts = {a: 0 for a in all_args}
    for x in used:
        counts[x.argument_id] += 1

    score: dict[str, float] = {}
    factor: dict[str, np.ndarray] = {}
    if used:
        arg_ids = sorted({x.argument_id for x in used})
        nyms = sorted({x.rater_nym for x in used})
        a_ix = {a: i for i, a in enumerate(arg_ids)}
        u_ix = {u: i for i, u in enumerate(nyms)}
        users = np.array([u_ix[x.rater_nym] for x in used])
        items = np.array([a_ix[x.argument_id] for x in used])
        r = np.array([1.0 if x.strong else 0.0 for x in used])
        s, f_a = _fit(users, items, r, nyms, arg_ids, params)
        score = {a: float(s[i]) for a, i in a_ix.items()}
        factor = {a: f_a[i] for a, i in a_ix.items()}

    out = []
    for a in all_args:
        n = counts[a]
        if n < params.min_ratings:
            out.append(ScoredArgument(a, stances.get(a), NEEDS_MORE_RATINGS, n))
        else:
            f = tuple(round(float(v), 6) for v in factor[a])
            out.append(ScoredArgument(a, stances.get(a), SCORED, n, round(score[a], 6), f))
    out.sort(key=lambda s: (s.status != SCORED, -(s.score or 0.0), s.argument_id))
    return out


def top_arguments(
    scored: Sequence[ScoredArgument], stance_option_id: str, n: int
) -> list[ScoredArgument]:
    """The n best scored arguments for one stance option, in rank order."""
    hits = [s for s in scored if s.status == SCORED and s.stance_option_id == stance_option_id]
    return sorted(hits, key=lambda s: (-(s.score or 0.0), s.argument_id))[:n]
