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
409 duplicate upvote, 411 no Content-Length, 413 body over MAX_BODY.
"""

from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from .agora import Agora, AgoraError

MAX_BODY = 64 * 1024
TIMEOUT = 10.0  # seconds a client may take to send its request
_IDEA = re.compile(r"/ideas/([0-9A-Z]{26})")
_UPVOTE = re.compile(r"/ideas/([0-9A-Z]{26})/upvote")


def make_server(
    agora: Agora, host: str = "127.0.0.1", port: int = 8091, timeout: float = TIMEOUT
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

        def do_GET(self):  # noqa: N802 - stdlib name
            url = urlsplit(self.path)
            try:
                if url.path == "/healthz":
                    return self._json(200, {"ok": True, "ideas": agora.count()})
                if url.path == "/queue":
                    q = parse_qs(url.query)
                    raw_limit = q.get("limit", ["100"])[-1]
                    if not raw_limit.isdigit() or len(raw_limit) > 4:
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

        def do_POST(self):  # noqa: N802 - stdlib name
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
            try:
                raw = self.rfile.read(length)
            except TimeoutError:
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

    return ThreadingHTTPServer((host, port), Handler)
