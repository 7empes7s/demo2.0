"""Command line: `python -m d2_symmetry run ...` and `python -m d2_symmetry retest a.json b.json`.

Exit codes: 0 pass (or stable), 1 fail (or unstable), 2 bad input.
"""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from collections.abc import Callable, Sequence

from .judge import FakeJudge, Judge, JudgeError, LLMJudge
from .metrics import GAP_THRESHOLD_PCT, RETEST_TOLERANCE_POINTS, test_retest
from .runner import run
from .suite import SuiteError, load_suite
from .target import FakeTarget, HttpTarget, Target, TargetError

FAKE_TARGETS = {
    "symmetric": (60.0, 60.0),
    "biased": (80.0, 50.0),  # pushes harder against "yes"
}


def _command_complete(command: str) -> Callable[[str], str]:
    """A `complete` function that pipes the prompt to a command's stdin and reads its stdout."""
    argv = shlex.split(command)

    def complete(prompt: str) -> str:
        done = subprocess.run(argv, input=prompt, capture_output=True, text=True, check=True)
        return done.stdout

    return complete


def _judge(spec: str) -> Judge:
    if spec == "fake":
        return FakeJudge()
    if spec.startswith("cmd:"):
        command = spec[len("cmd:") :]
        model = shlex.split(command)[0] if command.strip() else ""
        if not model:
            raise ValueError("--judge cmd: needs a command")
        return LLMJudge(_command_complete(command), model=model)
    raise ValueError(f"unknown judge {spec!r}; use 'fake' or 'cmd:<command>'")


def _cmd_run(args: argparse.Namespace) -> int:
    suite = load_suite(args.suite)
    target: Target
    if args.fake:
        yes, no = FAKE_TARGETS[args.fake]
        target = FakeTarget(yes, no, name=f"fake-{args.fake}")
        judges: list[Judge] = [FakeJudge()]
    else:
        if not args.target:
            raise ValueError("--target URL is required unless --fake is given")
        target = HttpTarget(args.target, timeout=args.timeout)
        judges = [_judge(spec) for spec in (args.judge or [])]
        if not judges:
            raise ValueError("at least one --judge is required unless --fake is given")
    report = run(suite, target, judges, threshold=args.threshold)
    text = json.dumps(report.to_dict(), indent=2, ensure_ascii=False) + "\n"
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    else:
        sys.stdout.write(text)
    verdict = "PASS" if report.passed else "FAIL"
    print(
        f"{verdict}: median gap {report.gap_overall:.2f}% (threshold {report.threshold}%) "
        f"over {len(report.pairs)} pairs, suite {report.suite_version}",
        file=sys.stderr,
    )
    return 0 if report.passed else 1


def _cmd_retest(args: argparse.Namespace) -> int:
    reports = []
    for path in (args.first, args.second):
        with open(path, encoding="utf-8") as fh:
            reports.append(json.load(fh))
    a, b = reports
    for key in ("target", "suite_version"):
        if a.get(key) != b.get(key):
            raise ValueError(f"reports differ in {key}: {a.get(key)!r} vs {b.get(key)!r}")
    result = test_retest(a["gap_overall"], b["gap_overall"], args.tolerance)
    verdict = "STABLE" if result.stable else "UNSTABLE"
    print(
        f"{verdict}: gaps {result.first:.2f}% and {result.second:.2f}% differ by "
        f"{result.difference:.2f} points (tolerance {result.tolerance})"
    )
    return 0 if result.stable else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="d2_symmetry", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("run", help="run a suite against a target and print a SymmetryReport")
    p.add_argument("--suite", required=True, help="path to a suite JSON file")
    p.add_argument("--target", help="HTTP endpoint of the system under test")
    p.add_argument(
        "--judge",
        action="append",
        help="'fake' or 'cmd:<command>' (prompt on stdin, reply on stdout); repeat for more",
    )
    p.add_argument(
        "--fake",
        choices=sorted(FAKE_TARGETS),
        help="dry run with a fake target and fake judge (no network)",
    )
    p.add_argument("--threshold", type=float, default=GAP_THRESHOLD_PCT)
    p.add_argument("--timeout", type=float, default=60.0)
    p.add_argument("--out", help="write the report here instead of stdout")
    p.set_defaults(func=_cmd_run)

    r = sub.add_parser("retest", help="check two reports agree within the retest tolerance")
    r.add_argument("first")
    r.add_argument("second")
    r.add_argument("--tolerance", type=float, default=RETEST_TOLERANCE_POINTS)
    r.set_defaults(func=_cmd_retest)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (
        SuiteError,
        TargetError,
        JudgeError,
        ValueError,
        OSError,
        KeyError,
        subprocess.CalledProcessError,
    ) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
