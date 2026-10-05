"""Benchmark (not a test): append N signed entries, then verify sampled proofs in both verifiers.

    uv run python modules/record/bench/bench_1m.py --n 1000000 --workdir /tmp/record-bench

Appends go through Log.append_many in batches, with the full entry check (type and Ed25519
signature) on every entry. The sampled proofs are checked by d2_record.verify and by the
independent TypeScript verifier (modules/record-verify) through its --json batch mode.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import subprocess
import time
from pathlib import Path

from d2_record.entry import sign_entry
from d2_record.note import Checkpoint, Signer
from d2_record.server import consistency_json, inclusion_json
from d2_record.store import Log
from d2_record.verify import check_consistency, check_inclusion

ROOT = Path(__file__).resolve().parents[3]
LOG_KEY = Signer("example.org/bench-log", hashlib.sha256(b"bench log key").digest())
ENTRY_KEY = Signer("example.org/bench-signer", hashlib.sha256(b"bench entry key").digest())


def entry(i: int):
    digest = "sha256:" + hashlib.sha256(i.to_bytes(8, "big")).hexdigest()
    return sign_entry(ENTRY_KEY, "spend", digest, f"https://example.org/payloads/{i}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=1_000_000)
    p.add_argument("--batch", type=int, default=10_000)
    p.add_argument("--samples", type=int, default=1_000)
    p.add_argument("--workdir", type=Path, required=True)
    args = p.parse_args()
    shutil.rmtree(args.workdir, ignore_errors=True)
    args.workdir.mkdir(parents=True)
    log = Log(args.workdir / "log.db", frozenset({"spend"}))
    results: dict[str, object] = {"n": args.n}

    sign_s = append_s = 0.0
    tenth = []
    t_tenth = time.perf_counter()
    for start in range(0, args.n, args.batch):
        t0 = time.perf_counter()
        batch = [entry(i) for i in range(start, min(start + args.batch, args.n))]
        t1 = time.perf_counter()
        log.append_many(batch)
        t2 = time.perf_counter()
        sign_s += t1 - t0
        append_s += t2 - t1
        if (start + args.batch) % (args.n // 10 or 1) == 0:
            tenth.append(time.perf_counter() - t_tenth)
            t_tenth = time.perf_counter()
    results["sign_entries_s"] = round(sign_s, 1)
    results["append_s"] = round(append_s, 1)
    results["appends_per_s"] = round(args.n / append_s)
    results["wall_per_tenth_s"] = [round(x, 1) for x in tenth]
    results["db_mb"] = round((args.workdir / "log.db").stat().st_size / 1e6, 1)

    rng = random.Random(1)
    n = log.size
    t0 = time.perf_counter()
    head = log.checkpoint(LOG_KEY)
    olds = sorted({rng.randrange(1, n) for _ in range(args.samples)})
    old_notes = {
        m: Checkpoint(LOG_KEY.name, m, log.root(m), int(time.time())).sign(LOG_KEY) for m in olds
    }
    results["sign_checkpoints_s"] = round(time.perf_counter() - t0, 2)

    t0 = time.perf_counter()
    inc = [(s, inclusion_json(log, s, n)) for s in (rng.randrange(n) for _ in range(args.samples))]
    con = [(m, consistency_json(log, m, n)) for m in olds]
    results["prove_ms_each"] = round((time.perf_counter() - t0) * 1000 / (len(inc) + len(con)), 3)
    results["inclusion_proof_len_avg"] = round(sum(len(p["proof"]) for _, p in inc) / len(inc), 1)

    vkey = LOG_KEY.verifier
    t0 = time.perf_counter()
    for seq, proof in inc:
        check_inclusion(head, vkey, entry(seq).to_dict(), proof)
    for m, proof in con:
        check_consistency(old_notes[m], head, vkey, proof)
    results["python_verify_ms_each"] = round(
        (time.perf_counter() - t0) * 1000 / (len(inc) + len(con)), 3
    )

    cases = [
        {"kind": "inclusion", "checkpoint": head, "entry": entry(s).to_dict(), "proof": p}
        for s, p in inc
    ]
    cases += [{"kind": "consistency", "old": old_notes[m], "new": head, "proof": p} for m, p in con]
    batch_file = args.workdir / "cases.json"
    batch_file.write_text(json.dumps({"vkey": vkey.encode(), "cases": cases}))
    cli = ROOT / "modules" / "record-verify" / "src" / "cli.ts"
    node = ["node", "--experimental-strip-types", "--no-warnings", str(cli)]
    t0 = time.perf_counter()
    out = subprocess.run([*node, "--json", str(batch_file)], capture_output=True, text=True)
    ts_s = time.perf_counter() - t0
    if out.returncode != 0:
        raise SystemExit(f"TypeScript verifier failed: {out.stdout}{out.stderr}")
    t0 = time.perf_counter()
    subprocess.run([*node, "--json", "/dev/null"], capture_output=True)
    startup = time.perf_counter() - t0
    results["ts_verify_ms_each"] = round((ts_s - startup) * 1000 / len(cases), 3)
    results["ts_cases"] = len(cases)
    results["ts_output"] = out.stdout.strip()
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
