import json

from d2_lottery import KNOWN_CHAINS
from d2_lottery.__main__ import main


def _write(tmp_path, name, obj):
    path = tmp_path / name
    path.write_text(json.dumps(obj))
    return str(path)


def test_commit_draw_verify_round_trip(tmp_path, capsys, vectors, recorded):
    pool = vectors["draws"][0]["transcript"]["pool"]
    beacon = recorded["default-mainnet-2634945"]["beacon"]
    chain = KNOWN_CHAINS["default"]
    pool_path = _write(tmp_path, "pool.json", pool)

    assert main(["pool-root", "--pool", pool_path]) == 0
    root = json.loads(capsys.readouterr().out)
    assert root["size"] == 20

    now = chain.round_time(beacon["round"]) - 3600
    args = [
        "commit",
        "--pool",
        pool_path,
        "--purpose",
        "review-panel",
        "--context",
        "m-9",
        "--size",
        "5",
        "--tier",
        "local",
        "--chain",
        "default",
        "--now",
        str(now),
    ]
    assert main(args) == 0
    commitment = json.loads(capsys.readouterr().out)
    assert commitment["round"] == beacon["round"]
    assert commitment["pool_root"] == root["root"]

    c_path = _write(tmp_path, "c.json", commitment)
    b_path = _write(tmp_path, "b.json", beacon)
    assert main(["draw", "--commitment", c_path, "--pool", pool_path, "--beacon", b_path]) == 0
    transcript = json.loads(capsys.readouterr().out)
    assert len(transcript["result"]["selected"]) == 5

    t_path = _write(tmp_path, "t.json", transcript)
    assert main(["verify", "--transcript", t_path]) == 0
    assert capsys.readouterr().out.startswith("ok: 5 selected from 20")

    declined = transcript["result"]["selected"][0]
    assert main(["panel", "--transcript", t_path, "--declined", declined]) == 0
    after = json.loads(capsys.readouterr().out)
    assert declined not in after["members"] and len(after["members"]) == 5

    transcript["result"]["selected"].reverse()
    assert main(["verify", "--transcript", _write(tmp_path, "bad.json", transcript)]) == 1


def test_verify_needs_explicit_trust_for_other_chains(tmp_path, capsys, vectors, recorded):
    d = next(d for d in vectors["draws"] if d["name"] == "stratified-walkthrough")
    t_path = _write(tmp_path, "t.json", d["transcript"])
    assert main(["verify", "--transcript", t_path]) == 1
    assert "not trusted" in capsys.readouterr().err
    info = _write(tmp_path, "info.json", recorded["walkthrough-rfc9380-38"]["chain_info"])
    assert main(["verify", "--transcript", t_path, "--chain-info", info]) == 0


def test_prove_member(tmp_path, capsys, vectors):
    pool_path = _write(tmp_path, "pool.json", vectors["pool"]["members"])
    nym = vectors["pool"]["members"][2]["nym"]
    assert main(["prove-member", "--pool", pool_path, "--nym", nym]) == 0
    proof = json.loads(capsys.readouterr().out)
    assert proof["member"]["nym"] == nym
