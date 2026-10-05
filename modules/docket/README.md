# Docket

Official Luxembourg sources, normalized: what is on the Chamber of Deputies' agenda, each dossier's status, history and documents, and the text of its key documents.

```
uv run d2-docket snapshot --out data/lu-chd.json
```

- **Source:** www.chd.lu (agenda and dossier pages, documents on wdocs-pub.chd.lu). Pages are fetched politely (1 request per second, identified user agent) and only paths `robots.txt` allows.
- **Output:** one JSON snapshot (`d2.docket.snapshot/1`), a denormalized view built for the citizen app. It is not a list of `spec/` SourceItem records; those are derived from it when Docket gets its API. Every document keeps its URL, fetch time and SHA-256, so any sentence built on it can cite it.
- **Parsers** are pure functions tested against recorded pages in `tests/fixtures/`. When the site changes, record new fixtures and fix the parser in the same PR.

Licence: Apache-2.0. Data from chd.lu belongs to the Chamber of Deputies.
