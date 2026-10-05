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
- A matter is protected when any topic equals a `protected_rights` topic or sits under it (`rights.expression.press` is under `rights.expression`; `rights.expressionism` is not).

## Placeholders

Values the docs give no number for carry `# placeholder: decision needed` in `charter.yaml`. They are conservative defaults, not decisions. The population figures are also provisional: see `note` in `data/lu-jurisdictions.json`, and refresh them from STATEC before any binding use.

## Changing the Charter

Edit `charter.yaml`, bump `version`, and update `vectors/` in the same change. Both bindings and the schema tests run in `tools/check.sh`. In production a Charter change is accepted only with a constitution-class Booth tally proof (`charter_change`).

## Follow-ups

- Rust binding (`charter` crate) running the same vectors, when the crypto core lands.
- Older Charter versions: `param(key, version)` answers only the loaded version today.
- Topic-based scope (a topic that always affects the whole country) once a topic tree exists.
- Ship `charter.yaml` and the data inside the published packages; today both bindings read them from this folder.
