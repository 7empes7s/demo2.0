"""Panels for ScopeChallenges, drawn by the Lottery module through its documented CLI.

Agora never imports Lottery (modules import only spec and charter, tools/boundaries.py). It runs
`d2-lottery commit` and `d2-lottery draw` in a subprocess, the way it asks Door over HTTP, and
keeps the pool, the commitment and the transcript, so anyone reproduces the panel with
`d2-lottery verify` or `lottery-verify` (format: spec/lottery/README.md).

- `Sortition` is the interface Agora needs.
- `LotteryCli` is the real one. In production `draw` lets the CLI fetch the drand round and
  verify it; tests pass `beacon`, a function giving a recorded beacon, so they need no network.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, Protocol


class LotteryError(Exception):
    """The Lottery CLI failed or answered something Agora cannot use."""


class Sortition(Protocol):
    def commit(
        self, pool: Sequence[str], purpose: str, context: str, size: int, committed_at: int
    ) -> dict[str, Any]:
        """Commit to `pool` (pseudonyms) and a drand round at least an hour after
        `committed_at` (unix seconds). Returns the commitment as JSON (spec/lottery section 3),
        with `commitment_hash`."""
        ...

    def draw(self, commitment: dict[str, Any], pool: Sequence[str]) -> dict[str, Any] | None:
        """The transcript (spec/lottery section 7) once the committed round's beacon exists,
        verified; None when the beacon is not available yet. Raises LotteryError on failure."""
        ...


class LotteryCli:
    """Runs `command` (default `d2-lottery` on PATH), the Lottery module's CLI.

    `chain` is the drand chain new draws commit to (`quicknet` by default). `beacon(round)`, when
    given, supplies the beacon JSON instead of the CLI fetching it (None: not available yet);
    the CLI verifies it either way."""

    def __init__(
        self,
        command: Sequence[str] = ("d2-lottery",),
        chain: str = "quicknet",
        beacon: Callable[[int], dict[str, Any] | None] | None = None,
        drand_url: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.command = list(command)
        self.chain = chain
        self.beacon = beacon
        self.drand_url = drand_url
        self.timeout = timeout

    def _run(self, args: list[str], files: dict[str, Any]) -> dict[str, Any]:
        with tempfile.TemporaryDirectory(prefix="d2-agora-lottery-") as tmp:
            for name, value in files.items():
                (Path(tmp) / name).write_text(json.dumps(value), encoding="utf-8")
            argv = [*self.command, *(a.replace("{tmp}", tmp) for a in args)]
            try:
                done = subprocess.run(
                    argv, capture_output=True, text=True, timeout=self.timeout, check=False
                )
            except (OSError, subprocess.SubprocessError) as exc:
                raise LotteryError(f"cannot run the Lottery CLI: {exc}") from exc
        if done.returncode != 0:
            last = (done.stderr.strip().splitlines() or ["no output"])[-1][:300]
            raise LotteryError(f"the Lottery CLI failed: {last}")
        try:
            out = json.loads(done.stdout)
        except ValueError as exc:
            raise LotteryError("the Lottery CLI did not answer JSON") from exc
        if not isinstance(out, dict):
            raise LotteryError("the Lottery CLI did not answer an object")
        return out

    def commit(
        self, pool: Sequence[str], purpose: str, context: str, size: int, committed_at: int
    ) -> dict[str, Any]:
        args = ["commit", "--pool", "{tmp}/pool.json", "--purpose", purpose, "--context", context]
        args += ["--size", str(size), "--chain", self.chain, "--now", str(committed_at)]
        return self._run(args, {"pool.json": [{"nym": n} for n in pool]})

    def draw(self, commitment: dict[str, Any], pool: Sequence[str]) -> dict[str, Any] | None:
        files: dict[str, Any] = {"c.json": commitment, "pool.json": [{"nym": n} for n in pool]}
        args = ["draw", "--commitment", "{tmp}/c.json", "--pool", "{tmp}/pool.json"]
        if self.beacon is not None:
            beacon = self.beacon(commitment["round"])
            if beacon is None:
                return None
            files["beacon.json"] = beacon
            args += ["--beacon", "{tmp}/beacon.json"]
        elif self.drand_url:
            args += ["--drand-url", self.drand_url]
        return self._run(args, files)
