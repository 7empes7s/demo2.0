# Changelog

## 0.2.0 (2026-10-06)

- Esch-sur-Alzette seed: council groups' recorded votes (from a Docket snapshot) become
  `position` arguments, and resident proposals on participation.esch.lu project pages become
  `proposal` arguments. Every argument carries its public link; no person is named, and
  contact details in residents' text are removed.
- `seed/esch.json`: 14 arguments built from recorded fixtures, checked against the spec schema
  and rebuilt by a test.
- Read API: `GET /matters/{id}/arguments[?stance=]` and `GET /healthz`.
- CLI `d2-commons`: `ingest` (recorded pages, or live at 1 request per 3 s), `arguments`, `serve`.

## 0.1.0 (2026-10-05)

- Bridging ranker `bridging-mf`: matrix factorisation in the style of Community Notes. An
  argument's score is its predicted rating for a rater midway between the two camps that rated
  it, so support from one camp alone does not lift it and a camp brigade cannot move the
  midpoint.
- One rating per (argument, rater), last wins; `min_ratings` counts distinct raters; raters
  with fewer than `min_rater_ratings` ratings are left out.
- Fixed per-entity penalties and fixed `mu`: ratings on unrelated arguments do not move scores.
- `RankerVersion` metadata with a `code_hash` of the ranker source.
- `top_arguments`, a stance-aware listing helper.
- CLI: `python -m d2_commons.rank ratings.json`.
