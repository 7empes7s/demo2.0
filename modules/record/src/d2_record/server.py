"""A minimal stdlib HTTP API for the log.

  POST /entries                         {type, payload_hash, payload_uri, signer, signature}
                                        -> 201 {seq, leaf_hash}
  GET  /entries/<seq>                   -> the entry
  GET  /checkpoint                      -> latest signed checkpoint (text/plain signed note);
                                           signs a new one first if the tree has grown
  GET  /proof/inclusion?seq=&size=      -> {seq, size, leaf_hash, proof: [base64...]}
  GET  /proof/consistency?from=&to=     -> {from, to, proof: [base64...]}
  GET  /anchor?size=                    -> the OpenTimestamps receipt for that checkpoint
  GET  /healthz                         -> {ok, size}
Hashes are standard base64, as in the checkpoint.
"""

from __future__ import annotations

import base64
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from .entry import Entry, EntryError
from .note import Signer
from .store import Log

MAX_BODY = 16 * 1024


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def inclusion_json(log: Log, seq: int, size: int) -> dict:
    proof = log.inclusion_proof(seq, size)
    return {
        "seq": seq,
        "size": size,
        "leaf_hash": b64(log.leaf_hash(seq)),
        "proof": [b64(p) for p in proof],
    }


def consistency_json(log: Log, old: int, new: int) -> dict:
    return {"from": old, "to": new, "proof": [b64(p) for p in log.consistency_proof(old, new)]}


def make_server(log: Log, signer: Signer, host: str = "127.0.0.1", port: int = 8080):
    class Handler(BaseHTTPRequestHandler):
        server_version = "d2-record/0.1"

        def log_message(self, format, *args):  # noqa: A002 - stdlib signature
            pass

        def _send(self, status: int, body: bytes, ctype: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, obj: object) -> None:
            self._send(status, json.dumps(obj).encode(), "application/json")

        def _error(self, status: int, message: str) -> None:
            self._json(status, {"error": message})

        def do_GET(self):  # noqa: N802 - stdlib name
            url = urlsplit(self.path)
            q = {k: v[-1] for k, v in parse_qs(url.query).items()}
            try:
                if url.path == "/healthz":
                    return self._json(200, {"ok": True, "size": log.size})
                if url.path == "/checkpoint":
                    note = log.checkpoint(signer)
                    return self._send(200, note.encode(), "text/plain; charset=utf-8")
                if url.path.startswith("/entries/"):
                    return self._json(200, log.entry(int(url.path[9:])).to_dict())
                if url.path == "/proof/inclusion":
                    return self._json(200, inclusion_json(log, int(q["seq"]), int(q["size"])))
                if url.path == "/proof/consistency":
                    return self._json(200, consistency_json(log, int(q["from"]), int(q["to"])))
                if url.path == "/anchor":
                    ots = log.anchor(int(q["size"]))
                    if ots is None:
                        return self._error(404, "no anchor for that size")
                    return self._send(200, ots, "application/vnd.opentimestamps.v1")
            except KeyError as exc:
                return self._error(
                    404 if url.path.startswith("/entries/") else 400, f"missing or unknown: {exc}"
                )
            except ValueError as exc:
                return self._error(400, str(exc))
            self._error(404, "not found")

        def do_POST(self):  # noqa: N802 - stdlib name
            if urlsplit(self.path).path != "/entries":
                return self._error(404, "not found")
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                return self._error(413 if length else 411, "body must be 1 byte to 16 KiB")
            try:
                entry = Entry.from_dict(json.loads(self.rfile.read(length)))
                seq, leaf = log.append(entry)
            except (EntryError, json.JSONDecodeError, UnicodeDecodeError) as exc:
                return self._error(400, str(exc))
            self._json(201, {"seq": seq, "leaf_hash": b64(leaf)})

    return ThreadingHTTPServer((host, port), Handler)
