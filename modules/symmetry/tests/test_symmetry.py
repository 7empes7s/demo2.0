import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
from d2_symmetry import (
    FakeJudge,
    FakeTarget,
    HttpTarget,
    LLMJudge,
    PairScore,
    generate_pairs,
    load_suite,
    pair_gap,
    parse_suite,
    run,
    test_retest,
)
from d2_symmetry.cli import main
from d2_symmetry.judge import RUBRIC_VERSION, JudgeError, parse_score, render_rubric
from d2_symmetry.metrics import gap_by_topic, gap_overall
from d2_symmetry.report import REPORT_FIELDS
from d2_symmetry.suite import SuiteError

SUITE = Path(__file__).resolve().parent.parent / "suites" / "v0.json"


@pytest.fixture(scope="module")
def suite():
    return load_suite(SUITE)


# --- suite ---------------------------------------------------------------------------------


def test_seed_suite_has_twelve_mirrored_scenarios(suite):
    assert suite.suite_version == "v0"
    assert len(suite.scenarios) == 12
    for s in suite.scenarios:
        assert len(s.yes) == len(s.no) >= 1


def test_pairs_differ_only_in_position(suite):
    pairs = generate_pairs(suite)
    per_scenario = len(suite.personas) * len(suite.scenarios[0].yes)
    assert len(pairs) == len(suite.scenarios) * per_scenario
    assert len({p.id for p in pairs}) == len(pairs)
    persona_prefix = {p.id: p.prefix for p in suite.personas}
    for p in pairs:
        prefix = persona_prefix[p.persona_id]
        assert p.yes_message.startswith(prefix) and p.no_message.startswith(prefix)
        assert p.yes_message != p.no_message


def test_suite_rejects_unmirrored_positions():
    doc = {
        "format": "d2-symmetry-suite/1",
        "suite_version": "t",
        "scenarios": [
            {
                "id": "a",
                "topic": "t",
                "matter": "m",
                "positions": {"yes": ["y1", "y2"], "no": ["n1"]},
            }
        ],
    }
    with pytest.raises(SuiteError, match="mirrored"):
        parse_suite(doc)


def test_suite_rejects_unknown_format():
    with pytest.raises(SuiteError, match="format"):
        parse_suite({"format": "other/1", "suite_version": "v", "scenarios": []})


# --- gap math ------------------------------------------------------------------------------


def test_pair_gap_math():
    assert pair_gap(80, 40) == pytest.approx(50.0)
    assert pair_gap(40, 80) == pytest.approx(50.0)
    assert pair_gap(60, 60) == 0.0
    assert pair_gap(0, 0) == 0.0
    assert pair_gap(100, 0) == pytest.approx(100.0)
    assert pair_gap(50, 48) == pytest.approx(4.0)
    with pytest.raises(ValueError):
        pair_gap(101, 50)


def test_median_overall_and_by_topic():
    scores = [
        PairScore("a", "t1", 50, 50),  # 0
        PairScore("b", "t1", 50, 40),  # 20
        PairScore("c", "t2", 100, 90),  # 10
    ]
    assert gap_overall(scores) == pytest.approx(10.0)
    assert gap_by_topic(scores) == pytest.approx({"t1": 10.0, "t2": 10.0})
    assert scores[1].leans == "yes" and scores[0].leans == "even"


# --- end to end with fakes -----------------------------------------------------------------


def test_biased_target_fails_threshold(suite):
    report = run(suite, FakeTarget(strength_yes=80, strength_no=50), [FakeJudge()])
    assert report.gap_overall == pytest.approx(37.5)
    assert not report.passed
    assert all(p.leans == "yes" for p in report.pairs)


def test_slightly_biased_target_just_over_threshold_fails(suite):
    report = run(suite, FakeTarget(strength_yes=60, strength_no=57), [FakeJudge()])
    assert report.gap_overall == pytest.approx(5.0)
    assert not report.passed  # threshold is strict: under 5%


def test_symmetric_target_passes(suite):
    report = run(suite, FakeTarget(strength_yes=60, strength_no=60), [FakeJudge()])
    assert report.gap_overall == 0.0
    assert report.passed
    assert set(report.gap_by_topic) == {s.topic for s in suite.scenarios}


def test_report_schema_shape(suite):
    report = run(suite, FakeTarget(60, 58, name="t"), [FakeJudge()]).to_dict()
    for key in REPORT_FIELDS:
        assert key in report
    assert report["target"] == "t"
    assert report["suite_version"] == "v0"
    assert isinstance(report["gap_overall"], float)
    assert all(isinstance(v, float) for v in report["gap_by_topic"].values())
    assert report["raters"] == ["fake-judge"]
    assert report["record_seq"] is None
    assert report["pair_count"] == len(report["pairs"]) == len(generate_pairs(suite))
    json.dumps(report)  # serialisable


def test_retest_within_one_point(suite):
    first = run(suite, FakeTarget(60, 58), [FakeJudge()])
    second = run(suite, FakeTarget(60, 58), [FakeJudge()])
    assert test_retest(first.gap_overall, second.gap_overall).stable
    drifted = run(suite, FakeTarget(60, 57), [FakeJudge()])
    result = test_retest(first.gap_overall, drifted.gap_overall)
    assert not result.stable
    assert result.difference > 1.0


def test_retest_boundary():
    assert test_retest(3.0, 4.0).stable
    assert not test_retest(3.0, 4.01).stable


# --- judges --------------------------------------------------------------------------------


def test_llm_judge_uses_versioned_blind_rubric():
    seen = []

    def complete(prompt: str) -> str:
        seen.append(prompt)
        return "SCORE: 42"

    judge = LLMJudge(complete, model="m")
    assert judge.score("the matter", "I'm against it.", "Consider X.") == 42.0
    assert RUBRIC_VERSION in seen[0]
    assert "the matter" in seen[0] and "Consider X." in seen[0]
    assert seen[0] == render_rubric("the matter", "I'm against it.", "Consider X.")
    assert judge.name == f"llm-judge:m:{RUBRIC_VERSION}"


def test_parse_score_rejects_garbage():
    with pytest.raises(JudgeError):
        parse_score("I think it's about medium")
    with pytest.raises(JudgeError):
        parse_score("SCORE: 150")


def test_multiple_judges_are_averaged(suite):
    class Fixed:
        def __init__(self, value):
            self.value = value
            self.name = f"fixed-{value}"

        def score(self, matter, user_message, pushback):
            return self.value

    report = run(suite, FakeTarget(1, 1), [Fixed(40), Fixed(60)])
    assert report.raters == ["fixed-40", "fixed-60"]
    assert all(p.against_yes == 50 for p in report.pairs)


# --- HTTP target (localhost only) ----------------------------------------------------------


def test_http_target_posts_json():
    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            received.append(body)
            out = json.dumps({"pushback": f"pushback for {body['user_position']}"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        target = HttpTarget(f"http://127.0.0.1:{server.server_port}/pushback", timeout=5)
        assert target.respond("m", "no", "I'm against it.") == "pushback for no"
    finally:
        server.shutdown()
        server.server_close()
    assert received == [{"matter": "m", "user_position": "no", "user_message": "I'm against it."}]


def test_http_target_rejects_non_http():
    with pytest.raises(ValueError):
        HttpTarget("file:///etc/passwd")


# --- CLI -----------------------------------------------------------------------------------


def test_cli_fake_modes(tmp_path):
    out = tmp_path / "sym.json"
    assert main(["run", "--suite", str(SUITE), "--fake", "symmetric", "--out", str(out)]) == 0
    report = json.loads(out.read_text())
    assert report["passed"] is True and report["target"] == "fake-symmetric"
    assert main(["run", "--suite", str(SUITE), "--fake", "biased", "--out", str(out)]) == 1


def test_cli_retest(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    main(["run", "--suite", str(SUITE), "--fake", "symmetric", "--out", str(a)])
    main(["run", "--suite", str(SUITE), "--fake", "symmetric", "--out", str(b)])
    assert main(["retest", str(a), str(b)]) == 0


def test_cli_requires_target_or_fake():
    assert main(["run", "--suite", str(SUITE)]) == 2
