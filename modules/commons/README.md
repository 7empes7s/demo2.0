# Commons

The argument library: the strongest arguments real people have made on each matter, ranked by
**bridging**. An argument rises when people from different opinion camps rate it strong, not when
many people of one camp like it.

## How the ranker works (`bridging-mf`, `src/d2_commons/ranker.py`)

Each rating `r` (1 = strong, 0 = not strong) by rater `u` on argument `a` is modelled as

    r ≈ mu + i_u + i_a + f_u · f_a

- `f_u` and `f_a` are low-dimensional factors (1-D by default). They soak up camp alignment:
  "people like me like arguments like this".
- `i_a`, the argument intercept, is what is left once alignment is explained. **The score is
  `i_a`.** The factor never counts.
- Intercepts are regularised more than factors, so the fit prefers to explain a rating by
  alignment. Only support that crosses camps survives into the intercept. The default ratio is
  15:1 (`lambda_intercept=0.15`, `lambda_factor=0.01`); Community Notes uses 5:1, which in the
  brigade test let a camp that tripled its raters lift its own argument by about 0.10.

Brigade test (`tests/test_rank.py`, 30 raters per camp): adding 90 camp-A raters who rate their
side strong and the other side not moves camp A's favourite by +0.039 (tolerance 0.05), and even
300 such raters leave it below the cross-camp argument.

The fit is alternating ridge regression in numpy from a fixed seed, so the same ratings and
params always give the same scores. Arguments with fewer than `min_ratings` ratings are listed
with status `needs more ratings` and no score.

Every result carries a `RankerVersion`: algorithm name, params and `code_hash` (sha256 of
`ranker.py`), so a published ranking can be tied to the exact code that produced it.

## Use

```python
from d2_commons import Rating, RankerParams, rank, top_arguments

scored = rank(ratings, params=RankerParams(), stances={"arg-1": "yes"})
best_yes = top_arguments(scored, "yes", 5)
```

CLI:

```
python -m d2_commons.rank ratings.json
```

`ratings.json` is either a list of ratings or an object
`{"ratings": [...], "stances": {"<argument_id>": "<stance_option_id>"}, "params": {...}}`.
A rating is `{"argument_id": "...", "rater_nym": "...", "strong": true}`.

## Licence

AGPL-3.0-or-later.
