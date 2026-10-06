# Changelog

## 0.1.0 (unreleased)

- Pulse v1: `buildWeek` sorts the public file list into this week's sections (concerned,
  knowledgeable, judge, others) on the device, from where the resident lives, the topics they
  follow and Arena's local "understood" mark. Pure and deterministic.
- ISO week window on the Luxembourg calendar (`weekAt`, `isoWeek`, `dayOf`); files without any
  date are kept and listed last.
- Place containment over Charter's jurisdiction tree; `lu-esch` (Docket) mapped to
  `lu-commune-esch-sur-alzette` (Charter).
- `@democracy2/pulse/charter` (Node): Charter version, `vote_budget.matters_per_week` and places,
  for build-time inlining.

### Deferred

- The judge section (Lottery inbox): needs panels and a way for a drawn resident to receive them
  without the server learning who they are.
- Enforcing the weekly vote budget and defaulting the rest to delegates: needs Booth.
- Charter topic ids on Docket items (topics are the published theme and committee for now).
- Docket emitting Charter jurisdiction ids, so `DOCKET_ALIASES` can go.
- All communes in Charter's data (only Luxembourg City and Esch-sur-Alzette; others pick a canton).
