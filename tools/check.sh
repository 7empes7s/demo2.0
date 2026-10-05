#!/usr/bin/env bash
# The repo's whole check: what CI runs and what an agent runs before pushing.
# Tests are discovered by glob or by the runner; never keep a central list that every PR has to edit.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== layout and module boundaries"
uv run --quiet python tools/boundaries.py

echo "== python"
uv run --quiet ruff check .
uv run --quiet ruff format --check .
uv run --quiet pytest -q

if [ -f package.json ]; then
  echo "== typescript"
  npm run --if-present --workspaces lint
  npm run --if-present --workspaces typecheck
  npm run --if-present --workspaces build
  npm run --if-present --workspaces test
fi

if [ -f Cargo.toml ]; then
  echo "== rust"
  cargo fmt --all --check
  cargo clippy --workspace --all-targets -- -D warnings
  cargo test --workspace
fi
echo "check.sh: all green"
