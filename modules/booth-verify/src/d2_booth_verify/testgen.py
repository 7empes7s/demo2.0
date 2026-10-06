"""Build a large Booth test board from the spec, for the verifier's scale tests.

TEST MATERIAL ONLY: every secret comes from a public seed. The board is built from
spec/booth/README.md by this package (not by modules/booth), so a board it writes is checked
with the Rust `d2-booth verify` as well before a scale run counts (see the README).

    python -m d2_booth_verify.testgen --voters 10000 --revotes 100 --out board.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
from typing import Any

from nacl.signing import SigningKey

from . import ristretto as r
from .merlin import Transcript
from .verify import PROTOCOL, ZERO32, ballot_digest, entry_hash

OPTIONS = ["yes", "no", "abstain"]


def _rand(seed: bytes, *tag: object) -> int:
    label = "/".join(str(t) for t in tag).encode()
    return r.wide_reduce(hashlib.shake_256(seed + b"\x00" + label).digest(64))


def _hex(p: r.Point) -> str:
    return r.encode(p).hex()


def _s(k: int) -> str:
    return r.scalar_bytes(k).hex()


def _t(kind: bytes, round_id: str) -> Transcript:
    t = Transcript(PROTOCOL)
    t.append_message(b"kind", kind)
    t.append_message(b"round_id", round_id.encode("ascii"))
    return t


def _c(t: Transcript) -> int:
    return r.wide_reduce(t.challenge_bytes(b"challenge", 64))


@lru_cache(maxsize=4)
def _kfb(k_raw: bytes) -> r.FixedBase:
    return r.FixedBase(r.decode(k_raw))


def make_ballot(args: tuple[bytes, str, bytes, str, int, int, int, int]) -> dict[str, Any]:
    """One signed ballot for option `choice` (section 3.5)."""
    seed, round_id, k_raw, nym, voter, ballot_seq, choice, m = args
    kfb = _kfb(k_raw)
    sk = SigningKey(hashlib.sha256(seed + f"/voter/{voter}".encode()).digest())
    tag = ("ballot", voter, ballot_seq)
    choices, proofs, rs, a_sum, b_sum = [], [], [], r.IDENTITY, r.IDENTITY
    for j in range(m):
        bit = 1 if j == choice else 0
        rj = _rand(seed, *tag, "r", j)
        a = r.G.mul(rj)
        b = r.add(kfb.mul(rj), r.G.mul(bit))
        a_sum, b_sum = r.add(a_sum, a), r.add(b_sum, b)
        rs.append(rj)
        w = _rand(seed, *tag, "w", j)
        cs = _rand(seed, *tag, "sim_c", j)
        zs = _rand(seed, *tag, "sim_z", j)
        b_minus_g = r.sub(b, r.B)
        if bit == 0:
            c01, c02 = r.G.mul(w), kfb.mul(w)
            c11 = r.sub(r.G.mul(zs), r.mul(cs, a))
            c12 = r.sub(kfb.mul(zs), r.mul(cs, b_minus_g))
        else:
            c01 = r.sub(r.G.mul(zs), r.mul(cs, a))
            c02 = r.sub(kfb.mul(zs), r.mul(cs, b))
            c11, c12 = r.G.mul(w), kfb.mul(w)
        t = _t(b"bit", round_id)
        t.append_message(b"nym", nym.encode())
        t.append_u64(b"ballot_seq", ballot_seq)
        t.append_u64(b"option", j)
        t.append_message(b"joint_key", k_raw)
        t.append_message(b"a", r.encode(a))
        t.append_message(b"b", r.encode(b))
        commits = {"commit_0_1": c01, "commit_0_2": c02, "commit_1_1": c11, "commit_1_2": c12}
        for name, pt in commits.items():
            t.append_message(name.encode(), r.encode(pt))
        c = _c(t)
        if bit == 0:
            ch1, z1 = cs, zs
            ch0 = (c - ch1) % r.L
            z0 = (w + ch0 * rj) % r.L
        else:
            ch0, z0 = cs, zs
            ch1 = (c - ch0) % r.L
            z1 = (w + ch1 * rj) % r.L
        choices.append({"a": _hex(a), "b": _hex(b)})
        proof = {name: _hex(pt) for name, pt in commits.items()}
        proof.update(challenge_0=_s(ch0), response_0=_s(z0), response_1=_s(z1))
        proofs.append(proof)
    big_r = sum(rs) % r.L
    w = _rand(seed, *tag, "sum_w")
    t = _t(b"sum", round_id)
    t.append_message(b"nym", nym.encode())
    t.append_u64(b"ballot_seq", ballot_seq)
    t.append_message(b"joint_key", k_raw)
    t.append_message(b"a_sum", r.encode(a_sum))
    t.append_message(b"b_sum", r.encode(b_sum))
    c1, c2 = r.G.mul(w), kfb.mul(w)
    t.append_message(b"commit_1", r.encode(c1))
    t.append_message(b"commit_2", r.encode(c2))
    c = _c(t)
    payload = {
        "round_id": round_id,
        "nym": nym,
        "voter_key": sk.verify_key.encode().hex(),
        "ballot_seq": ballot_seq,
        "choices": choices,
        "bit_proofs": proofs,
        "sum_proof": {"commit_1": _hex(c1), "commit_2": _hex(c2), "response": _s(w + c * big_r)},
        "signature": "",
    }
    payload["signature"] = sk.sign(ballot_digest(payload)).signature.hex()
    return payload


def build(
    voters: int,
    revotes: int = 0,
    guardians: int = 5,
    threshold: int = 3,
    decrypting: list[int] | None = None,
    seed: bytes = b"d2.booth-verify testgen public seed",
    jobs: int = 1,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (board, expected tally). Voter v votes v mod 3 then, if re-voting, (v + 1) mod 3."""
    round_id = f"booth:testgen-{voters}"
    m = len(OPTIONS)
    payloads: list[tuple[str, dict[str, Any]]] = []
    payloads.append(
        (
            "round.params",
            {
                "schema": "d2.booth.round/1",
                "round_id": round_id,
                "matter_id": "matter:testgen",
                "options": OPTIONS,
                "guardians": guardians,
                "threshold": threshold,
            },
        )
    )
    coeffs = [[_rand(seed, "dkg", i, d) for d in range(threshold)] for i in range(1, guardians + 1)]
    commits = [[r.G.mul(a) for a in cs] for cs in coeffs]
    for i in range(1, guardians + 1):
        cs, a0 = commits[i - 1], coeffs[i - 1][0]
        w = _rand(seed, "dkg-proof", i)
        big_a = r.G.mul(w)
        t = _t(b"guardian", round_id)
        t.append_u64(b"guardian", i)
        t.append_message(b"constant", r.encode(cs[0]))
        t.append_message(b"commit", r.encode(big_a))
        c = _c(t)
        payloads.append(
            (
                "guardian.commitment",
                {
                    "guardian": i,
                    "commitments": [_hex(p) for p in cs],
                    "proof": {"commit": _hex(big_a), "response": _s(w + c * a0)},
                },
            )
        )
    joint = r.IDENTITY
    for cs in commits:
        joint = r.add(joint, cs[0])
    secrets = [
        sum(sum(a * pow(j, d, r.L) for d, a in enumerate(cs)) for cs in coeffs) % r.L
        for j in range(1, guardians + 1)
    ]
    gkeys = [r.G.mul(x) for x in secrets]
    k_raw = r.encode(joint)
    payloads.append(
        ("round.key", {"joint_key": k_raw.hex(), "guardian_keys": [_hex(p) for p in gkeys]})
    )
    nyms = [f"nym-{v:06d}" for v in range(voters)]
    for v, nym in enumerate(nyms):
        sk = SigningKey(hashlib.sha256(seed + f"/voter/{v}".encode()).digest())
        payloads.append(("signup", {"nym": nym, "voter_key": sk.verify_key.encode().hex()}))
    work = [(seed, round_id, k_raw, nyms[v], v, 1, v % m, m) for v in range(voters)]
    work += [(seed, round_id, k_raw, nyms[v], v, 2, (v + 1) % m, m) for v in range(revotes)]
    if jobs > 1:
        with ProcessPoolExecutor(jobs) as pool:
            ballots = list(pool.map(make_ballot, work, chunksize=max(1, len(work) // (8 * jobs))))
    else:
        ballots = [make_ballot(w) for w in work]
    payloads += [("ballot", b) for b in ballots]
    payloads.append(("round.close", {}))
    final = {v: v % m for v in range(voters)}
    final.update({v: (v + 1) % m for v in range(revotes)})
    counts = [0] * m
    for c in final.values():
        counts[c] += 1
    agg_a = [r.IDENTITY] * m
    last = {b["nym"]: b for b in ballots}
    for b in last.values():
        for j, ch in enumerate(b["choices"]):
            agg_a[j] = r.add(agg_a[j], r.decode(bytes.fromhex(ch["a"])))
    used = decrypting or list(range(1, threshold + 1))
    for i in used:
        x, ki = secrets[i - 1], gkeys[i - 1]
        shares = []
        for j in range(m):
            share = r.mul(x, agg_a[j])
            w = _rand(seed, "decrypt", i, j)
            c1, c2 = r.G.mul(w), r.mul(w, agg_a[j])
            t = _t(b"decrypt", round_id)
            t.append_u64(b"guardian", i)
            t.append_u64(b"option", j)
            t.append_message(b"guardian_key", r.encode(ki))
            t.append_message(b"aggregate", r.encode(agg_a[j]))
            t.append_message(b"share", r.encode(share))
            t.append_message(b"commit_1", r.encode(c1))
            t.append_message(b"commit_2", r.encode(c2))
            c = _c(t)
            proof = {"commit_1": _hex(c1), "commit_2": _hex(c2), "response": _s(w + c * x)}
            shares.append({"m": _hex(share), "proof": proof})
        payloads.append(("partial.decryption", {"guardian": i, "shares": shares}))
    tally = {"signups": voters, "counted": voters, "counts": counts, "guardians_used": used}
    payloads.append(("tally", tally))
    entries, prev = [], ZERO32
    for seq, (kind, payload) in enumerate(payloads):
        h = entry_hash(seq, prev, kind, payload)
        entries.append(
            {"seq": seq, "prev": prev.hex(), "kind": kind, "payload": payload, "hash": h.hex()}
        )
        prev = h
    return {"schema": "d2.booth.board/1", "entries": entries}, tally


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m d2_booth_verify.testgen", description=__doc__)
    ap.add_argument("--voters", type=int, required=True)
    ap.add_argument("--revotes", type=int, default=0)
    ap.add_argument("--guardians", type=int, default=5)
    ap.add_argument("--threshold", type=int, default=3)
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 1)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    board, tally = build(a.voters, a.revotes, a.guardians, a.threshold, jobs=a.jobs)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(board, f, separators=(",", ":"))
    print(json.dumps(tally))
    return 0


if __name__ == "__main__":
    sys.exit(main())
