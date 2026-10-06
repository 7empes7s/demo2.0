"""The mutation operations of spec/booth/README.md section 6, to build the must-fail boards."""

from __future__ import annotations

import copy
from typing import Any

from .verify import ZERO32, entry_hash


def _rehash_from(entries: list[dict[str, Any]], start: int) -> None:
    """Renumber and recompute prev/hash of entries[start:] (an operator rewriting history)."""
    for i in range(start, len(entries)):
        e = entries[i]
        e["seq"] = i
        prev = ZERO32 if i == 0 else bytes.fromhex(entries[i - 1]["hash"])
        e["prev"] = prev.hex()
        e["hash"] = entry_hash(i, prev, e["kind"], e["payload"]).hex()


def _set_pointer(entry: dict[str, Any], pointer: str, value: Any) -> None:
    """RFC 6901 pointer relative to the entry; a missing last key is inserted."""
    if not pointer.startswith("/"):
        raise ValueError(f"bad pointer {pointer!r}")
    parts = [p.replace("~1", "/").replace("~0", "~") for p in pointer[1:].split("/")]
    target: Any = entry
    for part in parts[:-1]:
        target = target[int(part)] if isinstance(target, list) else target[part]
    last = parts[-1]
    if isinstance(target, list):
        target[int(last)] = value
    else:
        target[last] = value


def mutate(board: dict[str, Any], mutation: dict[str, Any]) -> dict[str, Any]:
    """Return a mutated deep copy of `board`."""
    out = copy.deepcopy(board)
    entries: list[dict[str, Any]] = out["entries"]
    op = mutation["op"]
    if op == "set":
        s = mutation["seq"]
        _set_pointer(entries[s], mutation["pointer"], copy.deepcopy(mutation["value"]))
        if mutation["rehash"]:
            # Recompute entry S's hash (keeping its seq and prev), then every later entry.
            e = entries[s]
            e["hash"] = entry_hash(
                e["seq"], bytes.fromhex(e["prev"]), e["kind"], e["payload"]
            ).hex()
            _rehash_from(entries, s + 1)
    elif op == "remove":
        s = mutation["seq"]
        del entries[s]
        _rehash_from(entries, s)
    elif op == "truncate":
        del entries[mutation["len"] :]
    elif op == "duplicate":
        s = mutation["seq"]
        entries.insert(s + 1, copy.deepcopy(entries[s]))
        _rehash_from(entries, s + 1)
    elif op == "copy":
        s, a = mutation["seq"], mutation["after"]
        if a < s:
            raise ValueError("copy needs after >= seq")
        entries.insert(a + 1, copy.deepcopy(entries[s]))
        _rehash_from(entries, a + 1)
    else:
        raise ValueError(f"unknown mutation op {op!r}")
    return out
