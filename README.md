# Democracy2.0

Tools for direct, verifiable, accountable democracy, built as standalone modules that each work on their own.

- Architecture: [`docs/architecture/`](docs/architecture/)
- Set up: `tools/dev-setup.sh`
- Check (what CI runs): `tools/check.sh`

| Folder | What lives there |
|---|---|
| `spec/` | JSON Schemas and API contracts, the only thing modules share |
| `charter/` | The rules of the game as versioned data, plus the Scope library |
| `modules/` | One folder per module, each shaped like its own repo |
| `apps/` | The citizen app and the consoles |
| `tools/` | Setup, checks and the merge gate |
