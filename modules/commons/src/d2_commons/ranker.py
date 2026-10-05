"""Bridging ranker for Commons arguments (algorithm ``bridging-mf``).

Each rating r (1 = strong, 0 = not strong) of argument a by rater u is modelled as

    r ~ mu + i_u + i_a + f_u . f_a

The factors f soak up camp alignment ("people like me like arguments like this"). The argument
intercept i_a is what is left: support that alignment cannot explain, which in practice means
support from more than one camp. The score is i_a; the factor never counts. Intercepts are
regularised 15x more than factors (Community Notes uses 5x) so the fit prefers to explain ratings
by alignment. The wider ratio was chosen because it keeps a camp that floods in new raters from
shifting the factor's zero point, and so its own arguments' intercepts (see the brigade test).

The fit is alternating ridge regression (numpy only) from a fixed seed, so it is deterministic.
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


@dataclass(frozen=True)
class Rating:
    argument_id: str
    rater_nym: str
    strong: bool


@dataclass(frozen=True)
class RankerParams:
    factor_dim: int = 1
    lambda_intercept: float = 0.15
    lambda_factor: float = 0.01
    iterations: int = 100
    seed: int = 0
    min_ratings: int = 5


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


def _fit(users, items, r, n_users, n_items, params: RankerParams):
    rng = np.random.default_rng(params.seed)
    k = params.factor_dim
    f_u = rng.normal(0.0, 0.1, (n_users, k))
    f_a = rng.normal(0.0, 0.1, (n_items, k))
    i_u = np.zeros(n_users)
    i_a = np.zeros(n_items)
    mu = float(r.mean())
    # Loss = mean squared error + lambda * mean(param^2), as in Community Notes. Written as a
    # sum over ratings, each user's (or argument's) penalty is lambda * n_ratings / n_users.
    su, sa = len(r) / n_users, len(r) / n_items
    lam_i, lam_f = params.lambda_intercept, params.lambda_factor
    for _ in range(params.iterations):
        t = r - mu - i_a[items]
        i_u, f_u = _ridge_rows(users, items, t, f_a, n_users, lam_i * su, lam_f * su)
        t = r - mu - i_u[users]
        i_a, f_a = _ridge_rows(items, users, t, f_u, n_items, lam_i * sa, lam_f * sa)
        mu = float(np.mean(r - i_u[users] - i_a[items] - np.sum(f_u[users] * f_a[items], 1)))
    return mu, i_a, f_a


def rank(
    ratings: Iterable[Rating],
    *,
    params: RankerParams,
    stances: Mapping[str, str] | None = None,
) -> list[ScoredArgument]:
    """Score every rated argument. Scored ones come first, best first; ties break by id."""
    ratings = list(ratings)
    stances = stances or {}
    if not ratings:
        return []
    arg_ids = sorted({x.argument_id for x in ratings})
    nyms = sorted({x.rater_nym for x in ratings})
    a_ix = {a: i for i, a in enumerate(arg_ids)}
    u_ix = {u: i for i, u in enumerate(nyms)}
    # Sorting the ratings makes the fit independent of input order.
    ratings.sort(key=lambda x: (x.argument_id, x.rater_nym, x.strong))
    users = np.array([u_ix[x.rater_nym] for x in ratings])
    items = np.array([a_ix[x.argument_id] for x in ratings])
    r = np.array([1.0 if x.strong else 0.0 for x in ratings])
    _, i_a, f_a = _fit(users, items, r, len(nyms), len(arg_ids), params)
    counts = np.bincount(items, minlength=len(arg_ids))

    out = []
    for a, i in a_ix.items():
        n = int(counts[i])
        if n < params.min_ratings:
            out.append(ScoredArgument(a, stances.get(a), NEEDS_MORE_RATINGS, n))
        else:
            factor = tuple(round(float(v), 6) for v in f_a[i])
            score = round(float(i_a[i]), 6)
            out.append(ScoredArgument(a, stances.get(a), SCORED, n, score, factor))
    out.sort(key=lambda s: (s.status != SCORED, -(s.score or 0.0), s.argument_id))
    return out


def top_arguments(
    scored: Sequence[ScoredArgument], stance_option_id: str, n: int
) -> list[ScoredArgument]:
    """The n best scored arguments for one stance option, in rank order."""
    hits = [s for s in scored if s.status == SCORED and s.stance_option_id == stance_option_id]
    return sorted(hits, key=lambda s: (-(s.score or 0.0), s.argument_id))[:n]
