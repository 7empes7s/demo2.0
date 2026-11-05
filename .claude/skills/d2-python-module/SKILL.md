---
name: d2-python-module
description: Use when adding to or creating a Python (uv workspace) module such as docket, provenance, agora, commons, record, lottery, symmetry or booth-verify, so it keeps the boundaries, offline tests and repo layout.
---

# Python module

Map: `docs/ARCHITECTURE.md` sections 1, 2 and 8. Each module's README says what it owns.

## Layout of a Python module

```
modules/<name>/
  LICENSE  README.md  CHANGELOG.md          # required (tools/boundaries.py)
  pyproject.toml                            # name d2-<name>, hatchling, [project.scripts] d2-<name>
  src/d2_<name>/__init__.py  __main__.py    # CLI entry: main()
  src/d2_<name>/server.py                   # if it serves HTTP (stdlib ThreadingHTTPServer, loopback)
  tests/test_*.py                           # pytest, found by glob (no central list)
```

A new module also adds one line to `members` in the root `pyproject.toml`, then `uv sync --all-packages`.
Copy `modules/agora/pyproject.toml` for the shape, including
`[tool.uv.sources] d2-charter = { workspace = true }` when it uses the Charter.

## Rules

1. **Imports:** only the standard library, its own declared dependencies, `d2_charter` and data under
   `spec/`. Never `d2_<other module>`. Another module is reached over HTTP or by running its CLI.
2. **HTTP services** listen on `127.0.0.1` with a port of their own, expose `GET /healthz`
   (`{"ok": true, ...}`, never a key), bound request size and threads (see `_BoundedServer` in
   `modules/agora/src/d2_agora/server.py`), and answer JSON that matches a `spec/schemas/*.schema.json`
   when another module reads it. A new schema goes in `spec/schemas/` with a test in `spec/tests/`.
3. **Tests never reach the web or a model.** Record real pages or answers once into `tests/fixtures/`
   (or the module's data folder) and read them; inject the fetcher (`modules/docket/src/d2_docket/fetch.py`)
   or the clock. No API keys, `.env` files or databases in git.
4. **Charter values** come from `d2_charter.param("dotted.key")`, never a hard-coded number.
5. **Errors** have stable codes (CLI exit codes, JSON `error`); tests assert the code.
6. **Style:** ruff (`E, F, I, B, UP`, line length 100), Python 3.11+. `tools/health.py` also runs
   vulture and ruff `SIM`/`PL` against `tools/baselines/`: new findings fail.
7. **Crypto or verifier modules** (`record`, `lottery`, `booth-verify`): also follow the vector and
   must-fail rules in `d2-rust-crypto` (same discipline, any language). A verifier is written from
   `spec/<name>/README.md` alone and shares no code with the implementation.
8. **Deployed services** (`provenance`, `agora`, `commons`) have a unit in `ops/deploy/civic-<name>.service`
   (`PartOf=civic-companion.service`); `tools/tests/test_deploy_units.py` lints units. A new port or
   unit is documented in `ops/deploy/README.md` and, for the operator, `ops/operator-queue.md`.

## Commands

```sh
uv sync --all-packages
uv run pytest -q modules/<name>
uv run ruff check modules/<name> && uv run ruff format modules/<name>
uv run d2-<name> --help
uv run python tools/boundaries.py
uv run python tools/health.py check
```

## Done when

- [ ] Tests for the change, offline; `uv run pytest -q` green
- [ ] `modules/<name>/README.md` (usage, API) and `CHANGELOG.md` (Unreleased) updated
- [ ] Then `d2-pr-checklist`
