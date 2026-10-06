"""A minimal stdlib HTTP API.

POST /claims/grade   {text, context?}  -> 200 Grade (spec/schemas/grade.schema.json)
                                        -> 404 {error, code: "no_record"}: no record mentions it
                                        -> 400 {error, code: "unknown_context"}: unknown context
                                        -> 400 {error} on other bad input
                                        -> 408 {error} when the body does not arrive in time
GET  /checkers                         -> {checkers: [{checker_id, model_version, method, corpus}]}
GET  /healthz                          -> {ok, items, sentences}
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from .grader import Grader, NoRecord, UnknownContext

MAX_BODY = 16 * 1024
TIMEOUT = 10.0  # seconds a client may take to send its request


def make_server(
    grader: Grader, host: str = "127.0.0.1", port: int = 8090, timeout: float = TIMEOUT
) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        server_version = "d2-provenance/0.1"

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

        def do_GET(self):  # noqa: N802 - stdlib name
            path = urlsplit(self.path).path
            if path == "/healthz":
                corpus = grader.corpus
                return self._json(
                    200,
                    {"ok": True, "items": len(corpus.items), "sentences": corpus.sentence_count},
                )
            if path == "/checkers":
                return self._json(200, {"checkers": [grader.checker()]})
            return self._json(404, {"error": "not found"})

        def do_POST(self):  # noqa: N802 - stdlib name
            if urlsplit(self.path).path != "/claims/grade":
                return self._json(404, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return self._json(400, {"error": "bad Content-Length"})
            if length <= 0 or length > MAX_BODY:
                return self._json(400 if length <= 0 else 413, {"error": "body size"})
            try:
                raw = self.rfile.read(length)
            except TimeoutError:
                self.close_connection = True
                return self._json(408, {"error": "body did not arrive in time"})
            if len(raw) < length:
                return self._json(400, {"error": "body is shorter than Content-Length"})
            try:
                body = json.loads(raw)
            except (ValueError, RecursionError):  # RecursionError: nesting too deep
                return self._json(400, {"error": "body is not JSON"})
            if not isinstance(body, dict) or not isinstance(body.get("text"), str):
                return self._json(400, {"error": "text must be a string"})
            context = body.get("context")
            if context is not None and not isinstance(context, str):
                return self._json(400, {"error": "context must be a string"})
            try:
                return self._json(200, grader.grade(body["text"], context))
            except NoRecord:
                return self._json(
                    404, {"error": "no record mentions this claim", "code": "no_record"}
                )
            except UnknownContext as exc:
                return self._json(400, {"error": str(exc), "code": "unknown_context"})
            except ValueError as exc:
                return self._json(400, {"error": str(exc)})

    return ThreadingHTTPServer((host, port), Handler)
