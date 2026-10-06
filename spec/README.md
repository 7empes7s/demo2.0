# spec

The contracts modules share. Nothing else is shared.

| Path | What lives there |
|---|---|
| `schemas/<name>.schema.json` | JSON Schema (draft 2020-12), `$id` `https://democracy2.dev/spec/<name>.schema.json` |
| `examples/<name>/` | One or more valid examples per schema, and invalid ones named `invalid-*.json` |
| `record-types.json` | The entry types Record accepts |
| `record/` | Record's log format (entries, tree, checkpoints, proofs) and the test vectors every implementation must pass |
| `lottery/` | Lottery's draw format (pool root, commitment, drand beacon check, draw algorithm), recorded drand beacons and draw vectors |
| `openapi/` | API contracts (when they land) |
| `tests/` | Checks every schema and example; run by `tools/check.sh` |

The data model behind these files is `docs/architecture/03-data-model.md`. Examples are synthetic; they never describe real bills or people.
Intentional extensions of that doc: `SourceItem.type` adds `petition`, `question`, `debate` and `other`; `Grade` evidence requires a `url` the reader can open (`source_document_id` is optional); `SymmetryReport` adds an optional free-form `details` object.

## Versioning

- Within a major version, changes are additive only, such as a new optional field.
- A breaking change (removing or renaming a field, making a field required, narrowing a type or enum) is a new major file, `<name>.v2.schema.json` with its own `$id` and its own `examples/<name>.v2/`. The old file stays until no module uses it.
