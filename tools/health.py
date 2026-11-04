"""Code-health ratchet: findings may go down, never up.

Five measures, each with a checked-in baseline in tools/baselines/<name>.json:

  sizes    lines per source file. A file may not grow past max(800, baseline + 5%); a file
           with no baseline entry (any file under 800 lines, and every new file) may not pass 800.
  knip     unused files, exports, types and dependencies in the npm workspaces.
  vulture  unused Python code (functions, methods, variables, imports).
  ruff     extra Python rule sets (SIM, PL) on top of the ones `ruff check` already enforces.
  eslint   type-aware TypeScript rules from eslint.config.mjs (no-floating-promises).

A baseline maps a finding key to a count. Keys leave out line numbers, so moving code does not
look like a new finding. `check` fails only when a key's count rises above its baseline.

  python tools/health.py check [--only NAME ...]    fail on new findings (tools/check.sh runs this)
  python tools/health.py ratchet [--only NAME ...]  lower the baselines to what is left after a fix
  python tools/health.py init [--only NAME ...]     rewrite a baseline from scratch (accepts all
                                                    current findings; needs a reviewer's say-so)

Baselines are written sorted, one key per line, so they diff cleanly and two runs on the same tree
produce the same bytes.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINES = ROOT / "tools" / "baselines"

NEW_FILE_MAX = 800
GROWTH_PERCENT = 5
SIZED_SUFFIXES = {".ts", ".svelte", ".py", ".rs", ".js", ".mjs", ".cjs", ".sh", ".css"}

VULTURE_PATHS = ["charter/python", "modules", "tools", "spec"]
RUFF_EXTRA = ["--select", "SIM,PL", "--ignore", "PLR2004"]

Baseline = dict[str, int]


# ---------- pure logic (unit-tested in tools/tests/test_health.py)


def size_limit(baseline: int | None) -> int:
    """The most lines a file may have, given its baseline entry (None for no entry)."""
    if baseline is None:
        return NEW_FILE_MAX
    return max(NEW_FILE_MAX, baseline * (100 + GROWTH_PERCENT) // 100)  # integers: no float drift


def size_problems(baseline: Baseline, current: Baseline) -> list[str]:
    out = []
    for path, lines in sorted(current.items()):
        limit = size_limit(baseline.get(path))
        if lines > limit:
            was = baseline.get(path)
            why = f"baseline {was} + 5%" if was is not None else f"no baseline: {NEW_FILE_MAX}"
            out.append(f"{path}: {lines} lines, budget {limit} ({why})")
    return out


def size_ratchet(baseline: Baseline, current: Baseline) -> Baseline:
    """Shrink each entry to the file's current size; drop files that are gone or under the cap."""
    out = {}
    for path, was in baseline.items():
        now = min(was, current.get(path, 0))
        if now > NEW_FILE_MAX:
            out[path] = now
    return out


def size_init(current: Baseline) -> Baseline:
    return {p: n for p, n in current.items() if n > NEW_FILE_MAX}


def count_problems(baseline: Baseline, current: Baseline) -> list[str]:
    out = []
    for key, n in sorted(current.items()):
        extra = n - baseline.get(key, 0)
        if extra > 0:
            out.append(f"{key}" + (f" (+{extra})" if n > 1 else ""))
    return out


def count_ratchet(baseline: Baseline, current: Baseline) -> Baseline:
    """Lower each count to what is left; never raise one and never add a key."""
    out = {}
    for key, was in baseline.items():
        now = min(was, current.get(key, 0))
        if now > 0:
            out[key] = now
    return out


def count_init(current: Baseline) -> Baseline:
    return {k: n for k, n in current.items() if n > 0}


def stale(baseline: Baseline, ratcheted: Baseline) -> int:
    """How many units the baseline would drop by if it were ratcheted now."""
    return sum(baseline.values()) - sum(ratcheted.values())


def dumps(baseline: Baseline) -> str:
    return json.dumps(dict(sorted(baseline.items())), indent=2) + "\n"


# ---------- parsers for each tool's output


def parse_knip(report: str) -> Baseline:
    """`knip --reporter json` -> {"<kind>:<file>:<name>": count}."""
    found: Counter[str] = Counter()
    for issue in json.loads(report)["issues"]:
        file = issue["file"]
        for kind, items in sorted(issue.items()):
            if not isinstance(items, list):
                continue
            for item in items:
                if isinstance(item, list):  # duplicates: one list of names per duplicated export
                    name = "|".join(sorted(i["name"] for i in item))
                else:
                    name = item["name"]
                found[f"{kind}:{file}:{name}"] += 1
    return dict(found)


_VULTURE_LINE = re.compile(r"^(?P<path>[^:]+):\d+: (?P<what>.+?) \(\d+% confidence")


def parse_vulture(report: str) -> Baseline:
    """vulture's text output -> {"<file>:<what>": count}, e.g. "a.py:unused function 'f'"."""
    found: Counter[str] = Counter()
    for line in report.splitlines():
        m = _VULTURE_LINE.match(line)
        if m:
            found[f"{m['path']}:{m['what']}"] += 1
        elif line.strip():
            raise ValueError(f"unexpected vulture output: {line}")
    return dict(found)


def parse_ruff(report: str, root: Path) -> Baseline:
    """`ruff check --output-format json` -> {"<file>:<code>": count}."""
    found: Counter[str] = Counter()
    for d in json.loads(report):
        found[f"{_rel(d['filename'], root)}:{d['code']}"] += 1
    return dict(found)


def parse_eslint(report: str, root: Path) -> Baseline:
    """`eslint --format json` -> {"<file>:<rule>": count}; parse errors count as "parse-error"."""
    found: Counter[str] = Counter()
    for f in json.loads(report):
        for m in f["messages"]:
            found[f"{_rel(f['filePath'], root)}:{m.get('ruleId') or 'parse-error'}"] += 1
    return dict(found)


def _rel(path: str, root: Path) -> str:
    p = Path(path)
    return p.resolve().relative_to(root.resolve()).as_posix() if p.is_absolute() else p.as_posix()


# ---------- collectors (run the tools on the repo)


def _run(cmd: list[str], ok: tuple[int, ...] = (0,)) -> str:
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if r.returncode not in ok:
        sys.exit(f"health: {' '.join(cmd)} exited {r.returncode}\n{r.stderr or r.stdout}")
    return r.stdout


def _node_bin(name: str) -> str:
    path = ROOT / "node_modules" / ".bin" / name
    if not path.exists():
        sys.exit(f"health: {path.relative_to(ROOT)} is missing; run tools/dev-setup.sh")
    return str(path)


def collect_sizes() -> Baseline:
    listed = _run(["git", "ls-files", "--cached", "--others", "--exclude-standard"])
    out = {}
    for rel in listed.splitlines():
        p = ROOT / rel
        if p.suffix in SIZED_SUFFIXES and p.is_file():
            with p.open("rb") as f:
                out[rel] = sum(1 for _ in f)
    return out


def collect_knip() -> Baseline:
    # knip exits 1 when it finds anything; the ratchet decides what is new.
    return parse_knip(_run([_node_bin("knip"), "--reporter", "json", "--no-progress"], ok=(0, 1)))


def collect_vulture() -> Baseline:
    cmd = [sys.executable, "-m", "vulture", *VULTURE_PATHS, "--exclude", ".venv,node_modules"]
    return parse_vulture(_run(cmd, ok=(0, 3)))  # 3: dead code found


def collect_ruff() -> Baseline:
    cmd = [sys.executable, "-m", "ruff", "check", ".", *RUFF_EXTRA]
    return parse_ruff(_run([*cmd, "--output-format", "json", "--exit-zero"]), ROOT)


def collect_eslint() -> Baseline:
    return parse_eslint(_run([_node_bin("eslint"), "--format", "json", "."], ok=(0, 1)), ROOT)


Measure = tuple[
    Callable[[], Baseline],
    Callable[[Baseline, Baseline], list[str]],
    Callable[[Baseline, Baseline], Baseline],
    Callable[[Baseline], Baseline],
    str,
]

MEASURES: dict[str, Measure] = {
    "sizes": (collect_sizes, size_problems, size_ratchet, size_init, "file over its line budget"),
    "knip": (collect_knip, count_problems, count_ratchet, count_init, "new unused TypeScript code"),
    "vulture": (collect_vulture, count_problems, count_ratchet, count_init, "new dead Python code"),
    "ruff": (collect_ruff, count_problems, count_ratchet, count_init, "new ruff SIM/PL finding"),
    "eslint": (collect_eslint, count_problems, count_ratchet, count_init, "new eslint finding"),
}


def _load(name: str) -> Baseline:
    path = BASELINES / f"{name}.json"
    return json.loads(path.read_text()) if path.exists() else {}


def _save(name: str, baseline: Baseline) -> None:
    BASELINES.mkdir(parents=True, exist_ok=True)
    (BASELINES / f"{name}.json").write_text(dumps(baseline))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("command", choices=["check", "ratchet", "init"])
    ap.add_argument("--only", nargs="+", choices=sorted(MEASURES), default=list(MEASURES))
    args = ap.parse_args(argv)

    failed = False
    for name in args.only:
        collect, problems, ratchet, init, label = MEASURES[name]
        current = collect()
        baseline = _load(name)
        if args.command == "init":
            fresh = init(current)
            _save(name, fresh)
            print(f"{name}: baseline rewritten ({len(fresh)} entries)")
            continue
        lowered = ratchet(baseline, current)
        if args.command == "ratchet":
            if lowered != baseline:
                _save(name, lowered)
            print(f"{name}: baseline lowered by {stale(baseline, lowered)}")
            continue
        found = problems(baseline, current)
        for p in found:
            print(f"{name}: {label}: {p}")
        failed |= bool(found)
        drop = stale(baseline, lowered)
        note = f"; {drop} fixed, run `tools/health.py ratchet` to lock that in" if drop else ""
        print(f"{name}: {'FAIL' if found else 'ok'}{note}")
    if failed:
        print(
            "health: fix the new findings above. If one is a false positive, say why in the PR and "
            "add it with `python tools/health.py init --only <name>` (reviewer's call)."
        )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
