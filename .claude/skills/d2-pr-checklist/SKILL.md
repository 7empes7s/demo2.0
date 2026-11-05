---
name: d2-pr-checklist
description: Use before pushing and opening any Democracy2.0 pull request, to self-review the diff, run tools/check.sh, write "Closes #N", and add the STATE.md entry without merge conflicts.
---

# Pre-PR self-review

Run this after the change-specific skill (`d2-citizen-ui`, `d2-portal-ui`, `d2-desk-change`,
`d2-python-module`, `d2-rust-crypto`, `d2-charter-rule`). Repo map: `docs/ARCHITECTURE.md`.

## 1. Sync with main first

```sh
git fetch origin
git merge origin/main            # never rebase a pushed branch, never force-push
```

Conflicts are most likely in `STATE.md`, `apps/citizen/src/lib/i18n.ts`, `apps/portal/src/lib/i18n.ts`,
`apps/citizen/VOCABULARY.md` and CHANGELOGs. Resolve them as below, then re-run the checks.

## 2. The diff

```sh
git diff origin/main...HEAD --stat
git diff origin/main...HEAD
```

- [ ] One issue, minimal diff: no drive-by refactors, renames or reformatting of untouched code.
- [ ] No debug output, commented-out code, dead helpers, TODOs without an issue.
- [ ] No secrets, `.env`, keys, `*.db` (`git status --ignored` if unsure).
- [ ] No skipped, disabled or quarantined test (`.skip`, `.only`, `#[ignore]`, `pytest.mark.skip`, `xfail`), no weakened assertion.
- [ ] Tests never reach the web or a model (recorded fixtures, stubbed `fetch`, scripted providers).
- [ ] No module imports another module (only `spec/`, `charter/`).
- [ ] Every new citizen string in lb, fr, de, en, pt; every new portal string in fr and en; VOCABULARY words; no raw ids outside "Technical details".
- [ ] Docs: the module `README.md` and `CHANGELOG.md` (Unreleased); `docs/product/desk.md` for Desk;
      `docs/ARCHITECTURE.md` if a module, port, store, route between modules or check changed.
- [ ] A mistake you or a reviewer caught that has happened before: add `lessons/YYYY-MM-DD-<slug>.md`
      (**Mistake**, **Rule**) in the same PR.

## 3. The check (what CI runs)

```sh
tools/check.sh; echo "exit=$?"
```

Must print `check.sh: all green` and exit 0. If `tools/health.py check` fails on your new finding,
fix it; if you removed findings, run `uv run python tools/health.py ratchet` and commit the lowered
baselines (`docs/code-health.md`). `cargo: command not found` usually means rustup is installed but
not on `PATH`: `export PATH="$HOME/.cargo/bin:$PATH"` (where `tools/dev-setup.sh` puts it). If a step
still can't run locally, say so in the PR and rely on CI; never claim it passed.

For UI changes, also the preview checks in `d2-citizen-ui` / `d2-portal-ui` (375, 390, 1440 px,
day and night, keyboard, reduced motion, no console errors).

## 4. STATE.md entry (long work)

Add **one** entry directly under the `Handoff file for long-running work. Newest first.` line:

```markdown
## YYYY-MM-DD: <what shipped, in words> (issue #N)

- Done: <what and where, file paths>.
- Evidence: <test counts, check.sh green, live checks>.
- Not done / Not live: <what is left, operator steps in ops/operator-queue.md>.
```

Merging STATE.md cleanly: every PR adds at the same spot, so a conflict is normal. Keep **both**
entries: main's first-merged ones and yours, yours on top (newest first), one blank line between,
and delete the markers. Never edit or reorder other people's entries.

```sh
git checkout --theirs STATE.md   # take main's file, then paste your entry back under the header
```

(`--theirs` is main's side during `git merge origin/main`.)

## 5. Translation files on conflict

`i18n.ts` holds one block per language (`en`, `fr`, `de`, `lb`, `pt` / `en`, `fr`). When both sides
added keys at the same spot, keep both sides' keys in **every** block; a duplicated key or a missing
one is a typecheck or test failure. Then run
`npm run typecheck -w @democracy2/citizen -w @democracy2/portal` and their tests.
To avoid the conflict, insert new keys next to a related key rather than at the end of a block.

## 6. Push and open the PR

```sh
git push -u origin <branch>
gh pr create --base main --head <branch> --title "<what changed, plain words>" --body-file <file>
```

The body **must contain `Closes #N`** on its own line (the issue closes on merge; PRs without it
were missed before). Then:

- **What changed** (per area), **How I verified it** (real commands, counts and exit codes; UI
  sizes and modes checked), **Assumptions** (decisions taken without asking), and a
  **Self-review:** line saying what the review found and what you fixed.
- Check it: `gh pr view --json closingIssuesReferences --jq '.closingIssuesReferences[].number'`
  prints the issue number.
- Never merge it yourself and never push to `main`.
