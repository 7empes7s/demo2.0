"""Enforce the monorepo rules from docs/architecture/00-overview.md section 5.

1. Every modules/<name> has its own LICENSE, README.md and CHANGELOG.md.
2. A module imports only from spec/ and charter/, never from another module.
   Python packages are named d2_<module>; TypeScript packages @democracy2/<module>.
   Shared code lives in d2_spec / d2_charter (@democracy2/spec, @democracy2/charter).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REQUIRED_FILES = ("LICENSE", "README.md", "CHANGELOG.md")
SHARED = {"spec", "charter"}
SKIP_DIRS = {"node_modules", ".venv", "dist", "build", ".svelte-kit", "target", "__pycache__"}

PY_IMPORT = re.compile(r"^\s*(?:from|import)\s+d2_([a-z0-9_]+)", re.M)
TS_IMPORT = re.compile(
    r"""(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]@democracy2/([a-z0-9-]+)"""
)
# Relative imports: `from './x'`, `import('../y')`, `require('../../z')`, `import '../w'`.
REL_IMPORT = re.compile(
    r"""(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](\.{1,2}/[^'"]*)['"]"""
)
SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".svelte"}


def _source_files(module_dir: Path):
    for path in module_dir.rglob("*"):
        if any(part in SKIP_DIRS for part in path.relative_to(module_dir).parts):
            continue
        if path.is_file() and path.suffix in SOURCE_SUFFIXES:
            yield path


def _relative_targets(root: Path, path: Path, text: str):
    """Yield the top-level owner ('modules/<x>', 'spec', ...) of each relative import."""
    for spec in REL_IMPORT.findall(text):
        target = (path.parent / spec).resolve()
        try:
            parts = target.relative_to(root.resolve()).parts
        except ValueError:
            yield "outside the repo"
            continue
        if len(parts) >= 2 and parts[0] == "modules":
            yield parts[1]
        elif parts:
            yield parts[0]


def check(root: Path) -> list[str]:
    problems: list[str] = []
    modules_dir = root / "modules"
    if not modules_dir.is_dir():
        return problems
    modules = sorted(p for p in modules_dir.iterdir() if p.is_dir() and not p.name.startswith("."))
    for module in modules:
        name = module.name
        for required in REQUIRED_FILES:
            if not (module / required).is_file():
                problems.append(f"modules/{name}: missing {required}")
        for path in _source_files(module):
            text = path.read_text(encoding="utf-8", errors="replace")
            rel = path.relative_to(root)
            found = {m.replace("_", "-") for m in PY_IMPORT.findall(text)}
            found |= set(TS_IMPORT.findall(text))
            found |= set(_relative_targets(root, path, text))
            for other in sorted(found):
                if other in SHARED or other == name:
                    continue
                problems.append(
                    f"{rel}: imports module '{other}'; modules may import only spec and charter"
                )
    return problems


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    problems = check(root)
    for problem in problems:
        print(problem, file=sys.stderr)
    if problems:
        return 1
    print("boundaries: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
