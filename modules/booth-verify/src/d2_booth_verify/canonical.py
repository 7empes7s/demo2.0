"""Strict JSON reading and the canonical JSON of spec/booth/README.md section 2."""

from __future__ import annotations

import json
from typing import Any

from .errors import BoardError

U64_MAX = 2**64 - 1


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise BoardError("malformed", f"repeated key {key!r}")
        out[key] = value
    return out


def _no_float(text: str) -> Any:
    raise BoardError("malformed", f"non-integer number {text}")


def _no_constant(text: str) -> Any:
    raise BoardError("malformed", f"not JSON: {text}")


def load(data: bytes | str) -> Any:
    """Parse a board file. Repeated keys, floats, exponents and NaN/Infinity are `malformed`."""
    try:
        if isinstance(data, bytes):
            data = data.decode("utf-8")
        return json.loads(
            data,
            object_pairs_hook=_no_duplicates,
            parse_float=_no_float,
            parse_constant=_no_constant,
        )
    except BoardError:
        raise
    except (ValueError, RecursionError) as e:
        raise BoardError("malformed", f"not JSON: {e}") from None


_ESCAPES = {
    '"': '\\"',
    "\\": "\\\\",
    "\b": "\\b",
    "\t": "\\t",
    "\n": "\\n",
    "\f": "\\f",
    "\r": "\\r",
}


def _string(s: str, out: list[str]) -> None:
    try:
        s.encode("utf-8")
    except UnicodeEncodeError:
        raise BoardError("malformed", "string is not valid Unicode (lone surrogate)") from None
    out.append('"')
    for ch in s:
        esc = _ESCAPES.get(ch)
        if esc is not None:
            out.append(esc)
        elif ch < " ":
            out.append(f"\\u{ord(ch):04x}")
        else:
            out.append(ch)
    out.append('"')


def _value(v: Any, out: list[str]) -> None:
    if isinstance(v, bool) or v is None:
        raise BoardError("malformed", "null and booleans are not allowed in a payload")
    if isinstance(v, int):
        if v < 0 or v > U64_MAX:
            raise BoardError("malformed", "integers must be 0 to 2^64 - 1")
        out.append(str(v))
    elif isinstance(v, str):
        _string(v, out)
    elif isinstance(v, list):
        out.append("[")
        for i, item in enumerate(v):
            if i:
                out.append(",")
            _value(item, out)
        out.append("]")
    elif isinstance(v, dict):
        out.append("{")
        keys = sorted(v, key=lambda k: k.encode("utf-8", "surrogatepass"))
        for i, k in enumerate(keys):
            if i:
                out.append(",")
            _string(k, out)
            out.append(":")
            _value(v[k], out)
        out.append("}")
    else:
        raise BoardError("malformed", f"unsupported JSON value {type(v).__name__}")


def canonical(v: Any) -> bytes:
    """Sorted keys (by UTF-8 bytes), no whitespace, integers only, serde_json string escapes."""
    out: list[str] = []
    _value(v, out)
    return "".join(out).encode("utf-8")
