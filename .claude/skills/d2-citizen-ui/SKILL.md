---
name: d2-citizen-ui
description: Use when adding or changing a screen, component or string in the citizen app (apps/citizen), so it ships in five languages, with VOCABULARY.md words, Affichage tokens, neutrality and the privacy trace intact.
---

# Citizen app screen or string

Map: `docs/ARCHITECTURE.md` section 3. App README: `apps/citizen/README.md`.

## Where things go

| What | Where |
|---|---|
| Screen / component | `apps/citizen/src/components/<Name>.svelte` (Svelte 5 runes) |
| State, clients, helpers | `apps/citizen/src/lib/*.ts` (`*.svelte.ts` when it holds runes) |
| Strings | `apps/citizen/src/lib/i18n.ts`: blocks `en` (reference), `fr`, `de`, `lb`, `pt`; `translate(lang, key, vars)` |
| Words | `apps/citizen/VOCABULARY.md` (use column; add a row for every new user-facing concept) |
| Colour, material, motion | `apps/citizen/src/tokens.css` only. Rules of the look: `docs/design/README.md` |
| Tests | `apps/citizen/test/*.test.ts` (vitest, `// @vitest-environment jsdom`, stubbed `fetch`) |

## Rules (QA checks every one)

1. **Five languages.** Every new key exists in `en`, `fr`, `de`, `lb` and `pt` with the same `{placeholders}`.
   The `Dict` type makes a missing key a typecheck error; an empty or English copy is still wrong.
   Insert the key **next to a related key in each block, in the same place in all five**, not at the
   end of the block (end-of-block appends are where parallel PRs conflict).
2. **Vocabulary.** Use the words in `VOCABULARY.md` ("resident", "file", "where you stand", "support",
   "reach", "quote found"...). Never the "Not" column. New concept: add a row in the same PR.
3. **Neutrality.** The app never tells anyone how to vote or what to think. No ranking by importance,
   no "recommended", no persuasion copy. Model text is labelled as the Companion's and cites sources.
4. **No raw ids** (item ids, hashes, codes, pseudonyms) in visible text, except under "Technical details".
5. **Privacy.** Where a resident lives, their topics, stance and answers stay in `localStorage`
   (`src/lib/prefs.ts`). No request, URL, query or header may carry them. Requests go only to the
   Companion server (`/api/*`, `/data/*`). No new third-party requests (fonts, analytics, CDNs, images).
   `apps/citizen/test/pulse.test.ts` mounts the app under different choices and requires identical
   request traces: it must stay green and unchanged in intent. A new screen that makes requests
   should be opened in that trace.
6. **Affichage.** Colours and materials only from `tokens.css` variables (`--ink`, `--paper`,
   `--rule`, `--backing`, `--pressed-bg`...). No hex in components, no `border-radius`, no blurred
   `box-shadow`. Motion only under `prefers-reduced-motion: no-preference` (the end of `tokens.css`);
   reduced motion means none.
7. **Accessible.** Every control has a label (visible or `aria-label` from `i18n.ts`), works by
   keyboard (Tab, Enter/Space, visible focus) and is a real `<button>`/`<a>`/`<input>`.

## Commands

```sh
npm run typecheck -w @democracy2/citizen     # svelte-check --fail-on-warnings
npm run test -w @democracy2/citizen          # vitest
npx vitest run test/pulse.test.ts            # from apps/citizen: the privacy trace alone
tools/check.sh                               # before pushing
```

## Preview (served build, port 5865)

```sh
R=$PWD   # repo root; npm -w runs in the workspace folder, so paths must be absolute
npm run build -w @democracy2/citizen -w @democracy2/portal
DESK_DB=/tmp/d2-preview.db PORT=5866 DESK_BOOTSTRAP_PASSWORD=preview-password-long \
  DESK_SEED=$R/modules/desk/seed/esch.json npm run serve -w @democracy2/desk &
SNAPSHOT=$R/modules/pulse/test/fixtures/docket-recorded.json PORT=5865 \
  STATIC_DIR=$R/apps/citizen/dist PORTAL_DIR=$R/apps/portal/dist DESK_URL=http://127.0.0.1:5866 \
  npm run serve -w @democracy2/companion &
curl -s 127.0.0.1:5865/healthz               # {"ok":true,...,"desk":true}
```

Citizen app at `http://127.0.0.1:5865/`, portal at `/portal/` (admin / the bootstrap password).
No model is configured, so explain/challenge answer 503 and the app says so. The fixture is from
early October 2026, so "This week" can be empty: check the full list (`#files`) and a file page.
Stop both servers by pid or port when done (never `pkill -f`).

Check at **375, 390 and 1440 px, day and night** (Settings, or `prefers-color-scheme`), in at least
`en` and one long language (`de` or `pt`):

- no sideways scroll (`document.documentElement.scrollWidth <= innerWidth`), nothing cut off;
- 1440 px is a real desktop layout, not a stretched phone;
- keyboard only: every control reachable and labelled;
- emulate `prefers-reduced-motion: reduce`: nothing moves;
- no console errors; the network tab shows only same-origin requests.

## Done when

- [ ] Strings in five languages, VOCABULARY rows for new words, no raw ids
- [ ] Tests for the new behaviour; `pulse.test.ts` green
- [ ] Preview checked at 375/390/1440, day and night, keyboard, reduced motion
- [ ] `apps/citizen/CHANGELOG.md` line; then `d2-pr-checklist`
