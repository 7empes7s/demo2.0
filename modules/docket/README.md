# Docket

Official Luxembourg sources, normalized: what is on the Chamber of Deputies' agenda, each dossier's status, history and documents, and the text of its key documents; what the Esch-sur-Alzette municipal council is deciding, with each councillor's vote; and what Esch is consulting its residents on.

```
uv run d2-docket snapshot --out data/docket.json                 # both sources
uv run d2-docket snapshot --out data/lu-chd.json --sources chd   # one source
```

## Sources

| `--sources` | Site | What is read | Item ids |
|---|---|---|---|
| `chd` | www.chd.lu | Agenda page, dossier pages, documents on wdocs-pub.chd.lu | `lu.chd.<dossier>` |
| `esch` | administration.esch.lu | List of council sessions (`/seances-publiques-conseil-communal/?y=YYYY`) and each session page | |
| | workflow.esch.lu | The council workflow's read-only JSON API, which the session pages are built from: sessions of a year, agenda points of a session, each councillor's vote on a point | `lu.esch.<agenda point>` |
| | participation.esch.lu | Home page (active and past projects and surveys) and each survey or project page (dates, phases, attachments) | `lu.esch.participation.<project\|survey>.<id>` |

- **Esch sessions:** every session from today on, plus the most recent one before today (`--esch-past-sessions N` for more). An upcoming session's points appear when the city publishes its agenda, about a week before. Votes are asked for only for points whose session page shows a vote chart. workflow.esch.lu has refused connections after about 30 vote requests in a row at 1 request per second; after the first failed votes request the run stops asking, leaves `votes` null and lists the skipped points in `errors`.
- **participation.esch.lu** runs on Hoplr. Its public pages are server-rendered HTML, so no API is needed. News posts, events and the project submission forms are not read.
- Esch items have the same shape as Chamber items, plus `reference`, `theme` and `votes` (council points) or `summary`, `when`, `opens`, `closes` and `phases` (participation). A field the source does not give stays `null`; nothing is guessed.

## Rules

- Pages are fetched politely (1 request per second, identified user agent) and only paths `robots.txt` allows (chd.lu, esch.lu and administration.esch.lu allow all; workflow.esch.lu and participation.esch.lu have no robots.txt).
- **Output:** one JSON snapshot (`d2.docket.snapshot/2`) with `sources`, `meetings`, `items` and `errors`. Every fetched document keeps its URL, fetch time and SHA-256, so any sentence built on it can cite it. Esch documents are listed by URL and not fetched yet.
- One source failing does not stop the others; the failure is listed in `errors`.
- **Parsers** are pure functions tested against recorded pages in `tests/fixtures/` (`esch-*` for Esch). When a site changes, record new fixtures and fix the parser in the same PR.

Licence: Apache-2.0. Data from chd.lu belongs to the Chamber of Deputies; data from esch.lu belongs to the Ville d'Esch-sur-Alzette.
