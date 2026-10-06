"""Keccak-f[1600], Merlin, ristretto255 (RFC 9496) and strict/canonical JSON."""

import hashlib

import pytest
from d2_booth_verify import ristretto as r
from d2_booth_verify.canonical import canonical, load
from d2_booth_verify.errors import BoardError
from d2_booth_verify.merlin import Transcript, keccak_f1600


def _sha3_256_one_block(msg: bytes) -> bytes:
    st = bytearray(200)
    padded = bytearray(msg + b"\x06" + bytes(135 - len(msg)))
    padded[135] ^= 0x80
    for i, byte in enumerate(padded):
        st[i] ^= byte
    keccak_f1600(st)
    return bytes(st[:32])


@pytest.mark.parametrize("msg", [b"", b"abc", b"x" * 100])
def test_keccak_matches_sha3(msg):
    assert _sha3_256_one_block(msg) == hashlib.sha3_256(msg).digest()


def test_merlin_published_vector():
    # merlin's own test: "test protocol" / "some label" / "some data" / 32-byte "challenge".
    t = Transcript(b"test protocol")
    t.append_message(b"some label", b"some data")
    assert (
        t.challenge_bytes(b"challenge", 32).hex()
        == "d5a21972d0d5fe320c0d263fac7fffb8145aa640af6e9bca177c03c7efcf0615"
    )


def test_merlin_clone_is_independent():
    t = Transcript(b"p")
    u = t.clone()
    t.append_message(b"l", b"x")
    u.append_message(b"l", b"x")
    assert t.challenge_bytes(b"c", 64) == u.challenge_bytes(b"c", 64)
    t.append_message(b"l", b"y")
    assert t.challenge_bytes(b"c", 8) != u.challenge_bytes(b"c", 8)


# RFC 9496 appendix A.1: encodings of B * i.
MULTIPLES = [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "e2f2ae0a6abc4e71a884a961c500515f58e30b6aa582dd8db6a65945e08d2d76",
    "6a493210f7499cd17fecb510ae0cea23a110e8d5b901f8acadd3095c73a3b919",
    "94741f5d5d52755ece4f23f044ee27d5d1ea1e2bd196b462166b16152a9d0259",
    "da80862773358b466ffadfe0b3293ab3d9fd53c5ea6c955358f568322daf6a57",
    "e882b131016b52c1d3337080187cf768423efccbb517bb495ab812c4160ff44e",
]


@pytest.mark.parametrize("i", range(len(MULTIPLES)))
def test_ristretto_multiples_of_the_generator(i):
    assert r.encode(r.mul(i, r.B)).hex() == MULTIPLES[i]
    assert r.encode(r.G.mul(i)).hex() == MULTIPLES[i]
    assert r.encode(r.decode(bytes.fromhex(MULTIPLES[i]))).hex() == MULTIPLES[i]


def test_ristretto_group_order_and_constants():
    assert r.equal(r.mul(r.L, r.B), r.IDENTITY) is True
    assert r.equal(r.G.mul(r.L - 1), r.neg(r.B))
    assert pow(r.SQRT_M1, 2, r.P) == r.P - 1


@pytest.mark.parametrize(
    "hexstr",
    [
        # non-canonical field elements (>= p) and negative (odd) ones, RFC 9496 A.2
        "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
        "0100000000000000000000000000000000000000000000000000000000000000",
        # Ed25519 basepoint bytes: not a valid ristretto255 encoding
        "5866666666666666666666666666666666666666666666666666666666666666",
    ],
)
def test_ristretto_bad_encodings(hexstr):
    with pytest.raises(r.DecodeError):
        r.decode(bytes.fromhex(hexstr))


def test_scalars_must_be_canonical():
    assert r.scalar(r.scalar_bytes(r.L - 1)) == r.L - 1
    with pytest.raises(r.DecodeError):
        r.scalar(r.L.to_bytes(32, "little"))


def test_canonical_json():
    v = {"b": [1, "x"], "a": {"z": 0, "é": '"\\\b\t\n\f\r\x01\x7f/é'}, "A": 2**64 - 1}
    assert (
        canonical(v)
        == (
            '{"A":18446744073709551615,"a":{"z":0,"é":"\\"\\\\\\b\\t\\n\\f\\r\\u0001\x7f/é"},'
            '"b":[1,"x"]}'
        ).encode()
    )


@pytest.mark.parametrize("bad", [None, True, False, -1, 2**64, {"k": [None]}])
def test_canonical_refuses_non_payload_values(bad):
    with pytest.raises(BoardError) as err:
        canonical({"x": bad})
    assert err.value.code == "malformed"


@pytest.mark.parametrize(
    "text", ['{"a":1,"a":2}', '{"a":1.0}', '{"a":1e3}', '{"a":NaN}', "{", '{"a":"\\ud800"}']
)
def test_strict_parse(text):
    with pytest.raises(BoardError) as err:
        canonical(load(text))
    assert err.value.code == "malformed"
