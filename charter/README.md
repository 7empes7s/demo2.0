# charter

The rules of the game as versioned data (`charter.yaml`) and the Scope library that computes a matter's tier. Licence: Apache-2.0 (see LICENSE).

| Path | What lives there |
|---|---|
| `charter.yaml` | Every tunable rule, version `0.4.0`, each with its `basis` and `source` |
| `charter.schema.json` | JSON Schema (draft 2020-12) for `charter.yaml`; `tests/` validates it |
| `CONSTITUTION.md` | How each rule ties to the Luxembourg Constitution: method, every rule with its basis and status, the Legilux lookups still open |
| `data/lu-jurisdictions.json` | Luxembourg reference data: country, 12 cantons, the capital and Esch-sur-Alzette, with populations |
| `vectors/*.json` | Shared test vectors every binding must pass |
| `python/` | `d2_charter`, the Python binding (uv workspace member) |
| `ts/` | `@democracy2/charter`, the TypeScript binding (npm workspace) |

## API

Both bindings expose the same five calls (TypeScript also has the camelCase `isProtected`):

| Call | Returns |
|---|---|
| `tier(matter)` | `national`, `regional`, `local` or `minor` |
| `param(key, version?)` | The value at a dotted key, such as `tiers.local.review_panel`; a `version` other than the loaded one is an error |
| `is_protected(matter)` | `true` when no vote may decide the matter |
| `source(key)` | Where the rule at a dotted key comes from: `{instrument, status, article \| chapter \| right, note, cross_references}`; `protected_rights.<id>` for a protected right |
| `basis(key)` | `constitution`, `law` or `project`: who decides the rule. The Charter may not override a `constitution` rule |

Also `affected_population(matter)` (`affectedPopulation` in TypeScript), and a `Charter` class for a different root directory or extra jurisdictions such as districts inside a commune. Errors carry a `code` that the vectors name: `invalid_matter`, `unknown_jurisdiction`, `no_population`, `duplicate_jurisdiction`, `unknown_key`, `unknown_version`, `invalid_charter`.

```python
from d2_charter import tier

tier({"jurisdiction_id": "lu-commune-esch-sur-alzette", "topic_ids": ["parks"]})  # "local"
```

```ts
import { tier } from "@democracy2/charter";
tier({ jurisdiction_id: "lu-commune-esch-sur-alzette", topic_ids: ["parks"] }); // "local"
```

## How Scope decides

- A matter is an object with `jurisdiction_id` and `topic_ids`. Every other field is ignored, so a proposer's `scope_tier`, `claimed_tier` or `affected_population` cannot move the result. Contesting a tier is a `ScopeChallenge`, not a label.
- Affected population is the jurisdiction's population from the reference data. The tier is the first one in `scope.thresholds`, from the top, whose `min_population` the population reaches.
- Population is a whole number. `1000` and `1000.0` are the same population in every binding; `999.5`, a negative number or a missing figure is `no_population`.
- `charter.yaml` is read as YAML 1.1 (PyYAML's dialect) in both bindings. `vectors/charter.parsed.json` pins the parsed result and both test suites compare against it, so a parser difference fails CI. Regenerate it whenever `charter.yaml` changes.
- On load, both bindings reject a file without `version`, `scope`, `tiers` or `protected_rights`, or with a review panel whose `min` is above its `max`, with `invalid_charter`. The full schema check runs in CI only.
- A matter is protected when any topic equals a `protected_rights` topic or sits under it (`rights.expression.press` is under `rights.expression`; `rights.expressionism` is not).

## Where the rules come from

Decision of 2026-10-06: for the Luxembourg version, the Charter is the Luxembourg Constitution (revised text in force since 1 July 2023). Every rule carries a `basis` and a `source`, in the `provenance` section of `charter.yaml` for scalar rules and inline for protected rights, and `CONSTITUTION.md` lists them all. Two kinds of rule live side by side:

- **Constitution-bound** (`basis: constitution`, also `law`): the eight protected rights that restate constitutional rights, `charter_change.majority` and `charter_change.quorum_share_of_electorate` (they must mirror the Constitution's revision procedure), and `eligibility.outsiders` (the electoral law). The Charter restates these; no vote inside this system changes them.
- **Project-chosen** (`basis: project`): everything else, from `scope.thresholds` to `vote_budget.matters_per_week`, sourced to `docs/architecture/`. A `charter_change` vote may change them.

A source's `status` is `verified` only once the official text was read for this repo. Today every legal citation is `to_verify`: the 2023 text is not in the repo and no article number is guessed. `CONSTITUTION.md` has the checklist of Legilux lookups that flip them.

## Known gaps in v0

- **One citation is still to verify.** The 8 constitutional rights and `charter_change.majority` cite their 2023 article numbers and are `verified` (read on 2026-10-09 in the Chambre des Députés edition of the 2023 text; see `CONSTITUTION.md` for what was read and what was not). `eligibility.outsiders` stays `to_verify` until the electoral law is read.
- **The Charter's own rights list may be incomplete.** Chapitre II guarantees more than the eight rights listed (for example asylum, education and property, Articles 32, 33 and 36). Which of those a vote may never touch is a decision for Marouane.

- **Scope uses the jurisdiction only, not the topic.** The architecture says Scope computes affected population "from jurisdiction and topic". v0 ignores topics for the tier, so a national subject (say a national tax rate) filed under a commune comes out `local`. Since the proposer picks the jurisdiction, this is a way to shrink a matter's tier. A `ScopeChallenge` v1 only narrows and never raises a tier, so this stays open until topics widen scope or a widening challenge is designed. Open question for Marouane: which topics, if any, always count as national.
- **The proposer can also widen the jurisdiction.** Scope trusts the jurisdiction it is given, so a commune matter filed under `lu` comes out `national`. Charter cannot tell; the fix sits with the caller. Agora with Door binds the jurisdiction to the proposer's credential, so nobody files outside the areas they live in, and a resident who files under an area containing their own (Esch under `lu`) can be contested with a `ScopeChallenge` (Agora, see `modules/agora/README.md`, Scope challenges): a Lottery panel of `scope_challenge.panel_size` decides within `scope_challenge.decision_days`, and when it narrows, `tier` is recomputed for the narrower jurisdiction. Closed in Agora; the inflated tier holds while a challenge is open, and in an area with too few participants for a panel.
- **The libraries need this repo's layout.** Both bindings read `charter.yaml`, `data/` and `vectors/` from this folder (`CHARTER_ROOT`), so they work only as an editable workspace install (the uv workspace and npm workspaces here). A built wheel or npm tarball does not include the data. Pass `root` to `Charter` to load another folder.

## Placeholders

Values the docs give no number for carry `# placeholder: decision needed` in `charter.yaml`. They are conservative defaults, not decisions, and all of them are `basis: project`. The population figures are also provisional: `population_source` in `data/lu-jurisdictions.json` is `{name: STATEC, status: to_verify}` (see its `note`); refresh them from STATEC before any binding use.

## Changing the Charter

Edit `charter.yaml`, bump `version`, give every new rule a `provenance` entry (`tests/` fails otherwise), and update `vectors/` (including `charter.parsed.json`) and the table in `CONSTITUTION.md` in the same change. Regenerate the pinned JSON with:

```sh
uv run python -c 'import json, yaml; print(json.dumps(yaml.safe_load(open("charter/charter.yaml")), indent=2, ensure_ascii=False))' > charter/vectors/charter.parsed.json
``` Both bindings and the schema tests run in `tools/check.sh`. In production a Charter change is accepted only with a constitution-class Booth tally proof (`charter_change`).

## Follow-ups

- Rust binding (`charter` crate) running the same vectors, when the crypto core lands.
- Older Charter versions: `param(key, version)` answers only the loaded version today.
- Topic-based scope (a topic that always affects the whole country) once a topic tree exists. See Known gaps.
- Ship `charter.yaml` and the data inside the published packages. See Known gaps.
