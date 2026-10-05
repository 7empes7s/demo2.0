"""OpenTimestamps anchoring against a local fake calendar and a fake block explorer."""

import hashlib
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from d2_record import ots
from d2_record.__main__ import main
from d2_record.entry import sign_entry
from d2_record.note import Signer, checkpoint_hash
from d2_record.store import Log

HEIGHT = 900_123


def _varbytes(b: bytes) -> bytes:
    out = io.BytesIO()
    ots._write_varbytes(out, b)
    return out.getvalue()


class Fake:
    """One fake calendar plus a fake Esplora, sharing state."""

    def __init__(self, nonce: bytes):
        self.nonce = nonce
        self.confirmed = False
        self.commitments: list[bytes] = []
        self.merkle_root_override: str | None = None
        self.block_body_override: bytes | None = None
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, status, body=b"", ctype="application/octet-stream"):
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                digest = self.rfile.read(int(self.headers["Content-Length"]))
                if self.path != "/digest" or len(digest) != 32:
                    return self._send(400)
                commitment = hashlib.sha256(digest + fake.nonce).digest()
                fake.commitments.append(commitment)
                uri = _varbytes(fake.url.encode())
                body = b"\xf0" + _varbytes(fake.nonce) + b"\x08" + b"\x00" + ots.PENDING
                self._send(200, body + _varbytes(uri))

            def do_GET(self):
                if self.path.startswith("/timestamp/"):
                    c = bytes.fromhex(self.path[11:])
                    if c not in fake.commitments or not fake.confirmed:
                        return self._send(404)
                    height = io.BytesIO()
                    ots._write_varuint(height, HEIGHT)
                    body = b"\xf1" + _varbytes(b"block-path") + b"\x08\x00" + ots.BITCOIN
                    return self._send(200, body + _varbytes(height.getvalue()))
                if self.path == f"/block-height/{HEIGHT}":
                    return self._send(200, b"ab" * 32, "text/plain")
                if self.path == "/block/" + "ab" * 32 and fake.block_body_override is not None:
                    return self._send(200, fake.block_body_override, "application/json")
                if self.path == "/block/" + "ab" * 32:
                    root = fake.merkle_root_override or fake.block_merkle_root().hex()
                    body = json.dumps({"merkle_root": root, "timestamp": 1_790_000_000})
                    return self._send(200, body.encode(), "application/json")
                self._send(404)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def block_merkle_root(self) -> bytes:
        msg = hashlib.sha256(b"block-path" + self.commitments[-1]).digest()
        return msg[::-1]  # explorers show the merkle root byte-reversed

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def fakes():
    made = [Fake(b"n" * 16), Fake(b"m" * 16)]
    yield made
    for f in made:
        f.close()


DIGEST = hashlib.sha256(b"a checkpoint").digest()


def test_stamp_upgrade_verify(fakes):
    cal = fakes[0]
    receipt, errors = ots.stamp(DIGEST, [cal.url])
    assert errors == []
    assert receipt.startswith(ots.HEADER_MAGIC)
    digest, root = ots.parse_ots(receipt)
    assert digest == DIGEST
    assert ots.serialize_ots(digest, root) == receipt

    report = ots.verify(receipt, DIGEST, esplora=cal.url)
    assert report.pending == [cal.url] and not report.verified

    same, changed, errors = ots.upgrade(receipt, [cal.url])
    assert (same, changed, errors) == (receipt, False, [])

    cal.confirmed = True
    upgraded, changed, errors = ots.upgrade(receipt, [cal.url])
    assert changed and errors == []
    report = ots.verify(upgraded, DIGEST, esplora=cal.url)
    assert report.pending == []
    assert report.verified
    assert report.bitcoin[0]["height"] == HEIGHT
    assert report.bitcoin[0]["block_time"] == 1_790_000_000

    cal.merkle_root_override = "00" * 32
    assert not ots.verify(upgraded, DIGEST, esplora=cal.url).verified
    with pytest.raises(ots.OtsError, match="different checkpoint"):
        ots.verify(upgraded, hashlib.sha256(b"other").digest(), esplora=None)


def test_two_calendars_merge_and_one_failing_is_tolerated(fakes):
    dead = "http://127.0.0.1:9"  # discard port: nothing listens
    receipt, errors = ots.stamp(DIGEST, [fakes[0].url, dead, fakes[1].url])
    assert len(errors) == 1 and dead in errors[0]
    report = ots.verify(receipt, DIGEST, esplora=None)
    assert sorted(report.pending) == sorted(f.url for f in fakes)
    assert receipt.count(b"\xff") >= 1  # a fork in the proof tree
    with pytest.raises(ots.OtsError, match="calendars answered"):
        ots.stamp(DIGEST, [dead])


def test_upgrade_contacts_only_allowed_calendars(fakes):
    receipt, _ = ots.stamp(DIGEST, [fakes[0].url])
    fakes[0].confirmed = True
    out, changed, errors = ots.upgrade(receipt, ["https://a.pool.opentimestamps.org"])
    assert (out, changed) == (receipt, False)
    assert "not an allowed calendar" in errors[0]


def test_a_malformed_pending_attestation_is_skipped_not_fatal(fakes):
    cal = fakes[0]
    receipt, _ = ots.stamp(DIGEST, [cal.url])
    cal.confirmed = True
    upgraded, changed, _ = ots.upgrade(receipt, [cal.url])
    assert changed
    digest, root = ots.parse_ots(upgraded)
    root.attestations.append((ots.PENDING, _varbytes(b"https://\xff\xfe")))
    hostile = ots.serialize_ots(digest, root)

    report = ots.verify(hostile, DIGEST, esplora=cal.url)
    assert report.verified
    assert report.pending == [] and "not ASCII" in report.errors[0]
    out, changed, errors = ots.upgrade(hostile, [cal.url])
    assert (out, changed) == (hostile, False)
    assert "not ASCII" in errors[0]


def test_a_non_object_block_reply_is_an_ots_error(fakes):
    cal = fakes[0]
    receipt, _ = ots.stamp(DIGEST, [cal.url])
    cal.confirmed = True
    upgraded, _, _ = ots.upgrade(receipt, [cal.url])
    for body in (b"[]", b"not json"):
        cal.block_body_override = body
        with pytest.raises(ots.OtsError, match="reply is not"):
            ots.verify(upgraded, DIGEST, esplora=cal.url)


@pytest.mark.parametrize(
    "data",
    [
        b"not a proof",
        ots.HEADER_MAGIC + b"\x02\x08" + b"\x00" * 32 + b"\x00" + ots.PENDING + b"\x00",
        ots.HEADER_MAGIC + b"\x01\x08" + b"\x00" * 32 + b"\x7a",
        ots.HEADER_MAGIC + b"\x01\x08" + b"\x00" * 31,
        ots.HEADER_MAGIC + b"\x01\x08" + b"\x00" * 32 + b"\xf0\x00\x00",
    ],
)
def test_malformed_receipts_are_rejected(data):
    with pytest.raises(ots.OtsError):
        ots.parse_ots(data)


def test_cli_anchor_upgrade_verify(tmp_path, fakes, capsys):
    cal = fakes[0]
    log_key = Signer("example.org/anchor-log", hashlib.sha256(b"anchor log").digest())
    key_file = tmp_path / "log.key"
    key_file.write_text(log_key.encode())
    db = str(tmp_path / "log.db")
    signer = Signer("example.org/s", hashlib.sha256(b"s").digest())
    log = Log(db)
    log.append(sign_entry(signer, "spend", "sha256:" + "cd" * 32, "https://e.org/1"))
    note = log.checkpoint(log_key)
    log.close()
    cp = tmp_path / "cp.txt"
    cp.write_text(note)
    out = tmp_path / "cp.ots"

    assert main(["anchor", "--db", db, "--calendar", cal.url, "--out", str(out)]) == 0
    assert checkpoint_hash(note).hex() in capsys.readouterr().out
    verify = [
        "verify-anchor",
        "--checkpoint",
        str(cp),
        "--ots",
        str(out),
        "--vkey",
        log_key.verifier.encode(),
        "--esplora",
        cal.url,
    ]
    assert main(verify) == 3  # pending only
    assert main(["upgrade-anchor", "--db", db, "--calendar", cal.url, "--out", str(out)]) == 0
    assert "no change" in capsys.readouterr().out
    cal.confirmed = True
    assert main(["upgrade-anchor", "--db", db, "--calendar", cal.url, "--out", str(out)]) == 0
    assert main(verify) == 0
    assert f"bitcoin block {HEIGHT}: verified" in capsys.readouterr().out
    cal.merkle_root_override = "00" * 32
    assert main(verify) == 1
    assert Log(db).anchor(1) == out.read_bytes()
