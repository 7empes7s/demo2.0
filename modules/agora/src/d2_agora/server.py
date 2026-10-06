"""A minimal stdlib HTTP API. Bind it to loopback: v1 trusts the caller's participant ids.

POST /ideas                {participant, jurisdiction_id, topic_ids?, title, text}
                           -> 201 Idea (spec/schemas/idea.schema.json)
POST /ideas/<id>/upvote    {participant} -> 201 {idea_id, upvoted: true}
                                         -> 409 {error, code: "duplicate_upvote"}
GET  /ideas/<id>           -> 200 Idea
GET  /queue?jurisdiction=<id>&jurisdiction=<id>&limit=<n>
                           -> 200 {charter_version, ideas: [Idea, ...]} in queue order
GET  /healthz              -> {ok, ideas}

Errors are {error, code}: 400 bad input, 404 unknown idea or path, 408 body too slow,
409 duplicate upvote, 411 no Content-Length, 413 body over MAX_BODY, 500 internal (no details),
503 too many connections.
"""

from __future__ import annotations

import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from .agora import Agora, AgoraError

# A maximum-length post (5 languages x (200 + 4,000) characters) with every character sent as a
# JSON \u escape of a surrogate pair is 21,000 x 12 = 252,000 bytes, plus under 3 KB for the
# other fields (test_a_maximum_length_escaped_post_fits). 256 KiB leaves room for that.
MAX_BODY = 256 * 1024
TIMEOUT = 10.0  # seconds a client may take to send its whole body (and each header read)
MAX_CONNECTIONS = 32  # connections handled at once; more get 503
_IDEA = re.compile(r"/ideas/([0-9A-Z]{26})")
_UPVOTE = re.compile(r"/ideas/([0-9A-Z]{26})/upvote")


class _BoundedServer(ThreadingHTTPServer):
    """ThreadingHTTPServer with at most `max_connections` handler threads."""

    daemon_threads = True

    def __init__(self, address, handler, max_connections: int) -> None:
        self._slots = threading.BoundedSemaphore(max_connections)
        super().__init__(address, handler)

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            try:
                body = b'{"error": "too many connections", "code": "busy"}'
                request.sendall(
                    b"HTTP/1.0 503 Service Unavailable\r\nContent-Type: application/json\r\n"
                    b"Content-Length: %d\r\nConnection: close\r\n\r\n%s" % (len(body), body)
                )
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()


def make_server(
    agora: Agora,
    host: str = "127.0.0.1",
    port: int = 8091,
    timeout: float = TIMEOUT,
    max_connections: int = MAX_CONNECTIONS,
) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        server_version = "d2-agora/0.1"

        def setup(self):
            self.timeout = timeout  # a slow or short body cannot hold a thread forever
            super().setup()

        def log_message(self, format, *args):  # noqa: A002 - stdlib signature
            pass

        def _json(self, status: int, obj: object) -> None:
            body = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _error(self, status: int, code: str, message: str) -> None:
            self._json(status, {"error": message, "code": code})

        def _internal(self) -> None:
            # Never echo the exception: it can carry paths or SQL.
            self.close_connection = True
            self._error(500, "internal", "internal error")

        def _read_body(self, length: int) -> bytes | None:
            """Read `length` bytes within `timeout` seconds in total, not per recv, so a client
            that drips one byte at a time cannot hold the thread. None if too slow."""
            deadline = time.monotonic() + timeout
            chunks, got = [], 0
            while got < length:
                left = deadline - time.monotonic()
                if left <= 0:
                    return None
                self.connection.settimeout(left)
                try:
                    chunk = self.rfile.read1(length - got)
                except TimeoutError:
                    return None
                if not chunk:
                    break
                chunks.append(chunk)
                got += len(chunk)
            self.connection.settimeout(timeout)
            return b"".join(chunks)

        def do_GET(self):  # noqa: N802 - stdlib name
            try:
                return self._get()
            except Exception:
                return self._internal()

        def do_POST(self):  # noqa: N802 - stdlib name
            try:
                return self._post()
            except Exception:
                return self._internal()

        def _get(self):
            url = urlsplit(self.path)
            try:
                if url.path == "/healthz":
                    return self._json(200, {"ok": True, "ideas": agora.count()})
                if url.path == "/queue":
                    q = parse_qs(url.query)
                    raw_limit = q.get("limit", ["100"])[-1]
                    if not (raw_limit.isascii() and raw_limit.isdigit()) or len(raw_limit) > 4:
                        return self._error(400, "invalid_field", "limit must be a number")
                    ideas = agora.queue(q.get("jurisdiction"), int(raw_limit))
                    return self._json(
                        200, {"charter_version": agora.charter.version, "ideas": ideas}
                    )
                m = _IDEA.fullmatch(url.path)
                if m:
                    return self._json(200, agora.idea(m.group(1)))
            except AgoraError as exc:
                return self._error(exc.status, exc.code, str(exc))
            return self._error(404, "not_found", "not found")

        def _post(self):
            path = urlsplit(self.path).path
            upvote = _UPVOTE.fullmatch(path)
            if path != "/ideas" and not upvote:
                return self._error(404, "not_found", "not found")
            if self.headers.get("Content-Length") is None:
                return self._error(411, "length_required", "Content-Length is required")
            try:
                length = int(self.headers["Content-Length"])
            except ValueError:
                return self._error(400, "invalid_body", "bad Content-Length")
            if length <= 0:
                return self._error(400, "invalid_body", "empty body")
            if length > MAX_BODY:
                self.close_connection = True
                return self._error(413, "too_large", f"body is over {MAX_BODY} bytes")
            raw = self._read_body(length)
            if raw is None:
                self.close_connection = True
                return self._error(408, "timeout", "body did not arrive in time")
            if len(raw) < length:
                return self._error(400, "invalid_body", "body is shorter than Content-Length")
            try:
                body = json.loads(raw)
            except (ValueError, RecursionError):  # RecursionError: nesting too deep
                return self._error(400, "invalid_body", "body is not JSON")
            try:
                if upvote:
                    if not isinstance(body, dict) or set(body) != {"participant"}:
                        return self._error(
                            400, "invalid_body", "body must be exactly {participant}"
                        )
                    return self._json(201, agora.upvote(upvote.group(1), body["participant"]))
                return self._json(201, agora.post_idea(body))
            except AgoraError as exc:
                return self._error(exc.status, exc.code, str(exc))

    return _BoundedServer((host, port), Handler, max_connections)
