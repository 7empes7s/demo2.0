---
name: d2-charter-rule
description: Use when adding or changing a rule, value or citation in charter/charter.yaml (or its schema, vectors or bindings), so the version is bumped and every rule keeps its provenance.
---

# Charter rule change

Map: `docs/ARCHITECTURE.md` section 7. Read `charter/README.md` and the header comment of
`charter/charter.yaml` (what `basis` and `status` mean) first. Method and open lookups:
`charter/CONSTITUTION.md`.

## Rules

1. **Any change to `charter.yaml` bumps `version`** (semver: a rule value or a new rule is minor;
   a note or provenance-only correction is patch). The old version becomes `unknown_version` for
   `param(key, version)`; say so in `charter/CHANGELOG.md` like the existing entries.
2. **Every rule has provenance**: an entry in the `provenance` section (protected rights inline) with
   `basis` (`constitution | law | project`) and `source` (`instrument`, `status`, and `article`,
   `chapter` or `right`, plus `note`). `test_every_rule_has_provenance_and_nothing_else_does` fails
   otherwise. A placeholder value carries `# placeholder: decision needed` and still has provenance.
3. **Nothing is `verified` without an `article`**, and only when someone read the official text
   (Legilux, the 2023 Constitution). Otherwise `to_verify` with the chapter or right in words.
   Never guess an article number.
4. **A `constitution` rule cannot be changed by the Charter.** Changing its value means the source
   changed; cite it.
5. **Read rules only through the bindings** (`d2_charter.param`, `@democracy2/charter` `param`). No
   module hard-codes a Charter number.

## Files to update together

| File | What |
|---|---|
| `charter/charter.yaml` | The rule, `version`, the `provenance` entry |
| `charter/charter.schema.json` | Only if the shape changes |
| `charter/vectors/*.json` | `charter_version` and the description in `param.json`, `tier.json`, `protected.json`, `provenance.json`; `charter.parsed.json` (`version` and the parsed rule); new cases for the rule |
| `charter/CHANGELOG.md` | One line under Unreleased: what changed, why, decided by whom, counts if provenance moved |
| `charter/CONSTITUTION.md` | When a citation or basis changed |
| `charter/python`, `charter/ts` | Only if the API changed (both bindings pass the same vectors) |
| Consumers | grep for the key (`rg "<dotted.key>"`); the citizen app takes Charter values at build time (`pulseCharter` in `apps/citizen/vite.config.ts`) |

## Commands

```sh
rg -n '"charter_version"|"version"' charter/vectors         # every one bumped
uv run pytest -q charter                                     # schema, provenance, vectors (Python)
npm run test -w @democracy2/charter                          # vectors (TypeScript)
tools/check.sh
```

## Done when

- [ ] Version bumped everywhere it appears in `charter/vectors/`; CHANGELOG entry
- [ ] Every rule still has `basis` and `source`; no `verified` without an article
- [ ] Both bindings green; consumers checked
- [ ] Then `d2-pr-checklist`
