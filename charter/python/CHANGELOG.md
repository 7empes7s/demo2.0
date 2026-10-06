# Changelog

## Unreleased

- `source(key)` and `basis(key)` (module functions and `Charter` methods): the provenance of a rule by its dotted key, or `protected_rights.<id>`; `unknown_key` for anything else. Covered by `vectors/provenance.json`.
- `Charter.jurisdiction_path(id)`: the jurisdiction and its ancestors, root first (Python only for now; Agora uses it to check a Door presentation's jurisdiction).

## 0.1.0

- `tier`, `affected_population`, `param` and `is_protected` over Charter 0.1.0 and the Luxembourg reference data; passes the shared vectors.
