# Changelog

## 0.1.0 (unreleased)

- A code by post: anyone asks with a name and an address (`POST /enrol-requests`), an admin lists the waiting requests and prints them (one code each in the month's "by post" batch, letters shuffled and shown once) or declines one. Printing or declining deletes the name and address; the log keeps `enrol.letter_requested`, `enrol.letters_printed` and `enrol.letter_declined` without either; a keyed hash with no date flags a repeat request. The audit summary counts `letters_waiting`.

- First version: procedures with dated updates and residents' verdicts, ideas with one support per resident, feedback with a lookup code and published answers, votes (draft, open, closed, published; re-votes; auditor recount), staff with three roles, one-time enrolment codes for residents, a hash-chained append-only event log with verification, and model help for staff (sort, draft, translate) through any OpenAI-compatible endpoint, every call logged without its text. SQLite through `node:sqlite`, no framework. An example seed for Esch-sur-Alzette.
