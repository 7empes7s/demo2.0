# Changelog

## Unreleased

- Reads Docket snapshot/1 and /2. With Esch-sur-Alzette in the snapshot: each file names its place (Chamber or Esch-sur-Alzette), a place filter appears, council points show their reference, theme, last meeting and the council's vote (totals, per party, per councillor), and consultations show their summary, dates and phases. The stage track stays for Chamber files only.
- Esch files open at `#esch.<id>`; Chamber files keep `#<number>`.

## 0.1.0

- First version of the citizen app:
  - The Chamber agenda list and the file view, with a stage track, the next meeting, documents and history.
  - Explain, where every sentence cites its source and the quote is checked.
  - Stance and devil's advocate.
  - Claim check.
- Five interface languages: lb, fr, de, en and pt. Dark-first, with a full light mode. Phone and desktop layouts.
- Builds:
  - A served build, using the Companion server.
  - A single-file build, using the in-page Companion with the claude.ai `sample` capability.
