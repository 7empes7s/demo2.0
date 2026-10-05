# Changelog

## 0.2.0

- Esch-sur-Alzette source (`esch`): council sessions, agenda points with status, documents and each councillor's vote (administration.esch.lu and the workflow.esch.lu API), plus projects and surveys from participation.esch.lu.
- `snapshot --sources chd,esch` (default: both) and `--esch-past-sessions`.
- Snapshot schema `d2.docket.snapshot/2`: `source` becomes the list `sources`; every meeting and error names its source. One failing source no longer stops the others.

## 0.1.0

- Chamber of Deputies source: agenda and dossier parsers, document text extraction, snapshot CLI.
