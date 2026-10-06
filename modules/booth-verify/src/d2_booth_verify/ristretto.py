"""ristretto255 (RFC 9496) and its scalars, in pure Python.

Written from RFC 9496 section 4 and checked against its test vectors (section A). Points are
kept in extended twisted Edwards coordinates (X, Y, Z, T) on edwards25519 (a = -1). Nothing
here is constant time: a verifier handles only public data. The test generator in `testgen.py`
also uses it with secrets; that is test material only.
"""

from __future__ import annotations

P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493  # group order
D = (-121665 * pow(121666, -1, P)) % P
D2 = (2 * D) % P
SQRT_M1 = 19681161376707505956807079304988542015446066515923890162744021073123829784752
INVSQRT_A_MINUS_D = 54469307008909316920995813868745141605393597292927456921205312896311721017578


class DecodeError(ValueError):
    """Bytes that are not the canonical encoding of a ristretto255 element."""


def _is_negative(x: int) -> bool:
    return x % P & 1 == 1


def _abs(x: int) -> int:
    x %= P
    return P - x if x & 1 else x


def _sqrt_ratio_m1(u: int, v: int) -> tuple[bool, int]:
    """RFC 9496 section 4.2: (was_square, nonnegative sqrt(u/v) or sqrt(i*u/v))."""
    v3 = v * v % P * v % P
    v7 = v3 * v3 % P * v % P
    r = u * v3 % P * pow(u * v7 % P, (P - 5) // 8, P) % P
    check = v * r % P * r % P
    correct = check == u % P
    flipped = check == (-u) % P
    flipped_i = check == (-u) * SQRT_M1 % P
    if flipped or flipped_i:
        r = r * SQRT_M1 % P
    return correct or flipped, _abs(r)


Point = tuple[int, int, int, int]

IDENTITY: Point = (0, 1, 1, 0)


def add(p: Point, q: Point) -> Point:
    x1, y1, z1, t1 = p
    x2, y2, z2, t2 = q
    a = (y1 - x1) * (y2 - x2) % P
    b = (y1 + x1) * (y2 + x2) % P
    c = t1 * D2 % P * t2 % P
    d = 2 * z1 * z2 % P
    e, f, g, h = b - a, d - c, d + c, b + a
    return (e * f % P, g * h % P, f * g % P, e * h % P)


def neg(p: Point) -> Point:
    x, y, z, t = p
    return ((-x) % P, y, z, (-t) % P)


def sub(p: Point, q: Point) -> Point:
    return add(p, neg(q))


def double(p: Point) -> Point:
    x1, y1, z1, _ = p
    a = x1 * x1 % P
    b = y1 * y1 % P
    c = 2 * z1 * z1 % P
    h = a + b
    e = h - (x1 + y1) * (x1 + y1) % P
    g = a - b
    f = c + g
    return (e * f % P, g * h % P, f * g % P, e * h % P)


def equal(p: Point, q: Point) -> bool:
    """Ristretto equality (RFC 9496 section 4.3.3)."""
    x1, y1, _, _ = p
    x2, y2, _, _ = q
    return (x1 * y2 - y1 * x2) % P == 0 or (y1 * y2 - x1 * x2) % P == 0


def decode(data: bytes) -> Point:
    """RFC 9496 section 4.3.1. Raises DecodeError for anything but a canonical encoding."""
    if len(data) != 32:
        raise DecodeError("a point is 32 bytes")
    s = int.from_bytes(data, "little")
    if s >= P or s & 1:
        raise DecodeError("non-canonical or negative field element")
    ss = s * s % P
    u1 = (1 - ss) % P
    u2 = (1 + ss) % P
    u2_sqr = u2 * u2 % P
    v = (-(D * u1 % P * u1) - u2_sqr) % P
    was_square, invsqrt = _sqrt_ratio_m1(1, v * u2_sqr % P)
    den_x = invsqrt * u2 % P
    den_y = invsqrt * den_x % P * v % P
    x = _abs(2 * s * den_x)
    y = u1 * den_y % P
    t = x * y % P
    if not was_square or _is_negative(t) or y == 0:
        raise DecodeError("not a valid ristretto255 encoding")
    return (x, y, 1, t)


def encode(p: Point) -> bytes:
    """RFC 9496 section 4.3.2."""
    x0, y0, z0, t0 = p
    u1 = (z0 + y0) * (z0 - y0) % P
    u2 = x0 * y0 % P
    _, invsqrt = _sqrt_ratio_m1(1, u1 * u2 % P * u2 % P)
    den1 = invsqrt * u1 % P
    den2 = invsqrt * u2 % P
    z_inv = den1 * den2 % P * t0 % P
    if _is_negative(t0 * z_inv):
        x, y = y0 * SQRT_M1 % P, x0 * SQRT_M1 % P
        den_inv = den1 * INVSQRT_A_MINUS_D % P
    else:
        x, y = x0, y0
        den_inv = den2
    if _is_negative(x * z_inv):
        y = -y
    s = _abs(den_inv * (z0 - y))
    return s.to_bytes(32, "little")


# The ristretto255 generator: the edwards25519 basepoint (RFC 9496 section 4.4).
_BY = 4 * pow(5, -1, P) % P
_BX = 15112221349535400772501151409588531511454012693041857206046113283949847762202
B: Point = (_BX, _BY, 1, _BX * _BY % P)


def mul(k: int, p: Point) -> Point:
    """k * p for any integer k (reduced mod L), 4-bit fixed window."""
    k %= L
    table = [IDENTITY, p]
    for _ in range(14):
        table.append(add(table[-1], p))
    r = IDENTITY
    for shift in range(252, -1, -4):
        r = double(double(double(double(r))))
        digit = (k >> shift) & 15
        if digit:
            r = add(r, table[digit])
    return r


class FixedBase:
    """Precomputed multiples d * 16^i * p, for a point multiplied many times (G, the joint key)."""

    def __init__(self, p: Point) -> None:
        self.rows: list[list[Point]] = []
        base = p
        for _ in range(64):
            row = [IDENTITY, base]
            for _ in range(14):
                row.append(add(row[-1], base))
            self.rows.append(row)
            base = double(double(double(double(base))))

    def mul(self, k: int) -> Point:
        k %= L
        r = IDENTITY
        for row in self.rows:
            digit = k & 15
            if digit:
                r = add(r, row[digit])
            k >>= 4
        return r


G = FixedBase(B)


def scalar(data: bytes) -> int:
    """A canonical little-endian scalar; raises DecodeError when >= L or not 32 bytes."""
    if len(data) != 32:
        raise DecodeError("a scalar is 32 bytes")
    k = int.from_bytes(data, "little")
    if k >= L:
        raise DecodeError("non-canonical scalar")
    return k


def scalar_bytes(k: int) -> bytes:
    return (k % L).to_bytes(32, "little")


def wide_reduce(data: bytes) -> int:
    """64 bytes little-endian reduced mod L (from_bytes_mod_order_wide)."""
    return int.from_bytes(data, "little") % L
