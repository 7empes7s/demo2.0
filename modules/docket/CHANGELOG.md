# Changelog

## 0.2.0

- Esch-sur-Alzette source (`esch`): council sessions, agenda points with status, documents and each councillor's vote (administration.esch.lu and the workflow.esch.lu API), plus projects and surveys from participation.esch.lu.
- `snapshot --sources chd,esch` (default: both) and `--esch-past-sessions`.
- Snapshot schema `d2.docket.snapshot/2`: `source` becomes the list `sources`; every meeting and error names its source. One failing source no longer stops the others.
- Failures are isolated per site and per request: an HTML error page, an impossible date or a down site in one source never stops the snapshot. The council (administration.esch.lu, workflow.esch.lu) and participation.esch.lu fail separately; the sessions list page and the previous year's sessions are optional. A 4xx for one vote costs only that point its votes; vote requests stop after a connection failure, a 429/5xx or 3 failures. Unknown `--sources` names are rejected before any fetch, and `--esch-past-sessions` must be 0 or more.
- Closed-session (huis clos) points are left out of meetings as well as items. A missing vote or party is counted under `""`, never `"null"`.

## 0.1.0

- Chamber of Deputies source: agenda and dossier parsers, document text extraction, snapshot CLI.
