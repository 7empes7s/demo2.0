# Changelog

## Unreleased

- `POST /api/factcheck` proxies a claim (and optionally its file) to the Provenance service (`PROVENANCE_URL`, default `http://127.0.0.1:8090`) and returns its grade only after it passes `spec/schemas/grade.schema.json`. Unreachable or failing: 503; invalid answer: 502; no record: `{result: "no_record"}`; claims over 500 characters or bodies over 4 KiB: 413. Works without a model key. Exports `gradeClaim`, `gradeProblems`, `isGrade` and the `Grade` types.

- The server sends `Cache-Control: no-cache` for HTML pages, `sw.js` and `manifest.webmanifest`, so an installed citizen app picks up new versions.
- `readSnapshot` reads Docket snapshot/1 and /2 into the /2 shape (a `sources` list) and refuses other schemas; the server uses it at start-up.
- Item types cover Esch council points (`reference`, `theme`, `votes`) and consultations (`summary`, `opens`, `closes`, `phases`, no number). Source 1 names the right body and lists these facts.
- Prompts `companion-prompts/2`: the explain and arguments prompts name the kind of file from the item (a Chamber bill or file, an Esch council agenda point, or an Esch consultation) instead of calling every file parliamentary.
- `readSnapshot` labels a converted /1 snapshot as `d2.docket.snapshot/2`, the shape it now has.

## 0.1.0

- explain, extractArguments, challenge and checkClaim with quote verification.
- Anthropic provider; zero-dependency Node server with caching and rate limiting.
