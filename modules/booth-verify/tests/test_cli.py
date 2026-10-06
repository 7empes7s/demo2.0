import json
from pathlib import Path

from d2_booth_verify.__main__ import main
from d2_booth_verify.vectors import mutate

VECTORS = Path(__file__).resolve().parents[3] / "spec" / "booth" / "vectors.json"


def _write(tmp_path, board, name="board.json"):
    p = tmp_path / name
    p.write_text(json.dumps(board), "utf-8")
    return str(p)


def test_ok_prints_the_tally(tmp_path, capsys, vectors):
    assert main([_write(tmp_path, vectors["board"]), "--jobs", "1"]) == 0
    out = capsys.readouterr().out
    assert out.startswith("ok: booth:test-round-1, 6 counted of 6 sign-ups, guardians 1, 3")
    assert "  yes: 3\n  no: 1\n  abstain: 2\n" in out


def test_json_output(tmp_path, capsys, vectors):
    assert main([_write(tmp_path, vectors["board"]), "--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["ok"] is True and out["tally"] == vectors["tally"]


def test_failure_exits_1_with_the_code(tmp_path, capsys, vectors):
    bad = mutate(vectors["board"], {"op": "truncate", "len": 23})
    assert main([_write(tmp_path, bad)]) == 1
    assert capsys.readouterr().out.startswith("fail: no_tally")
    assert main([_write(tmp_path, bad), "--json"]) == 1
    assert json.loads(capsys.readouterr().out)["error"] == "no_tally"


def test_repeated_key_in_file_is_malformed(tmp_path, capsys):
    p = tmp_path / "dup.json"
    p.write_text('{"schema":"d2.booth.board/1","schema":"x","entries":[]}', "utf-8")
    assert main([str(p)]) == 1
    assert capsys.readouterr().out.startswith("fail: malformed")


def test_unreadable_file_exits_2(tmp_path):
    assert main([str(tmp_path / "missing.json")]) == 2
