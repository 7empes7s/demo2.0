"""Replay a Booth board (spec/booth/README.md) and return the tally it proves.

Everything here follows the spec's text; section numbers in comments refer to it. Any failure
raises BoardError with the spec's error code; no entry is ever skipped.
"""

from __future__ import annotations

import hashlib
import re
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

from . import ristretto as r
from .canonical import U64_MAX, canonical, load
from .errors import BoardError
from .merlin import Transcript

BOARD_SCHEMA = "d2.booth.board/1"
ROUND_SCHEMA = "d2.booth.round/1"
PROTOCOL = b"d2.booth/1"
ZERO32 = bytes(32)
ID_RE = re.compile(r"[A-Za-z0-9._:-]{1,128}")
HEX_RE = re.compile(r"[0-9a-f]*")
KINDS = (
    "round.params",
    "guardian.commitment",
    "round.key",
    "signup",
    "ballot",
    "round.close",
    "partial.decryption",
    "tally",
)
BIT_FIELDS = (
    "commit_0_1",
    "commit_0_2",
    "commit_1_1",
    "commit_1_2",
    "challenge_0",
    "response_0",
    "response_1",
)
CP_FIELDS = ("commit_1", "commit_2", "response")


# ---------------------------------------------------------------- shape helpers


def _malformed(detail: str) -> BoardError:
    return BoardError("malformed", detail)


def _obj(v: Any, names: tuple[str, ...], what: str) -> dict[str, Any]:
    if not isinstance(v, dict):
        raise _malformed(f"{what} is not an object")
    if set(v) != set(names):
        extra = sorted(set(v) - set(names))
        missing = sorted(set(names) - set(v))
        raise _malformed(f"{what}: unknown fields {extra}, missing {missing}")
    return v


def _u64(v: Any, what: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= U64_MAX:
        raise _malformed(f"{what} is not an unsigned integer")
    return v


def _str(v: Any, what: str) -> str:
    if not isinstance(v, str):
        raise _malformed(f"{what} is not a string")
    return v


def _list(v: Any, what: str) -> list[Any]:
    if not isinstance(v, list):
        raise _malformed(f"{what} is not an array")
    return v


def _hex(v: Any, n: int, what: str) -> bytes:
    s = _str(v, what)
    if len(s) != 2 * n or not HEX_RE.fullmatch(s):
        raise _malformed(f"{what} is not {n} bytes of lowercase hex")
    return bytes.fromhex(s)


def _id(v: Any, what: str) -> str:
    s = _str(v, what)
    if not ID_RE.fullmatch(s):
        raise _malformed(f"{what} is not 1 to 128 characters of [A-Za-z0-9._:-]")
    return s


@dataclass(frozen=True)
class Pt:
    """A point as published (bytes) and decoded."""

    raw: bytes
    p: r.Point


def _point(v: Any, what: str) -> Pt:
    raw = _hex(v, 32, what)
    if raw == ZERO32:
        raise _malformed(f"{what} is the identity")
    try:
        return Pt(raw, r.decode(raw))
    except r.DecodeError as e:
        raise _malformed(f"{what}: {e}") from None


def _scalar(v: Any, what: str) -> int:
    try:
        return r.scalar(_hex(v, 32, what))
    except r.DecodeError as e:
        raise _malformed(f"{what}: {e}") from None


def _ed25519_key_ok(raw: bytes) -> bool:
    """A canonical Edwards point encoding that is not of small order (section 1)."""
    y = int.from_bytes(raw, "little") & ((1 << 255) - 1)
    sign = raw[31] >> 7
    if y >= r.P:
        return False
    yy = y * y % r.P
    ok, x = r._sqrt_ratio_m1((yy - 1) % r.P, (r.D * yy + 1) % r.P)
    if not ok or (x == 0 and sign):
        return False
    if (x & 1) != sign:
        x = r.P - x
    q: r.Point = (x, y, 1, x * y % r.P)
    for _ in range(3):
        q = r.double(q)
    return not (q[0] % r.P == 0 and (q[1] - q[2]) % r.P == 0)


# ---------------------------------------------------------------- proofs (section 4)


@lru_cache(maxsize=64)
def _start(kind: bytes, round_id: str) -> Transcript:
    t = Transcript(PROTOCOL)
    t.append_message(b"kind", kind)
    t.append_message(b"round_id", round_id.encode("ascii"))
    return t


def _transcript(kind: bytes, round_id: str) -> Transcript:
    return _start(kind, round_id).clone()


def _challenge(t: Transcript) -> int:
    return r.wide_reduce(t.challenge_bytes(b"challenge", 64))


def _mul(base: r.FixedBase | r.Point, k: int) -> r.Point:
    return base.mul(k) if isinstance(base, r.FixedBase) else r.mul(k, base)


def _chaum_pedersen(
    t: Transcript,
    g1: r.FixedBase | r.Point,
    g2: r.FixedBase | r.Point,
    p: r.Point,
    q: r.Point,
    proof: dict[str, Any],
) -> bool:
    """Section 4.1, verifier side. `proof` holds decoded commit_1, commit_2 and response."""
    c1, c2, resp = proof["commit_1"], proof["commit_2"], proof["response"]
    t.append_message(b"commit_1", c1.raw)
    t.append_message(b"commit_2", c2.raw)
    c = _challenge(t)
    return r.equal(_mul(g1, resp), r.add(c1.p, r.mul(c, p))) and r.equal(
        _mul(g2, resp), r.add(c2.p, r.mul(c, q))
    )


@lru_cache(maxsize=4)
def _fixed(raw: bytes) -> r.FixedBase:
    return r.FixedBase(r.decode(raw))


def _parse_cp(v: Any, what: str) -> dict[str, Any]:
    o = _obj(v, CP_FIELDS, what)
    return {
        "commit_1": _point(o["commit_1"], f"{what}.commit_1"),
        "commit_2": _point(o["commit_2"], f"{what}.commit_2"),
        "response": _scalar(o["response"], f"{what}.response"),
    }


@dataclass
class Ballot:
    payload: dict[str, Any]
    round_id: str
    nym: str
    voter_key: bytes
    seq: int
    choices: list[Any]
    bit_proofs: list[Any]
    sum_proof: Any
    signature: bytes
    points: list[tuple[Pt, Pt]] = field(default_factory=list)
    bits: list[dict[str, Any]] = field(default_factory=list)
    sums: dict[str, Any] = field(default_factory=dict)


BALLOT_FIELDS = (
    "round_id",
    "nym",
    "voter_key",
    "ballot_seq",
    "choices",
    "bit_proofs",
    "sum_proof",
    "signature",
)


def _ballot_shape(payload: Any) -> Ballot:
    o = _obj(payload, BALLOT_FIELDS, "ballot")
    return Ballot(
        payload=o,
        round_id=_str(o["round_id"], "ballot.round_id"),
        nym=_id(o["nym"], "ballot.nym"),
        voter_key=_hex(o["voter_key"], 32, "ballot.voter_key"),
        seq=_u64(o["ballot_seq"], "ballot.ballot_seq"),
        choices=_list(o["choices"], "ballot.choices"),
        bit_proofs=_list(o["bit_proofs"], "ballot.bit_proofs"),
        sum_proof=o["sum_proof"],
        signature=_hex(o["signature"], 64, "ballot.signature"),
    )


def _ballot_decode(b: Ballot) -> None:
    for j, ch in enumerate(b.choices):
        c = _obj(ch, ("a", "b"), f"ballot.choices[{j}]")
        b.points.append((_point(c["a"], f"choices[{j}].a"), _point(c["b"], f"choices[{j}].b")))
    for j, bp in enumerate(b.bit_proofs):
        o = _obj(bp, BIT_FIELDS, f"ballot.bit_proofs[{j}]")
        d: dict[str, Any] = {}
        for name in BIT_FIELDS:
            what = f"bit_proofs[{j}].{name}"
            d[name] = _point(o[name], what) if name.startswith("commit") else _scalar(o[name], what)
        b.bits.append(d)
    b.sums = _parse_cp(b.sum_proof, "ballot.sum_proof")


def _ballot_proofs_ok(b: Ballot, round_id: str, k_raw: bytes) -> bool:
    """Sections 4.2 and 4.3 for every option, then the sum proof."""
    kfb = _fixed(k_raw)
    nym = b.nym.encode("ascii")
    for j, ((a, bb), bp) in enumerate(zip(b.points, b.bits, strict=True)):
        t = _transcript(b"bit", round_id)
        t.append_message(b"nym", nym)
        t.append_u64(b"ballot_seq", b.seq)
        t.append_u64(b"option", j)
        t.append_message(b"joint_key", k_raw)
        t.append_message(b"a", a.raw)
        t.append_message(b"b", bb.raw)
        for name in ("commit_0_1", "commit_0_2", "commit_1_1", "commit_1_2"):
            t.append_message(name.encode(), bp[name].raw)
        c = _challenge(t)
        ch0 = bp["challenge_0"]
        ch1 = (c - ch0) % r.L
        r0, r1 = bp["response_0"], bp["response_1"]
        b_minus_g = r.sub(bb.p, r.B)
        if not (
            r.equal(r.G.mul(r0), r.add(bp["commit_0_1"].p, r.mul(ch0, a.p)))
            and r.equal(kfb.mul(r0), r.add(bp["commit_0_2"].p, r.mul(ch0, bb.p)))
            and r.equal(r.G.mul(r1), r.add(bp["commit_1_1"].p, r.mul(ch1, a.p)))
            and r.equal(kfb.mul(r1), r.add(bp["commit_1_2"].p, r.mul(ch1, b_minus_g)))
        ):
            return False
    a_sum, b_sum = r.IDENTITY, r.IDENTITY
    for a, bb in b.points:
        a_sum, b_sum = r.add(a_sum, a.p), r.add(b_sum, bb.p)
    t = _transcript(b"sum", round_id)
    t.append_message(b"nym", nym)
    t.append_u64(b"ballot_seq", b.seq)
    t.append_message(b"joint_key", k_raw)
    t.append_message(b"a_sum", r.encode(a_sum))
    t.append_message(b"b_sum", r.encode(b_sum))
    return _chaum_pedersen(t, r.G, kfb, a_sum, r.sub(b_sum, r.B), b.sums)


def _precheck(args: tuple[int, Any, str, bytes, int]) -> tuple[int, bool | None]:
    """Worker: proof validity of one ballot entry, or None if it does not parse."""
    seq, payload, round_id, k_raw, options = args
    try:
        b = _ballot_shape(payload)
        if len(b.choices) != options or len(b.bit_proofs) != options:
            return seq, None
        _ballot_decode(b)
        return seq, _ballot_proofs_ok(b, round_id, k_raw)
    except BoardError:
        return seq, None


# ---------------------------------------------------------------- board


def entry_hash(seq: int, prev: bytes, kind: str, payload: Any) -> bytes:
    """Section 2: SHA-256 of the entry's framing and canonical payload."""
    h = hashlib.sha256()
    h.update(b"d2.booth.entry/1\x00")
    h.update(seq.to_bytes(8, "big"))
    h.update(prev)
    h.update(kind.encode("ascii"))
    h.update(b"\x00")
    h.update(canonical(payload))
    return h.digest()


def ballot_digest(payload: dict[str, Any]) -> bytes:
    """Section 3.5 step 2."""
    blank = dict(payload)
    blank["signature"] = ""
    return hashlib.sha256(b"d2.booth.ballot/1\x00" + canonical(blank)).digest()


def _lagrange_at_zero(i: int, s: list[int]) -> int:
    num, den = 1, 1
    for m in s:
        if m != i:
            num = num * m % r.L
            den = den * (m - i) % r.L
    return num * pow(den, -1, r.L) % r.L


def check_chain(board: Any) -> list[dict[str, Any]]:
    """Envelope shape (malformed) then the hash chain (chain_broken). Returns the entries."""
    top = _obj(board, ("schema", "entries"), "board")
    if top["schema"] != BOARD_SCHEMA:
        raise _malformed(f"board schema is not {BOARD_SCHEMA}")
    entries = _list(top["entries"], "board.entries")
    for i, e in enumerate(entries):
        try:
            _obj(e, ("seq", "prev", "kind", "payload", "hash"), "entry")
            _u64(e["seq"], "seq")
            _hex(e["prev"], 32, "prev")
            _hex(e["hash"], 32, "hash")
            kind = _str(e["kind"], "kind")
            if not kind.isascii() or "\x00" in kind:
                raise _malformed("kind is not ASCII")
            if not isinstance(e["payload"], dict):
                raise _malformed("payload is not an object")
        except BoardError as err:
            err.seq = i
            raise
    prev = ZERO32
    for i, e in enumerate(entries):
        try:
            if e["seq"] != i:
                raise BoardError("chain_broken", f"seq {e['seq']} at position {i}")
            if bytes.fromhex(e["prev"]) != prev:
                raise BoardError("chain_broken", "prev is not the previous entry's hash")
            h = entry_hash(i, prev, e["kind"], e["payload"])
            if h.hex() != e["hash"]:
                raise BoardError("chain_broken", "hash does not match the entry")
        except BoardError as err:
            err.seq = i
            raise
        prev = h
    return entries


@dataclass
class Tally:
    round_id: str
    options: list[str]
    signups: int
    counted: int
    counts: list[int]
    guardians_used: list[int]

    def as_spec(self) -> dict[str, Any]:
        """The shape of vectors.json `tally`."""
        return {
            "signups": self.signups,
            "counted": self.counted,
            "counts": self.counts,
            "guardians_used": self.guardians_used,
        }


class _Replay:
    """The state machine of section 2 and the checks of section 3, one entry at a time."""

    # phases: 0 params, 1 guardians, 2 key, 3 open, 4 closed, 5 done
    ALLOWED = {
        0: {"round.params"},
        1: {"guardian.commitment"},
        2: {"round.key"},
        3: {"signup", "ballot", "round.close"},
        4: {"partial.decryption", "tally"},
        5: set(),
    }

    def __init__(self, jobs: int) -> None:
        self.jobs = jobs
        self.phase = 0
        self.round_id = ""
        self.options: list[str] = []
        self.n = self.k = 0
        self.commitments: list[list[Pt]] = []
        self.k_raw = b""
        self.guardian_keys: list[r.Point] = []
        self.signups: dict[str, bytes] = {}
        self.digests: set[bytes] = set()
        self.last_seq: dict[str, int] = {}
        self.counted: dict[str, list[tuple[Pt, Pt]]] = {}
        self.agg_a: list[r.Point] = []
        self.agg_b: list[r.Point] = []
        self.partials: dict[int, list[r.Point]] = {}
        self.precomputed: dict[int, bool | None] = {}
        self.tally: Tally | None = None

    def run(self, entries: list[dict[str, Any]]) -> Tally:
        for i, e in enumerate(entries):
            try:
                self.entry(i, e, entries)
            except BoardError as err:
                if err.seq is None:
                    err.seq = i
                raise
        if self.tally is None:
            raise BoardError("no_tally", "the board ends before a tally")
        return self.tally

    def entry(self, i: int, e: dict[str, Any], entries: list[dict[str, Any]]) -> None:
        kind = e["kind"]
        if kind not in KINDS:
            raise _malformed(f"unknown kind {kind!r}")
        if kind not in self.ALLOWED[self.phase]:
            raise BoardError("out_of_order", f"{kind} not allowed here")
        payload = e["payload"]
        if kind == "round.params":
            self.params(payload)
        elif kind == "guardian.commitment":
            self.guardian(payload)
        elif kind == "round.key":
            self.key(payload)
            self.precompute(i, entries)
        elif kind == "signup":
            self.signup(payload)
        elif kind == "ballot":
            self.ballot(i, payload)
        elif kind == "round.close":
            _obj(payload, (), "round.close")
            self.close()
        elif kind == "partial.decryption":
            self.partial(payload)
        else:
            self.final(payload)

    # 3.1
    def params(self, payload: Any) -> None:
        names = ("schema", "round_id", "matter_id", "options", "guardians", "threshold")
        o = _obj(payload, names, "round.params")
        if o["schema"] != ROUND_SCHEMA:
            raise _malformed(f"round schema is not {ROUND_SCHEMA}")
        round_id = _str(o["round_id"], "round_id")
        matter_id = _str(o["matter_id"], "matter_id")
        options = [_str(x, "option") for x in _list(o["options"], "options")]
        n = _u64(o["guardians"], "guardians")
        k = _u64(o["threshold"], "threshold")
        if not ID_RE.fullmatch(round_id):
            raise BoardError("params", "round_id charset or length")
        if not 1 <= len(matter_id.encode("utf-8")) <= 256:
            raise BoardError("params", "matter_id must be 1 to 256 bytes")
        if not 2 <= len(options) <= 64:
            raise BoardError("params", "2 to 64 options")
        if any(not 1 <= len(x.encode("utf-8")) <= 256 for x in options):
            raise BoardError("params", "option labels must be 1 to 256 bytes")
        if not 1 <= k <= n <= 64:
            raise BoardError("params", "need 1 <= threshold <= guardians <= 64")
        self.round_id, self.options, self.n, self.k = round_id, options, n, k
        self.phase = 1

    # 3.2
    def guardian(self, payload: Any) -> None:
        o = _obj(payload, ("guardian", "commitments", "proof"), "guardian.commitment")
        i = _u64(o["guardian"], "guardian")
        cs = _list(o["commitments"], "commitments")
        if len(cs) != self.k:
            raise _malformed(f"{len(cs)} commitments, threshold is {self.k}")
        commitments = [_point(c, f"commitments[{d}]") for d, c in enumerate(cs)]
        proof = _obj(o["proof"], ("commit", "response"), "guardian.proof")
        a = _point(proof["commit"], "proof.commit")
        v = _scalar(proof["response"], "proof.response")
        expected = len(self.commitments) + 1
        if i != expected:
            raise BoardError("out_of_order", f"guardian {i} where {expected} was expected")
        t = _transcript(b"guardian", self.round_id)
        t.append_u64(b"guardian", i)
        t.append_message(b"constant", commitments[0].raw)
        t.append_message(b"commit", a.raw)
        c = _challenge(t)
        if not r.equal(r.G.mul(v), r.add(a.p, r.mul(c, commitments[0].p))):
            raise BoardError("proof_failed", f"guardian {i} proof of knowledge")
        self.commitments.append(commitments)
        if len(self.commitments) == self.n:
            self.phase = 2

    # 3.3
    def key(self, payload: Any) -> None:
        o = _obj(payload, ("joint_key", "guardian_keys"), "round.key")
        k_pub = _point(o["joint_key"], "joint_key")
        keys = [_point(x, "guardian_keys[]") for x in _list(o["guardian_keys"], "guardian_keys")]
        joint = r.IDENTITY
        for cs in self.commitments:
            joint = r.add(joint, cs[0].p)
        derived = []
        for j in range(1, self.n + 1):
            kj = r.IDENTITY
            for cs in self.commitments:
                for d, c in enumerate(cs):
                    kj = r.add(kj, r.mul(pow(j, d, r.L), c.p))
            derived.append(kj)
        if not r.equal(joint, k_pub.p):
            raise _malformed("joint_key is not what the commitments derive to")
        if len(keys) != self.n or any(
            not r.equal(a.p, b) for a, b in zip(keys, derived, strict=True)
        ):
            raise _malformed("guardian_keys are not what the commitments derive to")
        self.k_raw = r.encode(joint)
        self.guardian_keys = derived
        self.phase = 3

    def precompute(self, after: int, entries: list[dict[str, Any]]) -> None:
        """Check ballot proofs on all cores first; the replay below reuses the results."""
        if self.jobs <= 1:
            return
        work = [
            (j, e["payload"], self.round_id, self.k_raw, len(self.options))
            for j, e in enumerate(entries)
            if j > after and e["kind"] == "ballot"
        ]
        if len(work) < 2 * self.jobs:
            return
        with ProcessPoolExecutor(self.jobs) as pool:
            for j, ok in pool.map(_precheck, work, chunksize=max(1, len(work) // (8 * self.jobs))):
                self.precomputed[j] = ok

    # 3.4
    def signup(self, payload: Any) -> None:
        o = _obj(payload, ("nym", "voter_key"), "signup")
        nym = _id(o["nym"], "signup.nym")
        key = _hex(o["voter_key"], 32, "signup.voter_key")
        if not _ed25519_key_ok(key):
            raise _malformed("voter_key is not a valid Ed25519 key of large order")
        if nym in self.signups:
            raise BoardError("duplicate_signup", f"{nym} signed up twice")
        self.signups[nym] = key

    # 3.5
    def ballot(self, i: int, payload: Any) -> None:
        b = _ballot_shape(payload)
        # step 1
        if b.round_id != self.round_id:
            raise _malformed("ballot round_id is not the round's")
        if self.signups.get(b.nym) != b.voter_key:
            raise BoardError("not_signed_up", f"{b.nym} with this key has not signed up")
        if len(b.choices) != len(self.options) or len(b.bit_proofs) != len(self.options):
            raise _malformed("choices and bit_proofs need one element per option")
        _ballot_decode(b)
        # step 2
        digest = ballot_digest(b.payload)
        try:
            VerifyKey(b.voter_key).verify(digest, b.signature)
        except (BadSignatureError, ValueError):
            raise BoardError("bad_signature", f"ballot of {b.nym}") from None
        # steps 3 and 4
        ok = self.precomputed.get(i)
        if ok is None:
            ok = _ballot_proofs_ok(b, self.round_id, self.k_raw)
        if not ok:
            raise BoardError("proof_failed", f"ballot of {b.nym}")
        # step 5
        if digest in self.digests:
            raise BoardError("ballot_replay", "copy of an accepted ballot")
        if b.nym in self.last_seq and b.seq <= self.last_seq[b.nym]:
            raise BoardError("ballot_replay", f"ballot_seq {b.seq} not above the previous one")
        self.digests.add(digest)
        self.last_seq[b.nym] = b.seq
        self.counted[b.nym] = b.points

    # 3.6
    def close(self) -> None:
        m = len(self.options)
        self.agg_a = [r.IDENTITY] * m
        self.agg_b = [r.IDENTITY] * m
        for points in self.counted.values():
            for j, (a, b) in enumerate(points):
                self.agg_a[j] = r.add(self.agg_a[j], a.p)
                self.agg_b[j] = r.add(self.agg_b[j], b.p)
        self.phase = 4

    # 3.7
    def partial(self, payload: Any) -> None:
        o = _obj(payload, ("guardian", "shares"), "partial.decryption")
        i = _u64(o["guardian"], "guardian")
        shares = _list(o["shares"], "shares")
        if not 1 <= i <= self.n:
            raise _malformed(f"guardian {i} out of range")
        if i in self.partials:
            raise _malformed(f"guardian {i} published twice")
        if len(shares) != len(self.options):
            raise _malformed("one share per option")
        parsed = []
        for j, s in enumerate(shares):
            so = _obj(s, ("m", "proof"), f"shares[{j}]")
            parsed.append((_point(so["m"], f"shares[{j}].m"), _parse_cp(so["proof"], "proof")))
        if not self.counted:
            raise BoardError("no_tally", "no ballot counted, so there is nothing to decrypt")
        ki = self.guardian_keys[i - 1]
        ki_raw = r.encode(ki)
        for j, (mpt, proof) in enumerate(parsed):
            aj = self.agg_a[j]
            t = _transcript(b"decrypt", self.round_id)
            t.append_u64(b"guardian", i)
            t.append_u64(b"option", j)
            t.append_message(b"guardian_key", ki_raw)
            t.append_message(b"aggregate", r.encode(aj))
            t.append_message(b"share", mpt.raw)
            if not _chaum_pedersen(t, r.G, aj, ki, mpt.p, proof):
                raise BoardError("proof_failed", f"guardian {i} share for option {j}")
        self.partials[i] = [m.p for m, _ in parsed]

    # 3.8
    def final(self, payload: Any) -> None:
        names = ("signups", "counted", "counts", "guardians_used")
        o = _obj(payload, names, "tally")
        signups = _u64(o["signups"], "signups")
        counted = _u64(o["counted"], "counted")
        counts = [_u64(x, "counts[]") for x in _list(o["counts"], "counts")]
        used = [_u64(x, "guardians_used[]") for x in _list(o["guardians_used"], "guardians_used")]
        if not self.counted:
            raise BoardError("no_tally", "no ballot counted")
        if len(counts) != len(self.options) or sum(counts) != counted:
            raise _malformed("counts need one entry per option, summing to counted")
        if signups != len(self.signups) or counted != len(self.counted):
            raise _malformed("signups or counted do not match the board")
        if any(b <= a for a, b in zip(used, used[1:], strict=False)):
            raise _malformed("guardians_used must be ascending and distinct")
        if len(used) < self.k:
            raise BoardError("below_threshold", f"{len(used)} guardians, threshold {self.k}")
        if any(g not in self.partials for g in used):
            raise _malformed("guardians_used names a guardian with no partial decryption")
        lam = {i: _lagrange_at_zero(i, used) for i in used}
        for j, count in enumerate(counts):
            d = r.IDENTITY
            for i in used:
                d = r.add(d, r.mul(lam[i], self.partials[i][j]))
            if not r.equal(r.sub(self.agg_b[j], d), r.G.mul(count)):
                raise BoardError("tally_mismatch", f"option {j}")
        self.tally = Tally(self.round_id, self.options, signups, counted, counts, used)
        self.phase = 5


def verify(board: Any, jobs: int = 1) -> Tally:
    """Verify a parsed board (see `load`) and return its tally, or raise BoardError."""
    entries = check_chain(board)
    return _Replay(jobs).run(entries)


def verify_bytes(data: bytes | str, jobs: int = 1) -> Tally:
    return verify(load(data), jobs)
