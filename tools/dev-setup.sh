#!/usr/bin/env bash
# One command from a fresh clone to a state where tools/check.sh can run.
# CI runs it, and cloud sessions run it on start (see .claude/settings.json). Keep it idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
uv sync --quiet --all-packages

if [ -f package.json ]; then
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
fi
