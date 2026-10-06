# Changelog

## Unreleased

- "Argue the other side" lists the arguments each answer rests on, each with who made it and a link to its public source. A point the Companion wrote itself is marked as such in all five languages.
- Install and offline support in the served build: a web app manifest ("Civic Companion", navy and amber, standalone) with 192, 512 and maskable icons, and a service worker. The worker caches the app on install, fetches the snapshot from the network first and falls back to the saved copy, so the list opens offline. It never touches `/api/*`. Each build gets its own cache version and old versions are removed. A notice in all five languages says when you are offline. The single-file build has no worker and no manifest. The worker also uses the saved copy when the server answers 5xx or is slower than 4 seconds, only ever saves the app page itself as the offline app, never saves error or partial responses, and caches other built files on first use.
- Reads Docket snapshot/1 and /2. With Esch-sur-Alzette in the snapshot: each file names its place (Chamber or Esch-sur-Alzette), a place filter appears, council points show their reference, theme, last meeting and the council's vote (totals, per party, per councillor), and consultations show their summary, dates and phases. The stage track stays for Chamber files only.
- The place filter is a segmented control (All, Chamber, Esch-sur-Alzette) shown when the snapshot has 2 or more places. With every place shown, the list is grouped by place, Chamber first, so one council session's points don't bury the Chamber's files.
- A missing council vote reads "No vote recorded" in every language; consultations show their timing note; Luxembourgish dates read "2. Oktober 2026" instead of the browser's "2026 M10 2".
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
