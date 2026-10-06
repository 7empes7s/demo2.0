# Staff portals (operator, admin, audit)

The commune's desk as its staff see it. One Svelte app, three portals chosen by role after sign-in, talking to the Desk service (`modules/desk`) through the Companion server at `/api/desk/*` on the same origin.

| Role | Sections |
|---|---|
| operator | Inbox (feedback: sort, summarise, answer privately or publish on the procedure or idea it is about), Ideas (decide: taken up, answered, declined, merged), Procedures (create and edit, stages, links, dated updates), Votes (write a question, open, close, publish) |
| admin | everything an operator and an auditor see, plus Staff (accounts, roles, on or off, passwords), Enrolment codes (batches, shown once), Settings (commune, languages, intro, the model with a test button) |
| auditor | Event log (every entry with its hash prefix, filters, a "Verify the chain" button), Votes (ballots by voter number and a recount beside the published tally), Model calls, Summary |

The model only ever suggests: a sort for a message, a draft answer, a translation. Every output is labelled "Suggested by the model, edit before sending" and sits in an editable field; nothing it writes reaches a resident without a person sending it.

## Run it

```sh
npm install                                   # from the repo root
npm run dev -w @democracy2/portal             # Vite on :5173/portal/, proxies /api to the Companion on :8787
DESK_BOOTSTRAP_PASSWORD='choose-a-long-one' DESK_SEED=seed/esch.json npm run serve -w @democracy2/desk   # Desk on :8094
DESK_URL=http://127.0.0.1:8094 npm run serve -w @democracy2/companion                                      # the Companion forwards /api/desk/*
```

Sign in with the bootstrap admin (`admin` and the password above), then add operators and auditors under Staff.

`npm run build` writes `dist/`, which the Companion serves under `/portal/` (`PORTAL_DIR=apps/portal/dist`). The Vite `base` is `/portal/` and every API call is an absolute `/api/desk/...` path, so the build works wherever the Companion serves it.

## How it is built

- Svelte 5, Vite, TypeScript. `npm run typecheck` (svelte-check, warnings fail), `npm run test` (vitest in jsdom with a fake desk behind `fetch`), `npm run build`.
- `src/tokens.css` is the citizen app's, copied unchanged: the Affichage material (paper, ink, amber, navy, red; no radius, no blurred shadow; Big Shoulders Display titles, Public Sans body, JetBrains Mono data; light and dark). `src/portal.css` adds the portal's own pieces on top: forms, tables, notices, the model sheet and the list-and-work split.
- Phone first (one pane at a time, filters as chips, tables scroll sideways rather than wrap), and a real desktop layout from 960 px: a left nav of the sections the role opens and a wide work area, with the list on the left and the open item on the right. Labels never share a row with wrapping values.
- `src/lib/i18n.ts` holds every string in French and English (staff languages); keys are typed from the English dictionary. Residents' texts are shown in the reader's language when the commune wrote one, else French, then the first language that has it.
- The session token lives in `sessionStorage` (for the tab, guarded against blocked storage) and is sent as `Authorization: Staff <token>`. Any 401 returns to sign-in; a 429 reads "too many requests, wait a minute"; every other failure shows the desk's own `{error}` sentence.
- Hash routing (`#inbox`, `#procedures/<id>`, `#audit-votes/<id>`…). Raw ids appear only in the hash and under "Technical details".

Licence: see LICENSE.
