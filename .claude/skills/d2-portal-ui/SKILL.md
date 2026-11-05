---
name: d2-portal-ui
description: Use when adding or changing a staff portal screen or string (apps/portal, served under /portal/), so it ships in French and English and respects Desk sign-in, roles and 401s.
---

# Staff portal screen

Map: `docs/ARCHITECTURE.md` sections 3 and 4. Desk spec: `docs/product/desk.md`. App README:
`apps/portal/README.md`.

## Where things go

| What | Where |
|---|---|
| Screen | `apps/portal/src/components/<Name>.svelte`; hash routes in `src/lib/route.svelte.ts`, shell in `src/App.svelte` |
| Desk calls | `src/lib/api.ts` (every call goes to `/api/desk/*` with `Authorization: Staff <token>`) |
| Session and role | `src/lib/session.svelte.ts` |
| Types of Desk answers | `src/lib/types.ts` (mirror `modules/desk/src/*.ts`) |
| Strings | `src/lib/i18n.ts`: `en` (reference) and `fr`, typed `Dict` |
| Look | `src/tokens.css` and `src/portal.css` (same Affichage rules as the citizen app) |
| Tests | `apps/portal/test/*.test.ts` (`helpers.ts` has `fakeDesk`) |

## Rules

1. **fr and en.** Every new key in both blocks, same `{placeholders}` (`test/i18n.test.ts` checks it).
   Insert next to a related key, same place in both blocks, not at the end.
2. **Roles.** `admin`, `operator`, `auditor`. A screen is shown only to the roles that may use it,
   and **Desk enforces it again**: every staff route calls `needStaff(who, ...roles)` in
   `modules/desk/src/server.ts` (401 without a session, 403 for the wrong role). Never rely on the
   portal hiding a button. A new route needs Desk tests for 401 (no header) and 403 (wrong role)
   and a portal test in `test/roles.test.ts` for who sees the screen.
3. **401 signs out.** `api.ts` signs the portal out on any 401 (`test/api.test.ts`); keep it.
4. **Model text** (triage, draft answer, translation, `modules/desk/src/ai.ts`) is always labelled as a
   suggestion ("The model suggests…", "Model draft: check…"), lands in an editable field, and is
   never sent or published without a staff action. Desk logs model calls without their text
   (`ai_calls`: purpose, model, prompt hash, sizes).
5. **No raw ids** in visible text, except under "Technical details" (`Tech.svelte`).
6. **Affichage**: token colours only, no radius, no blurred shadow, reduced motion respected.
7. Changing what Desk stores or answers: also follow `d2-desk-change`.

## Commands

```sh
npm run typecheck -w @democracy2/portal
npm run test -w @democracy2/portal
npm run test -w @democracy2/desk             # when a Desk route changed
curl -s -o /dev/null -w '%{http_code}\n' 127.0.0.1:5865/api/desk/staff/me   # 401 signed out
```

## Preview

Use the preview recipe in `.claude/skills/d2-citizen-ui/SKILL.md` (Desk on 5866, Companion on 5865).
Open `http://127.0.0.1:5865/portal/`, sign in as `admin` with the `DESK_BOOTSTRAP_PASSWORD` you
started Desk with. To see the other roles, create an operator and an auditor on the Staff page and
sign in as each.

Check at **375, 390 and 1440 px, day and night**, in fr and en: no sideways scroll, nothing cut off,
keyboard only with labelled controls, reduced motion stops all motion, no console errors.

## Done when

- [ ] fr and en strings; roles enforced in Desk and tested (401, 403); model text labelled and editable
- [ ] Preview checked in each role that sees the screen
- [ ] `apps/portal/CHANGELOG.md` line; then `d2-pr-checklist`
