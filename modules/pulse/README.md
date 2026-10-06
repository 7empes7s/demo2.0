# Pulse (`@democracy2/pulse`)

The resident's weekly list, built **on the device**. This is Pulse v1 (see
`docs/architecture/01-modules.md`, module 12). AGPL-3.0, published so anyone can check that the
routing is neutral.

A TypeScript library of pure functions: no clock read, no storage, no network. The citizen app
runs it in the browser over the Docket snapshot every device downloads, so the server never
learns where a resident lives, which topics they follow or which files they understood.

## What it does

`buildWeek({ items, places, prefs, week, understood, budget })` returns this week's files in
sections. Each file appears in one section only, in this order of precedence:

| Section | Rule |
|---|---|
| `concerned` | The file's place is where the resident lives or a place containing it (Esch-sur-Alzette resident: Esch council points, and Chamber files, since `lu` contains the commune). A canton resident is not concerned by a commune inside the canton. |
| `knowledgeable` | Not concerned, but on a topic the resident follows. Entries carry `understood` (Arena's local mark). |
| `judge` | Files a Lottery panel the resident sits on reviews. Always empty in v1: there are no panels yet. The app shows the heading with "Panels have not started yet" rather than hiding it. |
| `others` | Everything else that happens this week, so routing never hides a file. |

Also: `outside` (files with dates, none in this week; not listed) and `budget` (Charter
`vote_budget.matters_per_week`, shown only; no voting or delegation exists yet, so nothing is
enforced).

- **Places** come from Charter (`charter/data/lu-jurisdictions.json`) and are walked up through
  `parent_id`. Docket's Esch id `lu-esch` is mapped to Charter's `lu-commune-esch-sur-alzette`
  (`DOCKET_ALIASES`); any other id Charter does not know never counts as concerned.
- **Topics** are what the public list publishes: the Esch council's `theme` and the Chamber's
  `committee`, spelt exactly as published (French). There are no Charter topic ids on Docket
  items yet.
- **Week window**: the ISO 8601 week (Monday to Sunday) containing the Luxembourg calendar date
  of "now" (`Europe/Luxembourg`; `weekAt(now)`, `isoWeek(date)`). A file is in the week if one of
  its dates falls in it: agenda meeting, filing (`deposited`), history entry or `updated`, or a
  consultation's opening or closing (a consultation open across the whole week counts from
  Monday). Timestamps with an offset are read on the Luxembourg calendar.
- **Files without any date** are kept (`when: null`) and sorted last: the list cannot say they
  are outside the week.
- **Order** (deterministic, locale-free): first day in the week, then why (meeting, consultation,
  filed, update), then id by code point; undated files last by id. Input order, duplicates and
  the order of places never change the result.

`@democracy2/pulse/charter` (Node only) reads Charter once at build time: version, weekly budget
and places. The app inlines that (`__PULSE_CHARTER__` in `vite.config.ts`), so every device gets
the same data and the browser needs no Charter request.

## Privacy ("done when")

The architecture's acceptance test: a network trace of the client shows no request that
depends on the resident's interests. `apps/citizen/test/pulse.test.ts` mounts the whole app
under four different sets of choices, changes every choice through the screen, records every
`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon`, and asserts the traces
are identical and carry no place, topic or file id. A planted request that depends on the
choices fails it.

The architecture's server side (`GET /matters/active?jurisdiction=`) is not used: asking per
jurisdiction would tell the server where the resident lives. v1 downloads the whole snapshot.

## Tests

`npm test -w @democracy2/pulse`: week edges (both ends, DST change, ISO years with 53 weeks),
containment, the alias, loops in place data, grouping, ordering, undated files, determinism.
The recorded snapshot in `test/fixtures/` is a copy of Arena's (real chd.lu and esch.lu records).
