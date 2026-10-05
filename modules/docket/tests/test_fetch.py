import io
import urllib.error
from email.message import Message

import pytest
from d2_docket import fetch


class FakeResponse(io.BytesIO):
    def __init__(self, body: bytes, mime: str = "text/html"):
        super().__init__(body)
        self.headers = Message()
        self.headers["Content-Type"] = mime

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class ScriptedFetcher(fetch.Fetcher):
    def __init__(self, script):
        super().__init__(delay=0, retries=3)
        self.script, self.calls = list(script), 0

    def _open(self, req):
        self.calls += 1
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(fetch.time, "sleep", lambda s: None)


def http_error(code):
    return urllib.error.HTTPError("https://x", code, "err", Message(), None)


def test_success_records_hash_and_mime():
    f = ScriptedFetcher([FakeResponse(b"hello", "application/pdf")])
    got = f.get("https://x")
    assert got.mime == "application/pdf"
    assert got.sha256 == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"


def test_not_found_is_not_retried():
    f = ScriptedFetcher([http_error(404), FakeResponse(b"late")])
    with pytest.raises(RuntimeError, match="could not fetch"):
        f.get("https://x")
    assert f.calls == 1


def test_server_errors_and_429_are_retried():
    f = ScriptedFetcher([http_error(503), http_error(429), FakeResponse(b"ok")])
    assert f.get("https://x").body == b"ok"
    assert f.calls == 3


def test_oversized_body_is_refused(monkeypatch):
    monkeypatch.setattr(fetch, "MAX_BYTES", 4)
    f = ScriptedFetcher([FakeResponse(b"too large")])
    with pytest.raises(RuntimeError, match="larger than"):
        f.get("https://x")
    assert f.calls == 1
