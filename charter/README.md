# charter

The rules of the game as versioned data (`charter.yaml`) and the Scope library that computes a matter's tier. Licence: Apache-2.0 (see LICENSE).

| Path | What lives there |
|---|---|
| `charter.yaml` | Every tunable rule, version `0.1.0` |
| `charter.schema.json` | JSON Schema (draft 2020-12) for `charter.yaml`; `tests/` validates it |
| `data/lu-jurisdictions.json` | Luxembourg reference data: country, 12 cantons, the capital and Esch-sur-Alzette, with populations |
| `vectors/*.json` | Shared test vectors every binding must pass |
| `python/` | `d2_charter`, the Python binding (uv workspace member) |
| `ts/` | `@democracy2/charter`, the TypeScript binding (npm workspace) |

## API

Both bindings expose the same three calls (TypeScript also has the camelCase `isProtected`):

| Call | Returns |
|---|---|
| `tier(matter)` | `national`, `regional`, `local` or `minor` |
| `param(key, version?)` | The value at a dotted key, such as `tiers.local.review_panel`; a `version` other than the loaded one is an error |
| `is_protected(matter)` | `true` when no vote may decide the matter |

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

## Known gaps in v0

- **Scope uses the jurisdiction only, not the topic.** The architecture says Scope computes affected population "from jurisdiction and topic". v0 ignores topics for the tier, so a national subject (say a national tax rate) filed under a commune comes out `local`. Since the proposer picks the jurisdiction, this is a way to shrink a matter's tier. Until topics widen scope, the only remedy is a `ScopeChallenge`. Open question for Marouane: which topics, if any, always count as national.
- **The proposer can also widen the jurisdiction.** Scope trusts the jurisdiction it is given, so a commune matter filed under `lu` comes out `national` and jumps the Agora queue. Charter cannot tell; the fix sits with the caller. Agora with Door now binds the jurisdiction to the proposer's credential, so nobody files outside the areas they live in, but a resident can still file under an area containing their own (Esch under `lu`); that needs a `ScopeChallenge` against an inflated tier. Agora pins the remaining behaviour in a test (see `modules/agora/README.md`, Not done yet).
- **The libraries need this repo's layout.** Both bindings read `charter.yaml`, `data/` and `vectors/` from this folder (`CHARTER_ROOT`), so they work only as an editable workspace install (the uv workspace and npm workspaces here). A built wheel or npm tarball does not include the data. Pass `root` to `Charter` to load another folder.

## Placeholders

Values the docs give no number for carry `# placeholder: decision needed` in `charter.yaml`. They are conservative defaults, not decisions. The population figures are also provisional: see `note` in `data/lu-jurisdictions.json`, and refresh them from STATEC before any binding use.

## Changing the Charter

Edit `charter.yaml`, bump `version`, and update `vectors/` (including `charter.parsed.json`) in the same change. Regenerate the pinned JSON with:

```sh
uv run python -c 'import json, yaml; print(json.dumps(yaml.safe_load(open("charter/charter.yaml")), indent=2, ensure_ascii=False))' > charter/vectors/charter.parsed.json
``` Both bindings and the schema tests run in `tools/check.sh`. In production a Charter change is accepted only with a constitution-class Booth tally proof (`charter_change`).

## Follow-ups

- Rust binding (`charter` crate) running the same vectors, when the crypto core lands.
- Older Charter versions: `param(key, version)` answers only the loaded version today.
- Topic-based scope (a topic that always affects the whole country) once a topic tree exists. See Known gaps.
- Ship `charter.yaml` and the data inside the published packages. See Known gaps.
