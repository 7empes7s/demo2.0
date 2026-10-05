# Changelog

## 0.1.0 (2026-10-05)

- Bridging ranker `bridging-mf`: matrix factorisation in the style of Community Notes. An
  argument's score is its intercept, so support from one camp alone does not lift it.
- `RankerVersion` metadata with a `code_hash` of the ranker source.
- `top_arguments`, a stance-aware listing helper.
- CLI: `python -m d2_commons.rank ratings.json`.
