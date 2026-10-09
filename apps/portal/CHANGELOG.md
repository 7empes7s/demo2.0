# Changelog

## Unreleased

- Enrolment codes opens on "Asked by post": the residents' waiting requests (name, address, date), each ticked for printing unless a letter already went to that name and address or it was asked twice. "Print letters (n)" makes the codes and shows the letters once; each carries its address where a left-window envelope (C5/6 or DL) shows it, 20 mm from the left and about 47 mm from the top, beside the commune and the code, then the six languages, one A4 page per letter. "Decline" removes a request without a letter.

- First version of the staff portals, one app for three roles over the Desk service:
  - Sign-in with login and password; the top bar shows the commune's name, the person's name and role, the language (French or English), light or dark, and sign out. Sections are shown by role; an auditor never sees the inbox, an operator never sees staff or the log, an admin sees everything.
  - Operator: the inbox by status with a sort suggestion and a draft answer from the model (both labelled and editable), status, category and summary, answers sent privately or published on the procedure or idea; ideas by status with the commune's decision and the procedure that follows a taken-up idea (pick one or create it from the idea); procedures with title and body per language, kind, status, owner, dates, stages, links, dated updates with an optional status change, and a translate button that fills the missing languages as a labelled model draft; votes with a question, detail, options and a closing time, open, close and publish, residents voted so far while open and the tally once closed.
  - Admin: staff accounts (create, role, disable or enable, reset password), enrolment code batches shown once with copy and download, and settings (commune, languages, intro per language, the model's address, name, write-only key, timeout and a test button).
  - Audit: the event log paged by entry with kind and subject filters, payloads folded away, hash prefixes and "Verify the chain"; every vote's ballots by voter number with the recount beside the published tally and a match or mismatch flag; the model calls; the summary.
  - Affichage look from the citizen app's tokens, phone first with a desktop layout (left nav, wide work area); 25 tests in jsdom with a fake desk.
