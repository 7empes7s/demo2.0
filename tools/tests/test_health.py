import importlib.util
import json
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "health", Path(__file__).resolve().parent.parent / "health.py"
)
health = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(health)


def test_size_budget_is_800_or_baseline_plus_five_percent():
    assert health.size_limit(None) == 800
    assert health.size_limit(900) == 945
    assert health.size_limit(2278) == 2391
    assert health.size_limit(760) == 800  # never below the allowance every file has


def test_size_problems_flag_growth_and_big_new_files():
    baseline = {"big.ts": 1000}
    assert health.size_problems(baseline, {"big.ts": 1050, "small.py": 800}) == []
    found = health.size_problems(baseline, {"big.ts": 1051, "new.py": 801})
    assert found == [
        "big.ts: 1051 lines, budget 1050 (baseline 1000 + 5%)",
        "new.py: 801 lines, budget 800 (no baseline: 800)",
    ]


def test_size_ratchet_only_lowers():
    baseline = {"a.ts": 1000, "b.ts": 1000, "gone.ts": 1000, "c.ts": 900}
    current = {"a.ts": 1040, "b.ts": 950, "c.ts": 700}
    assert health.size_ratchet(baseline, current) == {"a.ts": 1000, "b.ts": 950}


def test_size_init_keeps_only_files_over_the_cap():
    assert health.size_init({"a.ts": 801, "b.ts": 800}) == {"a.ts": 801}


def test_counts_fail_only_on_new_findings():
    baseline = {"x:a": 2, "x:b": 1}
    assert health.count_problems(baseline, {"x:a": 2}) == []
    assert health.count_problems(baseline, {"x:a": 3, "x:c": 1}) == ["x:a (+1)", "x:c"]


def test_count_ratchet_lowers_and_never_adds():
    baseline = {"x:a": 2, "x:b": 1, "x:c": 4}
    current = {"x:a": 1, "x:c": 9, "x:new": 1}
    lowered = health.count_ratchet(baseline, current)
    assert lowered == {"x:a": 1, "x:c": 4}
    assert health.stale(baseline, lowered) == 2


def test_ratchet_is_idempotent():
    baseline, current = {"x:a": 3, "x:b": 1}, {"x:a": 1}
    once = health.count_ratchet(baseline, current)
    assert health.count_ratchet(once, current) == once
    sizes, now = {"a.ts": 1200}, {"a.ts": 1100}
    assert health.size_ratchet(health.size_ratchet(sizes, now), now) == {"a.ts": 1100}


def test_dumps_is_deterministic():
    a = health.dumps({"b": 1, "a": 2})
    b = health.dumps(dict(reversed(list({"b": 1, "a": 2}.items()))))
    assert a == b == '{\n  "a": 2,\n  "b": 1\n}\n'


def test_checked_in_baselines_are_canonical():
    # A hand edit that leaves a baseline unsorted or non-canonical would make the next ratchet
    # rewrite the whole file; keep them in the exact form the script writes.
    for path in sorted((health.ROOT / "tools" / "baselines").glob("*.json")):
        text = path.read_text()
        assert health.dumps(json.loads(text)) == text, path.name
        assert all(isinstance(n, int) and n > 0 for n in json.loads(text).values()), path.name
    names = {p.stem for p in (health.ROOT / "tools" / "baselines").glob("*.json")}
    assert names == set(health.MEASURES)


def test_parse_knip_ignores_lines_and_keys_by_kind_file_name():
    report = {
        "issues": [
            {
                "file": "a/x.ts",
                "exports": [{"name": "A", "line": 3}, {"name": "B", "line": 9}],
                "types": [],
                "duplicates": [[{"name": "isP"}, {"name": "is_p"}]],
                "files": [{"name": "a/x.ts"}],
                "owners": "not-a-list",
            }
        ]
    }
    assert health.parse_knip(json.dumps(report)) == {
        "duplicates:a/x.ts:isP|is_p": 1,
        "exports:a/x.ts:A": 1,
        "exports:a/x.ts:B": 1,
        "files:a/x.ts:a/x.ts": 1,
    }


def test_parse_vulture_counts_repeats_and_drops_line_numbers():
    out = (
        "m/server.py:121: unused attribute 'close_connection' (60% confidence)\n"
        "m/server.py:202: unused attribute 'close_connection' (60% confidence)\n"
        "m/a.py:7: unused function 'dead' (60% confidence, 2 lines)\n"
    )
    assert health.parse_vulture(out) == {
        "m/server.py:unused attribute 'close_connection'": 2,
        "m/a.py:unused function 'dead'": 1,
    }


def test_parse_vulture_rejects_unknown_output():
    with pytest.raises(ValueError):
        health.parse_vulture("Traceback (most recent call last):\n")


def test_parse_ruff_and_eslint_relativise_paths(tmp_path):
    ruff = [{"filename": str(tmp_path / "m" / "a.py"), "code": "SIM105"}] * 2
    assert health.parse_ruff(json.dumps(ruff), tmp_path) == {"m/a.py:SIM105": 2}
    eslint = [
        {
            "filePath": str(tmp_path / "t" / "x.test.ts"),
            "messages": [{"ruleId": "@typescript-eslint/no-floating-promises"}, {"ruleId": None}],
        }
    ]
    assert health.parse_eslint(json.dumps(eslint), tmp_path) == {
        "t/x.test.ts:@typescript-eslint/no-floating-promises": 1,
        "t/x.test.ts:parse-error": 1,
    }


def test_sizes_collector_matches_its_baseline():
    # Runs on the real tree: every file in the size baseline exists and is measured.
    current = health.collect_sizes()
    for path in json.loads((health.ROOT / "tools" / "baselines" / "sizes.json").read_text()):
        assert path in current
