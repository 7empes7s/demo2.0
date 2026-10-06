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

## Seeded arguments: Esch-sur-Alzette (`src/d2_commons/esch.py`)

| Source | What becomes an argument | Attributed to | Link |
|---|---|---|---|
| Council votes, from a Docket snapshot (`votes.by_party` of each Esch point) | One `position` per council group and side: `yes` (Oui) or `no` (Non). Abstentions take no side. | The group, e.g. "LSAP group, Esch-sur-Alzette municipal council" | The council session page |
| participation.esch.lu project pages (Hoplr) | Each resident proposal on the page, as a `proposal` for its own option of the project | "A resident, on the city's participation platform" | The proposal's page |

- **Privacy:** no person is named. Councillors are grouped by party (Docket's `members` list is
  never read). The proposal tiles do not show their author, and Commons never reads the author.
  Email addresses (also disguised ones like "jo (at) example (dot) lu"), phone numbers, links
  and a name after "proposé par / proposed by / vorgeschlagen von" in a resident's text are
  replaced by `[removed]`; amounts and years are left alone. A name written any other way is
  not caught, so full proposal text needs a review step before it is ingested.
  Image links (which carry the poster's platform user id) are not stored.
- **A position is not a reason.** A group's recorded vote says who took a side, not why. Its text
  says only that, and the Companion is told never to invent reasons for it. Positions do not
  count toward the Companion's "Commons has enough" threshold.
- **Politeness and safety:** live fetching (`--fetch`) reads only participation.esch.lu, one
  request every 3 seconds, the pace Docket uses for every Esch host. Every redirect is checked
  against the same allowlist, and a response over 2 MiB is refused.
- **Links and matters:** a proposal is kept only if its link stays on
  https://participation.esch.lu; the matter comes from the page URL asked for, never from the
  page's own markup. A bad tile or page is skipped and listed on stderr, and `ingest` then
  exits 1 (library still written).
- **Seed:** `seed/esch.json` is built from the recorded fixtures in `tests/fixtures/`
  (a Docket snapshot built from Docket's recorded Esch pages, and the recorded Budget
  participatif 2026 page). It holds 14 arguments: 6 council positions on point 6.1 of
  2 October 2026 (3 yes, 3 no) and 8 resident proposals. A test rebuilds it and fails on drift.

Arguments follow `spec/schemas/argument.schema.json`, which gained three optional fields for
this: `kind` (`argument`, `position`, `proposal`), `attribution` and `source_url`.

```
d2-commons ingest --out library.json --docket docket.json --fetch        # live, 1 request per 3 s
d2-commons ingest --out library.json --docket docket.json --page URL=FILE  # recorded pages
d2-commons arguments --library library.json lu.esch.42063 --stance no
d2-commons serve --library library.json --port 8091
```

## HTTP API (`d2-commons serve`)

| Route | Answer |
|---|---|
| `GET /matters/{docket item id}/arguments[?stance=]` | `{matter_id, stance, ranker, arguments[]}`; an empty list when Commons has nothing yet |
| `GET /healthz` | `{ok, arguments, matters}` |

No argument has ratings yet, so `ranker` is `null` and the list is in ingestion order. The
Companion reads this API over HTTP (`COMMONS_URL`).

## Licence

AGPL-3.0-or-later.
