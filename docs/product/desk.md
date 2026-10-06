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
| `staff`, `staff_sessions`, `enrol_codes`, `residents`, `settings`, `ai_calls` | scrypt password hashes; code and token hashes only; `ai_calls` holds purpose, model, prompt hash, sizes, timing, outcome, never text. |

Event kinds: `procedure.created|updated|update_posted|verdict`, `idea.posted|supported|unsupported|decided`, `feedback.filed|updated|answered`, `round.created|updated|opened|ballot|closed|published`, `staff.created|updated|login|logout`, `enrol.batch|resident`, `settings.updated`, `ai.call`, `seed.loaded`.

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
| 4 Pilot on Mulinux | operator queue entry | `civic-desk` enabled, `/etc/civic/desk.env` set, first admin created, a code batch printed, the deploy's live check passes. |
| 5 Trust core swap (later) | Door for codes, Booth for secret ballots, Record checkpoints of `events.hash` | Each swap changes no resident-facing route. |

## 7. Not in scope

Secret ballots (Booth), delegation, panels drawn by lot, photo proof, payments, notifications by email or SMS (feedback is looked up by code instead), and any ranking beyond "most supported first".
