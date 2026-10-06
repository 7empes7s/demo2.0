"""Merlin transcripts (merlin 3, "Merlin v1.0") over STROBE-128 over Keccak-f[1600].

Written from the Merlin and STROBE specifications, not from any Merlin library: only the
operations Merlin uses (meta-AD, AD, PRF) are implemented. Checked against Merlin's published
test vector in the tests.
"""

from __future__ import annotations

_MASK = (1 << 64) - 1

_RC = (
    0x0000000000000001,
    0x0000000000008082,
    0x800000000000808A,
    0x8000000080008000,
    0x000000000000808B,
    0x0000000080000001,
    0x8000000080008081,
    0x8000000000008009,
    0x000000000000008A,
    0x0000000000000088,
    0x0000000080008009,
    0x000000008000000A,
    0x000000008000808B,
    0x800000000000008B,
    0x8000000000008089,
    0x8000000000008003,
    0x8000000000008002,
    0x8000000000000080,
    0x000000000000800A,
    0x800000008000000A,
    0x8000000080008081,
    0x8000000000008080,
    0x0000000080000001,
    0x8000000080008008,
)

# Rotation offsets r[x + 5y] from the Keccak reference.
_ROT = (
    0,
    1,
    62,
    28,
    27,
    36,
    44,
    6,
    55,
    20,
    3,
    10,
    43,
    25,
    39,
    41,
    45,
    15,
    21,
    8,
    18,
    2,
    61,
    56,
    14,
)


def _rol(v: int, n: int) -> int:
    return ((v << n) | (v >> (64 - n))) & _MASK if n else v


def keccak_f1600(state: bytearray) -> None:
    """Apply Keccak-f[1600] in place to a 200-byte state (lanes little-endian, lane x + 5y)."""
    a = [int.from_bytes(state[8 * i : 8 * i + 8], "little") for i in range(25)]
    for rc in _RC:
        # theta
        c = [a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol(c[(x + 1) % 5], 1) for x in range(5)]
        a = [a[i] ^ d[i % 5] for i in range(25)]
        # rho and pi: B[y, 2x + 3y] = rot(A[x, y], r[x, y])
        b = [0] * 25
        for x in range(5):
            for y in range(5):
                b[y + 5 * ((2 * x + 3 * y) % 5)] = _rol(a[x + 5 * y], _ROT[x + 5 * y])
        # chi
        a = [
            b[i] ^ ((~b[(i % 5 + 1) % 5 + 5 * (i // 5)]) & b[(i % 5 + 2) % 5 + 5 * (i // 5)])
            for i in range(25)
        ]
        # iota
        a[0] ^= rc
    for i in range(25):
        state[8 * i : 8 * i + 8] = a[i].to_bytes(8, "little")


_R = 166  # STROBE-128 rate: 200 - 128/4 - 2

_FLAG_I = 1
_FLAG_A = 1 << 1
_FLAG_C = 1 << 2
_FLAG_T = 1 << 3
_FLAG_M = 1 << 4
_FLAG_K = 1 << 5


class Strobe128:
    """The subset of STROBE v1.0.2 (security 128) that Merlin uses."""

    def __init__(self, protocol_label: bytes) -> None:
        st = bytearray(200)
        st[0:6] = bytes([1, _R + 2, 1, 0, 1, 96])
        st[6:18] = b"STROBEv1.0.2"
        keccak_f1600(st)
        self.st = st
        self.pos = 0
        self.pos_begin = 0
        self.cur_flags = 0
        self.meta_ad(protocol_label, False)

    def _run_f(self) -> None:
        self.st[self.pos] ^= self.pos_begin
        self.st[self.pos + 1] ^= 0x04
        self.st[_R + 1] ^= 0x80
        keccak_f1600(self.st)
        self.pos = 0
        self.pos_begin = 0

    def _absorb(self, data: bytes) -> None:
        for byte in data:
            self.st[self.pos] ^= byte
            self.pos += 1
            if self.pos == _R:
                self._run_f()

    def _squeeze(self, n: int) -> bytes:
        out = bytearray(n)
        for i in range(n):
            out[i] = self.st[self.pos]
            self.st[self.pos] = 0
            self.pos += 1
            if self.pos == _R:
                self._run_f()
        return bytes(out)

    def _begin_op(self, flags: int, more: bool) -> None:
        if more:
            if flags != self.cur_flags:
                raise ValueError("STROBE: continued operation with different flags")
            return
        if flags & _FLAG_T:
            raise ValueError("STROBE: transport operations are not used by Merlin")
        old_begin = self.pos_begin
        self.pos_begin = self.pos + 1
        self.cur_flags = flags
        self._absorb(bytes([old_begin, flags]))
        if flags & (_FLAG_C | _FLAG_K) and self.pos != 0:
            self._run_f()

    def meta_ad(self, data: bytes, more: bool) -> None:
        self._begin_op(_FLAG_M | _FLAG_A, more)
        self._absorb(data)

    def ad(self, data: bytes, more: bool) -> None:
        self._begin_op(_FLAG_A, more)
        self._absorb(data)

    def prf(self, n: int, more: bool) -> bytes:
        self._begin_op(_FLAG_I | _FLAG_A | _FLAG_C, more)
        return self._squeeze(n)


class Transcript:
    """A Merlin transcript: Strobe-128("Merlin v1.0") then append_message("dom-sep", label)."""

    def __init__(self, label: bytes) -> None:
        self.strobe = Strobe128(b"Merlin v1.0")
        self.append_message(b"dom-sep", label)

    def clone(self) -> Transcript:
        """An independent copy (to reuse a common prefix)."""
        t = Transcript.__new__(Transcript)
        s = Strobe128.__new__(Strobe128)
        s.st = bytearray(self.strobe.st)
        s.pos, s.pos_begin, s.cur_flags = (
            self.strobe.pos,
            self.strobe.pos_begin,
            self.strobe.cur_flags,
        )
        t.strobe = s
        return t

    def append_message(self, label: bytes, message: bytes) -> None:
        self.strobe.meta_ad(label, False)
        self.strobe.meta_ad(len(message).to_bytes(4, "little"), True)
        self.strobe.ad(message, False)

    def append_u64(self, label: bytes, n: int) -> None:
        self.append_message(label, n.to_bytes(8, "little"))

    def challenge_bytes(self, label: bytes, n: int) -> bytes:
        self.strobe.meta_ad(label, False)
        self.strobe.meta_ad(n.to_bytes(4, "little"), True)
        return self.strobe.prf(n, False)
