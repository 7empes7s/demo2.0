# Desk: feedback, ideas, votes and procedures for one commune (engineering spec, 2026-10-06)

Pilot target: Esch-sur-Alzette. Desk is the pilot shape of three architecture modules in one process (Agora for ideas, Delivered for "did it happen?", a slice of Workbench for the operator's desk; see `docs/architecture/01-modules.md`). It exists so a commune can run the whole loop today, with the trust core (Door, Booth, Record) replacing its stand-ins one at a time without changing the resident-facing API.

## 1. Architecture

```
browser (citizen app, /)  ──┐
browser (portals, /portal/) ─┼──> civic-companion :8787 ──/api/desk/*──> civic-desk :8094 ──> /var/lib/civic-desk/desk.db
                             │          │                                      │
                             │          ├─ /api/factcheck ─> provenance :8090  └─ LLM_BASE_URL (chat/completions)
                             │          ├─ /api/ideas ─────> agora :8091 (fallback when Desk is down)
                             │          └─ /api/explain… ──> LLM_BASE_URL
```

- One public origin. The Companion serves both built apps and forwards `/api/desk/*` unchanged (method, body, `Authorization`, the client address in `X-Forwarded-For`). Desk listens on loopback only.
- One Node 22 process, `node:sqlite`, no framework, no ORM. Every write runs in `BEGIN IMMEDIATE … COMMIT` together with its event.
- The model is any OpenAI-compatible `chat/completions` endpoint (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`), the same names the Companion reads; an admin can set another one in the portal (stored in `settings`, the key never read back). No vendor SDK.
- Identity: enrolment codes (pilot stand-in for Door) for residents; login + password + bearer sessions (14 days) for staff. Tokens are random 32 bytes; only their sha256 is stored. No cookies, so no CSRF surface.

## 2. Schema (SQLite, `modules/desk/src/db.ts`)

| Table | Keys and rules |
|---|---|
| `events` | `seq` autoincrement, `at`, `kind`, `actor` (`staff:<id>`, `resident:<id>`, `system`, `system:seed`), `subject` (`procedure:<id>` …), `payload` (canonical JSON), `prev_hash`, `hash = sha256(prev_hash ‖ canonical(at, kind, actor, subject, payload))`. Triggers raise on UPDATE and DELETE. |
| `ballots` | one row per cast, `seq` per (round, resident); the last one counts. Triggers raise on UPDATE and DELETE. |
| `procedures`, `procedure_updates`, `verdicts` | localized `title`/`body` JSON (`{lb, fr, de, en, pt}`), `stages` JSON `[{name, planned_on?, done_on?}]`, `links` JSON, optional `docket_item_id` to a Docket file; a verdict is `done | needs_work | not_done`, last per resident counts. |
| `ideas`, `supports` | one idea per resident per hour; one support per (idea, resident), never the proposer's; status `open | taken_up | answered | declined | merged`. |
| `feedback` | `code` (lookup code, 10 chars from an unambiguous alphabet), optional `resident_id`, `about_kind`/`about_id`, `category`, `status`, `summary`, `answer`, `answer_public`. |
| `rounds` | localized `question`/`detail`, `options` JSON (frozen at open), `status draft | open | closed | published`, `closes_at`, `result` JSON `{counts, ballots_sha256, voters}` set at close. |
| `letter_requests`, `letters_sent`, `letter_status` | a request holds name, street, extra line, postcode, a keyed hash of them (`person_key`), its time and the keyed hash of its request code (`status_key`), only while it waits; `letters_sent` holds `person_key` alone (`WITHOUT ROWID`: no date, no insertion order); `letter_status` holds `status_key`, `status` (`waiting`, `sent`, `declined`), the decline `reason` and the Monday it `expires` (`WITHOUT ROWID`; no name, street, postcode or time of asking). |
| `staff`, `staff_sessions`, `enrol_codes`, `residents`, `settings`, `ai_calls` | scrypt password hashes; code and token hashes only; `ai_calls` holds purpose, model, prompt hash, sizes, timing, outcome, never text. |

Event kinds: `procedure.created|updated|update_posted|verdict`, `idea.posted|supported|unsupported|decided`, `feedback.filed|updated|answered`, `round.created|updated|opened|ballot|closed|published`, `staff.created|updated|login|logout`, `enrol.batch|resident|letter_requested|letters_printed|letter_declined|letter_status_expired`, `settings.changed`, `ai.call`, `seed.loaded`.

## 3. APIs

The full route table with roles is `modules/desk/README.md`. Contract points that other modules rely on:

- `GET /healthz` → `{ok, counts, model, head: {seq, hash}}`; `GET /audit/verify` → `{ok, checked, head}` or `{ok: false, first_bad: seq}`.
- Resident reads are public (`/procedures`, `/ideas`, `/rounds`, `/settings/public`, `/feedback/by-code/:code`); resident writes need `Authorization: Resident <token>`; staff routes need `Authorization: Staff <token>` and a role.
- Errors are `{error: "<plain sentence>"}` with 400, 401, 403, 404, 409, 413, 429, 502 (model nonsense), 503 (no model).
- Limits per client and minute: 30 writes, 240 reads, 10 sign-in tries; bodies ≤ 64 KiB; texts ≤ 4000 characters per language.
- Companion `/healthz` adds `desk: true|false`; the citizen app shows the Desk pages only when true and falls back to the read-only Agora list otherwise.

## 4. Apps

- Citizen app (`apps/citizen`, `/`): pages Procedures, Ideas, Feedback, Votes, five languages, Affichage look. Sign-in sheet asks for the enrolment code only when a write needs it.
- Portals (`apps/portal`, `/portal/`): one Svelte app, fr + en, sections by role. Operator: inbox, ideas, procedures, votes, model suggestions labelled and editable. Admin: staff, enrolment code batches, settings, model endpoint + test. Audit: event log + verify, ballots + recount, model calls, summary.

## 5. Tokens and cost

Per model call: triage ≈ 600 input + 80 output tokens; draft ≈ 900 + 300; translate ≈ 300 + 300 per target language; Companion explain/challenge unchanged (see `modules/companion/README.md`). At a free tier (Groq, ≈ 14,400 requests/day on the 70B model) a commune of Esch's size (≈ 36,000 residents, say 50 feedback messages and 20 updates a day) uses under 200 calls/day: no paid tier needed for the pilot. Hosting: the existing Mulinux box; Desk's memory cap is 256 MB; the database grows ≈ 2 KB per event.

## 6. Phases and acceptance criteria

| Phase | Ships | Accepted when |
|---|---|---|
| 1 Desk service (PR #42) | `modules/desk`, Companion forwarding, deploy files | `tools/check.sh` green; `GET /audit/verify` ok after the seed and 100 mixed writes; UPDATE/DELETE on `events` or `ballots` raise; `curl /healthz` on Mulinux reports `desk: true`. |
| 2 Resident pages | citizen app pages | At 375 px and 1280 px: file feedback and read it back by code; enrol, post an idea, support another; cast then change a ballot; give a verdict on a finished procedure. No raw id in `document.body.textContent` (test). |
| 3 Portals | `apps/portal` | Sign in as operator, admin, auditor; an auditor never sees the inbox; triage/draft/translate return labelled text; verify shows ok; recount equals the published tally. |
| 4 Pilot on Mulinux | a message to the operator on Mulinux | `civic-desk` enabled, `/etc/civic/desk.env` set, first admin created, a code batch printed, the deploy's live check passes. |
| 5 Trust core swap (later) | Door for codes, Booth for secret ballots, Record checkpoints of `events.hash` | Each swap changes no resident-facing route. |

## 7. Resident sign-up beyond printed codes (2026-10-09)

Before: a resident could only take part with a code from a letter the commune printed in bulk or handed out at the counter. Someone who never got one had no way in.

Picked (the default, of three): **a self-service request in the citizen app, answered by post.** The other two were a counter visit only (no change to the software, but no way in for people who cannot go) and real eID now (below; not buildable in the pilot).

```
citizen app: sign-in sheet ── "No code yet? Get one by post" ── name, street, flat/floor, postcode
      │ POST /api/desk/enrol-requests (no token)
      │   postcode outside commune.postcodes ─> 400 {code: "outside_commune"}, nothing kept
      │   else ─> {request_code}; the device keeps it next to the date
      ▼
Desk: letter_requests (waits) + letter_status "waiting" ──admin: check against the residents' register──┐
      │                                                                                                 │
      ├─ decline (reason): row deleted, status "declined" + reason, event enrol.letter_declined {reason}│
      └─ print: one code per request in batch "by post YYYY-MM", rows deleted,                          │
         person_key kept in letters_sent, status "sent", event enrol.letters_printed
      ▼
portal: A4 letter, address in the left window, code once, six languages ──> post ──> resident types the code

citizen app, next visit: sign-in sheet ── POST /api/desk/enrol-requests/status {code} ─> waiting | sent | declined + reason
```

| Property | How |
|---|---|
| Desk never holds a name next to a code | Codes are hashes; the request row is deleted in the same transaction that makes the codes; the printed letters are returned once, shuffled, and never stored. |
| The log never names who asked | `enrol.letter_requested` (actor `anonymous`, empty payload), `enrol.letters_printed` (`{batch, count, requests: [ids]}`), `enrol.letter_declined` (`{reason}`), `enrol.letter_status_expired` (`{count}`). Tested: no name, street or postcode in any table or event after printing and after declining. |
| Only the commune's postcodes | `commune.postcodes`, a list of ranges (`4001-4398`) or single codes an admin sets on the portal's Settings page. A request with another postcode is refused (`400`, code `outside_commune`) and nothing of it is kept; the citizen form says the service is for the commune's residents and to ask their own commune. A request that came in before the ranges changed is flagged `outside` on the portal and Desk refuses to print it (`409`): the letter would print the commune's name under another town's postcode. Empty list: no check. The ranges are not hard-coded: the admin copies them from Post Luxembourg's list (`ops/operator-queue.md`). |
| The resident learns a decline without Desk reaching them | A new request returns a random request code (18 bytes, base64url) that only the asking device keeps, next to the date. Desk keeps `HMAC(letters.key, code)` in `letter_status` with the outcome: `waiting`, then `sent` or `declined` with one of four reasons the admin picks (`not_in_register`, `outside_commune`, `asked_twice`, `address_incomplete`). On its next visit the sign-in sheet sends the code alone (`POST /enrol-requests/status`, ten per client per minute) and shows "Your request was declined: …" or "The commune posted your letter". A wrong, malformed or expired code gets the same `404`. Asking again for a waiting name and address returns no new code. The code is not a sign-in and opens nothing else. |
| Status rows expire | 60 days after their last change, rounded up to the next Monday (a fixed period of the pilot, not a Charter rule), a status row is deleted; the log records how many went. A request still waiting after that gets its row back when it is printed or declined. |
| Asking twice is visible, not blocked | The same normalised name, street and postcode while waiting answers `already: true`; after a letter went, `letters_sent` flags `sent_before` and the portal leaves it unticked. The admin decides (a lost letter is a real case). |
| Abuse | Five requests per client per minute on top of the write limit; at most 5000 waiting (503 after). The real check is the commune's residents' register, done by a person. |
| Backups | A nightly copy of the database (`ops/deploy/civic-backup.service`) holds whatever waits at that moment, names and addresses included, and the `letters.key` secret. Copies are mode 600, owned by `civic`, in `/var/backups/civic/YYYY-MM-DD/` on the server, never in Git, and are **kept 7 days**. So a request printed or declined today is gone from the live database at once but **can live in a backup for up to 7 more days**, until that night's copy expires. Restoring a backup brings back only requests that were still waiting when it was taken. |
| Ages and tech levels | Four plain fields with browser autofill, one link from the sheet a resident already sees, the date of the request kept on the device and shown on the sheet, five languages. |

What it does not do: the admin who prints sees the name next to the code, as at a counter, and codes printed in a small month batch narrow down who could hold them. Ballots stay open ballots (section on identity in `modules/desk/README.md`). Only Door's blind issuance removes both.

Later path, not built: **Door with a real identity provider.** The letter code becomes one way into Door, LuxTrust and the Luxembourg eID (through the EU Digital Identity Wallet, OpenID4VP) the other (`docs/architecture/02-protocols.md` section 1). The resident proves residence once; Door computes the uniqueness key from the national identifier and issues a blind-signed credential that names no one, so the commune can no longer link a resident to their votes even with the letter in hand. Needs: a relying-party agreement with LuxTrust or the state's eID service, Door's HTTP issuance wired to Desk (`POST /enrol` accepting a Door presentation instead of a code), and the external audit Door's README requires before binding use.

Accepted when (this phase): `tools/check.sh` green; Desk tests show request, repeat, print, decline, the per-client limit, and no name, street or postcode anywhere in the database or log after printing; citizen tests show the form, the postcode error, the date-only trace on the device; portal tests show the list, the flags, printing with the window address and declining; one printed A4 page per letter.

Accepted when (postcodes and decline notice, 2026-11-04, issue #81): `tools/check.sh` green; Desk tests show an out-of-range postcode refused with `outside_commune`, an empty list accepting any, printing an out-of-range request refused, the status row going waiting, sent, declined and expired, the status lookup answering only the right code and the same `404` for any other, the per-client limits, and no name, street or postcode in any table or event after printing and after declining; citizen tests show the outside-commune sentence and every decline reason in five languages, the sent notice, and the status check sending the request code alone (no token, place, topic or answer), with the Pulse trace unchanged; portal tests show editing the ranges, declining with a reason, and an out-of-range request that cannot be ticked or printed.

## 8. Not in scope

Secret ballots (Booth), delegation, panels drawn by lot, photo proof, payments, notifications by email or SMS (feedback is looked up by code instead), and any ranking beyond "most supported first".
