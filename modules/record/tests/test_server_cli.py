import hashlib
import http.client
import json
import threading
import urllib.error
import urllib.request

import pytest
from d2_record.__main__ import main
from d2_record.entry import sign_entry
from d2_record.note import Checkpoint, Signer
from d2_record.server import make_server
from d2_record.store import Log
from d2_record.verify import check_consistency, check_inclusion

LOG_KEY = Signer("example.org/test-log", hashlib.sha256(b"server test log").digest())
ENTRY_KEY = Signer("example.org/test-signer", hashlib.sha256(b"server test signer").digest())


def entry(i: int) -> dict:
    digest = "sha256:" + hashlib.sha256(str(i).encode()).hexdigest()
    return sign_entry(ENTRY_KEY, "spend", digest, f"https://example.org/p/{i}").to_dict()


@pytest.fixture
def api(tmp_path):
    log = Log(tmp_path / "log.db", frozenset({"spend"}))
    server = make_server(log, LOG_KEY, port=0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    def call(path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(base + path, data=data)
        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read()
                return resp.status, raw if path == "/checkpoint" else json.loads(raw)
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    call.port = server.server_address[1]
    call.log = log
    yield call
    server.shutdown()
    server.server_close()


def test_http_api_round_trip(api):
    for i in range(6):
        status, body = api("/entries", entry(i))
        assert (status, body["seq"]) == (201, i)
    status, raw = api("/checkpoint")
    old = raw.decode()
    assert status == 200 and Checkpoint.verify(old, LOG_KEY.verifier).size == 6
    api("/entries", entry(6))
    new = api("/checkpoint")[1].decode()

    status, proof = api("/proof/inclusion?seq=2&size=7")
    assert status == 200
    check_inclusion(new, LOG_KEY.verifier, api("/entries/2")[1], proof)
    status, proof = api("/proof/consistency?from=6&to=7")
    check_consistency(old, new, LOG_KEY.verifier, proof)
    assert api("/healthz") == (200, {"ok": True, "size": 7})


def test_http_api_rejects_bad_requests(api):
    bad = {**entry(0), "payload_uri": "https://example.org/forged"}
    assert api("/entries", bad)[0] == 400
    assert api("/entries", {"type": "spend"})[0] == 400
    assert api("/entries/0")[0] == 404
    assert api("/proof/inclusion?seq=0&size=5")[0] == 400
    assert api("/proof/inclusion?seq=x&size=5")[0] == 400
    assert api("/proof/inclusion")[0] == 400
    assert api("/anchor?size=0")[0] == 404
    assert api("/nope")[0] == 404


def _raw_post(port: int, body: bytes, length: str | None) -> tuple[int, dict]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.putrequest("POST", "/entries")
    if length is not None:
        conn.putheader("Content-Length", length)
    conn.endheaders()
    conn.send(body)
    resp = conn.getresponse()
    out = resp.status, json.loads(resp.read())
    conn.close()
    return out


@pytest.mark.parametrize(
    ("body", "length", "status"),
    [
        (b"{}", "abc", 400),
        (b"{}", "-1", 400),
        (b"{}", "0", 400),
        (b"{}", "1e3", 400),
        (b"", None, 411),
        (b"{}", str(64 * 1024), 413),
        (b"[" * 8000 + b"]" * 8000, None, 400),  # nested too deep for the JSON parser
        (b"\xff\xfe", None, 400),
    ],
    ids=[
        "not-a-number",
        "negative",
        "zero",
        "float",
        "missing",
        "too-big",
        "deep-json",
        "not-utf8",
    ],
)
def test_malformed_posts_get_an_error_response(api, body, length, status):
    if length is None and body:
        length = str(len(body))
    code, reply = _raw_post(api.port, body, length)
    assert code == status and reply["error"]
    assert api("/healthz") == (200, {"ok": True, "size": 0})  # the server is still up


def test_a_lone_surrogate_is_rejected_with_400(api):
    bad = {**entry(0), "payload_uri": "https://example.org/\ud800"}
    body = json.dumps(bad).encode()  # ASCII JSON with a \ud800 escape
    code, reply = _raw_post(api.port, body, str(len(body)))
    assert code == 400 and "UTF-8" in reply["error"]
    assert api("/entries", entry(0))[:1] == (201,)
    assert api("/healthz") == (200, {"ok": True, "size": 1})


def test_storage_errors_get_503(api):
    api.log.db.execute("DROP TABLE nodes")
    assert api("/entries", entry(0))[0] == 503
    assert api("/healthz")[0] == 503


def test_cli_end_to_end(tmp_path, capsys):
    key, db = tmp_path / "log.key", str(tmp_path / "log.db")
    assert main(["keygen", "--name", "example.org/cli-log", "--out", str(key)]) == 0
    vkey = capsys.readouterr().out.strip()
    assert key.stat().st_mode & 0o777 == 0o600
    assert main(["keygen", "--name", "x", "--out", str(key)]) == 1  # never overwrites a key

    signer = tmp_path / "signer.key"
    main(["keygen", "--name", "example.org/cli-signer", "--out", str(signer)])
    entries = []
    for i in range(3):
        capsys.readouterr()
        main(
            [
                "sign-entry",
                "--key",
                str(signer),
                "--type",
                "spend",
                "--payload-hash",
                "sha256:" + "ab" * 32,
                "--payload-uri",
                f"https://e.org/{i}",
            ]
        )
        entries.append(json.loads(capsys.readouterr().out))
    (tmp_path / "entries.json").write_text(json.dumps(entries))
    (tmp_path / "e1.json").write_text(json.dumps(entries[1]))
    assert main(["append", "--db", db, "--entry", str(tmp_path / "entries.json")]) == 0
    capsys.readouterr()

    assert main(["checkpoint", "--db", db, "--key", str(key)]) == 0
    (tmp_path / "cp.txt").write_text(capsys.readouterr().out)
    main(["prove-inclusion", "--db", db, "--seq", "1"])
    (tmp_path / "proof.json").write_text(capsys.readouterr().out)
    args = [
        "verify-inclusion",
        "--vkey",
        vkey,
        "--checkpoint",
        str(tmp_path / "cp.txt"),
        "--entry",
        str(tmp_path / "e1.json"),
        "--proof",
        str(tmp_path / "proof.json"),
    ]
    assert main(args) == 0
    (tmp_path / "e1.json").write_text(json.dumps({**entries[1], "payload_uri": "https://x.org"}))
    assert main(args) == 1

    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({**entries[0], "type": "no.such.type"}))
    assert main(["append", "--db", db, "--entry", str(bad)]) == 1
