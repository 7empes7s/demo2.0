"""A minimal stdlib HTTP API over the argument library (read only).

GET /matters/{matter_id}/arguments[?stance=]  -> 200 {matter_id, stance, ranker, arguments[]}
                                                (an empty list when Commons has nothing yet)
GET /healthz                                  -> {ok, arguments, matters}

`matter_id` is a Docket item id, e.g. lu.esch.42063. Arguments follow
spec/schemas/argument.schema.json. No argument has ratings yet, so `ranker` is null and the
list is in ingestion order.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

from .library import Library

TIMEOUT = 10.0
MAX_ID = 200


def arguments_response(library: Library, matter_id: str, stance: str | None) -> dict:
    return {
        "matter_id": matter_id,
        "stance": stance,
        "ranker": None,
        "arguments": library.for_matter(matter_id, stance),
    }


def make_server(
    library: Library, host: str = "127.0.0.1", port: int = 8091, timeout: float = TIMEOUT
) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        server_version = "d2-commons/0.2"

        def setup(self):
            self.timeout = timeout
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
            parts = urlsplit(self.path)
            path = parts.path
            if path == "/healthz":
                return self._json(
                    200,
                    {
                        "ok": True,
                        "arguments": len(library.arguments),
                        "matters": len(library.matters()),
                    },
                )
            segments = path.split("/")
            if len(segments) == 4 and segments[1] == "matters" and segments[3] == "arguments":
                matter_id = unquote(segments[2])
                if not matter_id or len(matter_id) > MAX_ID:
                    return self._json(400, {"error": "bad matter id"})
                stance = (parse_qs(parts.query).get("stance") or [None])[0]
                return self._json(200, arguments_response(library, matter_id, stance or None))
            return self._json(404, {"error": "not found"})

    return ThreadingHTTPServer((host, port), Handler)
