# Commons

The argument library: the strongest arguments real people have made on each matter, ranked by
**bridging**. An argument rises when people from different opinion camps rate it strong, not when
many people of one camp like it.

## How the ranker works (`bridging-mf`, `src/d2_commons/ranker.py`)

Each rating `r` (1 = strong, 0 = not strong) by rater `u` on argument `a` is modelled as

    r ≈ mu + i_u + i_a + f_u · f_a

- `f_u` and `f_a` are low-dimensional factors (1-D by default). They soak up camp alignment:
  "people like me like arguments like this". The factor never counts towards the score.
- **The score** is the argument's predicted rating, minus `mu`, for a rater standing **midway
  between the two camps that rated it**. Raters are split into two camps on the factor; the
  score uses the average of the two camps' mean positions, with both camps counted equally.
  A camp that floods in extra raters therefore cannot drag the reference point towards itself.
  It can only change its own camp's average opinion.
- One rating per (argument, rater): the last one wins. `min_ratings` (default 5) counts distinct
  raters; below it an argument is listed as `needs more ratings` with no score.
- Raters with fewer than `min_rater_ratings` (default 3) ratings are left out of the fit. A rater
  with a single rating has no measurable camp, so the model would read it as neutral support.
- Penalties are fixed per argument and per rater (`lambda_intercept=1.0`,
  `lambda_factor=0.1`) and `mu` is fixed at 0.5. Ratings on other arguments by other raters
  therefore leave an argument's score unchanged.
- Alternating ridge regression in numpy. Starting factors come from each id's hash, so the
  result is deterministic and independent of input order.

### Measured brigade resistance

`tests/test_rank.py` uses two camps of 30 raters. Camp A rates its arguments strong 85% of the
time (100% for `yes-1`) and camp B's arguments strong 10% of the time; camp B mirrors this. Both
camps rate `bridge` strong 70% of the time. A brigade adds n camp-A raters who rate `yes-1` and
`yes-2` strong and `no-1` and `no-2` not strong. The table shows score changes:

| brigade n | bridge | yes-1 | yes-2 | no-1 | no-2 | camp gap (yes − no) |
|---|---|---|---|---|---|---|
| 30 (1x) | -0.000 | +0.026 | +0.043 | -0.046 | -0.013 | +0.064 |
| 90 (3x) | +0.001 | +0.032 | +0.058 | -0.062 | -0.013 | +0.082 |
| 300 (10x) | +0.002 | +0.037 | +0.068 | -0.072 | -0.013 | +0.096 |

The tests require every change to stay under 0.08 and the gap change under 0.11. They also
require `bridge` to stay first. What moves is real: the brigade rates more one-sidedly than
camp A already did (1.0 vs 0.85 on `yes-2`, 0 vs 0.1 on `no-1`). Because the camps count
equally, that shift reaches the score at about half strength and levels off as the brigade
grows.

Not covered: raters who rate everything strong across both camps look like bridgers and do
lift scores. One human, one rating (Door) is the defence there, not this ranker.

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
