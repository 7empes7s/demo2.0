---
name: d2-desk-change
description: Use when changing modules/desk (tables, routes, events, auth, backups), so the event log stays append-only and hash-chained, staff routes stay guarded and existing databases still open.
---

# Changing the Desk

Map: `docs/ARCHITECTURE.md` sections 4 and 5. Spec (keep it current): `docs/product/desk.md`
(schema, event list, APIs, acceptance). README route table: `modules/desk/README.md`.

## Files

| File | Holds |
|---|---|
| `src/db.ts` | `SCHEMA` (all tables and triggers), `Store`, `Store.append`, `eventHash`, `verifyChain` |
| `src/desk.ts` | Procedures, ideas, feedback, votes |
| `src/auth.ts` | Staff, sessions, roles, enrolment codes, residents |
| `src/letters.ts` | Code by post |
| `src/ai.ts` | Model calls (suggestions only) |
| `src/fingerprint.ts`, `src/check-log.ts` | Daily signed checkpoint, outside check |
| `src/backup.ts` | Online backup and check |
| `src/server.ts` | Routes, `whoIs`, `needStaff`, `needResident`, rate limits |
| `test/desk.test.ts`, `test/fingerprint.test.ts`, `test/backup.test.ts` | Tests (vitest, in-memory or temp-file stores, fixed clock) |

## Rules (never break)

1. **Every state change is one `store.append(kind, actor, subject, payload, write)`**: the event and
   the row change commit in one transaction. New event kinds use `noun.verb` (`idea.posted`,
   `enrol.letter_declined`) and go in desk.md's event list.
2. **`events`, `ballots` and `fingerprints` are append only.** No `UPDATE` or `DELETE` on them, ever,
   and never drop or weaken their triggers (`events_no_update`, `events_no_delete`, `ballots_no_*`,
   `fingerprints_*`). A correction is a new event. Changing a ballot is a new ballot row (`seq`).
3. **The hash chain is the audit.** Don't change `canonical`, `eventHash` or the fields hashed; the
   fixture log in `test/fingerprint.test.ts` was computed by hand and must still match.
   `GET /audit/verify` and `backup.ts --chain` must stay `ok` on an existing log.
4. **No personal data in events.** Payloads carry ids and decisions, never a name, address or
   postcode (the "...then forgets the name and address" test in `test/desk.test.ts` must stay green).
5. **Staff routes** call `needStaff(who, ...roles)`: 401 without a session, 403 for the wrong role.
   Test both for every new route. Resident routes call `needResident(who)`.
6. **Model text** from `ai.ts` is returned as a suggestion for a staff member to edit; Desk never
   publishes or sends it by itself and logs calls without their text.
7. **Secrets** (`letters.key`, `log.key`, `DESK_BOOTSTRAP_PASSWORD`) never in git, logs or answers.

## Migrations

There is no migration framework. Every start runs `SCHEMA` (`CREATE TABLE IF NOT EXISTS`,
`CREATE TRIGGER IF NOT EXISTS`), so:

- **New table or trigger:** add it to `SCHEMA`. Existing databases get it on the next start.
- **New column on an existing table:** add it to `SCHEMA` *and* add an `ALTER TABLE ... ADD COLUMN`
  guarded by `PRAGMA table_info` in the `Store` constructor (see `letter_requests.status_key`).
  Nullable or with a default; older rows must still read.
- **Never** rename or drop a column, rewrite rows of append-only tables, or change a column a hash
  covers. Write a test that opens a database made with the old schema.
- Mulinux applies it on the next deploy (`civic-desk` restarts with the Companion); say so in STATE.md.

## Backups

`src/backup.ts` copies `desk.db` and `agora.db` with SQLite's online backup and checks them
(`PRAGMA integrity_check` plus `verifyChain`). A new table is backed up automatically. If it holds
personal data, say how long it lives in `docs/product/desk.md` section 7 (backups keep 7 days).

## Commands

```sh
npm run test -w @democracy2/desk
npm run typecheck -w @democracy2/desk
node --experimental-strip-types modules/desk/src/backup.ts --check <copy.db> --chain   # {"ok":true,...}
```

Live check: run Desk and the Companion as in `d2-citizen-ui` (Preview), then
`curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:5865/api/desk/<staff route>` gives 401.

## Done when

- [ ] Every change through `append`; no UPDATE/DELETE on append-only tables; chain tests green
- [ ] 401/403 tests for new staff routes; old-schema database still opens
- [ ] `docs/product/desk.md`, `modules/desk/README.md` (routes), `modules/desk/CHANGELOG.md` updated
- [ ] UI parts: `d2-portal-ui` / `d2-citizen-ui`; then `d2-pr-checklist`
