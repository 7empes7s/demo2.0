# Desk

The commune's desk: where residents file feedback, post ideas, vote on the questions the commune puts to them and follow official procedures to the end, and where the commune's staff answer. One service, one SQLite file, an append-only hash-chained log that the audit portal replays.

Desk is the pilot shape of three architecture modules in one: Agora (ideas), Delivered (did it happen?) and a slice of Workbench (the operator's desk). It exists so a commune such as Esch-sur-Alzette can run the whole loop today, with the trust core (Door credentials, Booth secret ballots, Record) replacing its stand-ins one at a time.

| For | What they can do |
|---|---|
| A resident (end-user portal, in the citizen app) | Read every procedure and its updates; say whether a finished one was **done**, **needs work** or **not done**; post an idea and support others' (one support per resident); send feedback about anything and look it up later with its code; cast and change a ballot while a vote is open; read the published tally |
| An operator | Keep procedures current (stages, dates, status, dated updates); read the feedback inbox, sort it, answer privately or publish the answer on the procedure or idea it is about; decide on ideas (taken up as a procedure, answered, declined, merged); create votes, open, close and publish them; ask the model to sort a message, draft an answer or translate an update, then edit what it wrote |
| An admin | Staff accounts and roles; residents' requests for a code by post (check each against the residents' register, print addressed letters, or decline); batches of one-time enrolment codes for residents; the commune's name, languages and intro; the model endpoint (any OpenAI-compatible address, model name, key) with a test button |
| An auditor | The whole event log with its hash chain and a verify button; every vote's ballots (numbered voters, never identities) with a recount against the published tally; every model call Desk made (purpose, model, prompt hash, sizes, timing, outcome, never text) |

## What is honest about it

- **Identity is a pilot stand-in.** A resident is an enrolment code the commune handed out once (at a counter, by letter, or by post on request), turned into a token the browser keeps. Desk stores hashes only, never a name, and cannot tell two residents apart beyond the code's batch. One code, one resident, so one support per idea and one voice per vote, as far as the code distribution is honest. Secure sign-in (Door) replaces this later without changing the API.
- **Votes are open ballots, not secret ones.** A ballot is stored under the resident's id. Staff never see ids next to ballots (the auditor sees voter numbers), but the database holds the link. Re-voting is allowed while the vote is open and the last ballot counts; every earlier ballot stays on record. Live counts are not shown while a vote is open. Binding, secret, receipt-free ballots are Booth's job; Desk votes are consultations.
- **The log is append only and hash chained.** Every write goes with one event in the same transaction; the chain is replayed by `GET /audit/verify`. It is Desk's own log on Desk's own disk: it proves nothing was changed *through Desk*, not that the operator of the box did not rewrite the file. Publishing checkpoints to Record is the next step.
- **A model never speaks to a resident.** It sorts, drafts and translates for staff; every output is labelled as the model's and edited by a person. Resident text enters prompts as quoted data. Every call is logged without its text.

- **A code by post forgets the address.** A resident without a code asks for one with a name and an address. The request waits with them until an admin prints the letter or declines it; either deletes the name and address. The log records that a request came in and how it ended, never who asked. What stays is a keyed hash of the name and address with no date and no row order, so a second request shows "a letter already went to this name and address". The admin who prints sees a name next to a code, as at a counter; Desk never stores the two together, and every code printed in a month shares the batch "by post YYYY-MM".

## Run

```
DESK_DB=desk.db DESK_BOOTSTRAP_PASSWORD='choose-a-long-one' DESK_SEED=seed/esch.json npm run serve -w @democracy2/desk
```

Settings: `DESK_DB` (default `desk.db`), `PORT` (8094), `HOST` (127.0.0.1), `TRUST_PROXY` (1: the Companion forwards to it), `DESK_BOOTSTRAP_PASSWORD` and `DESK_BOOTSTRAP_LOGIN` (create the first admin when no staff exists), `DESK_SEED` (loaded once into an empty store), `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_TIMEOUT_MS` (the model, unless an admin set one in the portal).

The shipped seed (`seed/esch.json`) is made-up data in the shape of Esch-sur-Alzette's procedures, marked as examples in every text. The citizen app, the portals and the Companion server (`/api/desk/*`) talk to it; the browser never reaches Desk directly.

## API

All JSON. Staff send `Authorization: Staff <token>` (from `POST /staff/login`), residents `Authorization: Resident <token>` (from `POST /enrol`). Writes are limited to 30 per client per minute, reads to 240, sign-in tries to 10. Bodies over 64 KiB are refused. Every error is `{error}` with a plain sentence.

| Route | Who | What |
|---|---|---|
| `GET /healthz` | anyone | counts, the model's name, the log head |
| `GET /settings/public` | anyone | commune name, languages, intro, whether a model is set |
| `POST /enrol {code}` | anyone | one-time code -> `{token, resident_id}` |
| `POST /enrol-requests {name, street, extra?, postcode}` | anyone | asks for a code by post -> `{received, already}`; a postcode is four digits (`L-4002` is fine); five per client per minute; 503 past 5000 waiting |
| `GET /enrol-requests` | admin | the waiting requests, each with `sent_before` and `duplicate` |
| `POST /enrol-requests/print {ids}` | admin | one code per request in the month's "by post" batch -> `{letters: [{name, street, extra, postcode, code}]}`, shuffled, shown once; the requests are deleted |
| `POST /enrol-requests/:id/decline` | admin | deletes the request; no letter |
| `GET /me` | resident | `{enrolled, since}` |
| `GET /procedures?status=&kind=`, `GET /procedures/:id` | anyone | procedures with updates, verdict counts, published answers, linked ideas; `my_verdict` for a resident |
| `POST /procedures/:id/verdict {verdict}` | resident | done, needs_work, not_done; only on a finished, stalled or cancelled procedure; the last one counts |
| `POST /procedures`, `PATCH /procedures/:id`, `POST /procedures/:id/updates {text, status?}` | operator, admin | kind, status, title/body per language, owner, stages, links, dates; a dated update may change the status |
| `GET /ideas?status=`, `GET /ideas/:id` | anyone | by supporters, then newest; `supported` and `mine` for a resident |
| `POST /ideas {lang, title, text}` | resident | one per resident per hour |
| `POST` / `DELETE /ideas/:id/support` | resident | one per resident, never your own, only while open or taken up |
| `POST /ideas/:id/decision {status, answer, procedure_id?}` | operator, admin | taken_up needs the procedure; every status but open needs an answer |
| `POST /feedback {lang, text, category?, about?: {kind, id}}` | anyone | -> `{code}`; an enrolled resident's token marks it as enrolled |
| `GET /feedback/by-code/:code` | anyone with the code | the message, its status and the answer |
| `GET /feedback?status=&about_kind=&about_id=`, `GET /feedback/:id`, `PATCH /feedback/:id {status, category, summary}`, `POST /feedback/:id/answer {answer, publish}` | operator, admin | the inbox; publishing is possible only for a message about a procedure or an idea, and shows on it |
| `POST /feedback/:id/triage`, `POST /feedback/:id/draft {context?}`, `POST /ai/translate {text, from, to[]}` | operator, admin | model suggestions, labelled; 503 without a model, 502 when it fails or answers nonsense |
| `GET /rounds?status=`, `GET /rounds/:id` | anyone | drafts hidden; result only once published; `ballots_so_far` while open; `my_ballot` for a resident |
| `POST /rounds/:id/ballots {option}` | resident | while open; again to change |
| `POST /rounds`, `PATCH /rounds/:id`, `POST /rounds/:id/open|close|publish` | operator, admin | wording and options freeze at open; closing tallies and stores the ballots' hash; open votes close on their own at `closes_at` |
| `GET /rounds/:id/ballots` | auditor, admin | every ballot by voter number, a recount, the published tally |
| `POST /staff/login`, `POST /staff/logout`, `GET /staff/me` | staff | sessions last 14 days; disabling an account or changing its password ends them |
| `GET /staff`, `POST /staff`, `PATCH /staff/:id` | admin | the last admin cannot be demoted or disabled |
| `POST /enrol-codes {batch, count}` | admin | up to 5000 codes, shown once |
| `GET /enrol-codes` | admin, auditor | batches with issued and used counts |
| `GET /settings`, `PATCH /settings` | admin | commune, languages, intro, model (`ai.base_url`, `ai.model`, `ai.api_key`, `ai.timeout_ms`); the key is never returned |
| `POST /ai/test` | admin | one tiny call to the model |
| `GET /audit/verify`, `GET /audit/events?from=&kind=&subject=&limit=`, `GET /audit/summary`, `GET /audit/ai-calls` | auditor, admin | the chain, the entries, counts, the model calls |

Licence: AGPL-3.0-or-later (see LICENSE).
