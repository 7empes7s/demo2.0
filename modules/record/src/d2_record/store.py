"""The log: entries and Merkle nodes in SQLite, appended incrementally.

Table `nodes` holds every perfect, aligned subtree hash: (level 0, i) is leaf i, and (level l, i)
is written the moment its right child exists. An append writes the leaf plus one node per
trailing 1-bit of its index (amortized 2 rows, at most log2 n + 1). The right edge of the tree
(the "frontier": one perfect subtree per set bit of the size) is kept in memory, so an append
reads nothing from disk and the root is folded from at most log2 n hashes.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from collections.abc import Iterable
from pathlib import Path

from . import merkle
from .entry import Entry
from .note import Checkpoint, Signer, checkpoint_hash

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
  seq INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_uri TEXT NOT NULL,
  signer TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  level INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  hash BLOB NOT NULL,
  PRIMARY KEY (level, idx)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS checkpoints (
  size INTEGER PRIMARY KEY,
  note TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS anchors (
  size INTEGER PRIMARY KEY,
  checkpoint_sha256 BLOB NOT NULL,
  ots BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
"""


class Log:
    def __init__(self, path: str | Path, allowed_types: frozenset[str] | None = None) -> None:
        self.allowed_types = allowed_types
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.executescript(SCHEMA)
        self.size = self.db.execute(
            "SELECT COALESCE(MAX(idx) + 1, 0) FROM nodes WHERE level = 0"
        ).fetchone()[0]
        self.frontier = self._load_frontier()

    def close(self) -> None:
        self.db.close()

    def _one(self, sql: str, params: tuple = ()) -> tuple | None:
        with self.lock:
            return self.db.execute(sql, params).fetchone()

    # Tree -------------------------------------------------------------------------------

    def _load_frontier(self) -> list[tuple[int, bytes]]:
        frontier, start = [], 0
        for level in range(self.size.bit_length() - 1, -1, -1):
            if self.size >> level & 1:
                frontier.append((level, self.subtree(level, start >> level)))
                start += 1 << level
        return frontier

    def subtree(self, level: int, index: int) -> bytes:
        row = self._one("SELECT hash FROM nodes WHERE level = ? AND idx = ?", (level, index))
        if row is None:
            raise KeyError(f"no node at level {level} index {index}")
        return row[0]

    def root(self, size: int | None = None) -> bytes:
        with self.lock:
            if size is None or size == self.size:
                if not self.frontier:
                    return merkle.empty_root()
                h = self.frontier[-1][1]
                for _, left in reversed(self.frontier[:-1]):
                    h = merkle.node_hash(left, h)
                return h
            self._check_size(size)
            return merkle.root(self.subtree, size)

    def _check_size(self, size: int) -> None:
        if not 0 <= size <= self.size:
            raise ValueError(f"size {size} is beyond the tree size {self.size}")

    # Appends ----------------------------------------------------------------------------

    def append(self, entry: Entry) -> tuple[int, bytes]:
        return self.append_many([entry])[0]

    def append_many(self, entries: Iterable[Entry], check: bool = True) -> list[tuple[int, bytes]]:
        """Append entries in one transaction; all or nothing."""
        with self.lock:
            size, frontier = self.size, list(self.frontier)
            out: list[tuple[int, bytes]] = []
            now = int(time.time())
            try:
                self.db.execute("BEGIN IMMEDIATE")
                for entry in entries:
                    if check:
                        entry.check(self.allowed_types)
                    seq, leaf = self.size, entry.leaf_hash()
                    self.db.execute(
                        "INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (
                            seq,
                            entry.type,
                            entry.payload_hash,
                            entry.payload_uri,
                            entry.signer,
                            entry.signature,
                            now,
                        ),
                    )
                    rows = [(0, seq, leaf)]
                    level, h = 0, leaf
                    while self.frontier and self.frontier[-1][0] == level:
                        h = merkle.node_hash(self.frontier.pop()[1], h)
                        level += 1
                        rows.append((level, ((seq + 1) >> level) - 1, h))
                    self.frontier.append((level, h))
                    self.db.executemany("INSERT INTO nodes VALUES (?, ?, ?)", rows)
                    self.size += 1
                    out.append((seq, leaf))
                self.db.execute("COMMIT")
            except BaseException:
                if self.db.in_transaction:
                    self.db.execute("ROLLBACK")
                self.size, self.frontier = size, frontier
                raise
            return out

    def entry(self, seq: int) -> Entry:
        row = self._one(
            "SELECT type, payload_hash, payload_uri, signer, signature FROM entries WHERE seq = ?",
            (seq,),
        )
        if row is None:
            raise KeyError(f"no entry {seq}")
        return Entry(*row)

    # Proofs -----------------------------------------------------------------------------

    def inclusion_proof(self, seq: int, size: int) -> list[bytes]:
        with self.lock:
            self._check_size(size)
            return merkle.inclusion_proof(self.subtree, seq, size)

    def consistency_proof(self, old: int, new: int) -> list[bytes]:
        with self.lock:
            self._check_size(new)
            return merkle.consistency_proof(self.subtree, old, new)

    def leaf_hash(self, seq: int) -> bytes:
        return self.subtree(0, seq)

    # Checkpoints and anchors ------------------------------------------------------------

    def checkpoint(self, signer: Signer, now: int | None = None) -> str:
        """Sign a checkpoint for the current size (or return the one already signed)."""
        with self.lock:
            existing = self.checkpoint_at(self.size)
            if existing is not None:
                return existing
            cp = Checkpoint(signer.name, self.size, self.root(), int(now or time.time()))
            note = cp.sign(signer)
            self.db.execute("INSERT INTO checkpoints VALUES (?, ?)", (self.size, note))
            return note

    def checkpoint_at(self, size: int) -> str | None:
        row = self._one("SELECT note FROM checkpoints WHERE size = ?", (size,))
        return row[0] if row else None

    def latest_checkpoint(self) -> str | None:
        row = self._one("SELECT note FROM checkpoints ORDER BY size DESC LIMIT 1")
        return row[0] if row else None

    def save_anchor(self, size: int, ots: bytes) -> None:
        note = self.checkpoint_at(size)
        if note is None:
            raise KeyError(f"no checkpoint at size {size}")
        with self.lock:
            self.db.execute(
                "INSERT OR REPLACE INTO anchors VALUES (?, ?, ?, ?)",
                (size, checkpoint_hash(note), ots, int(time.time())),
            )

    def anchor(self, size: int) -> bytes | None:
        row = self._one("SELECT ots FROM anchors WHERE size = ?", (size,))
        return row[0] if row else None
