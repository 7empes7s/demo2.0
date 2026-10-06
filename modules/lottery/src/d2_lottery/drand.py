"""drand beacons: chain info, round timing, and full beacon verification (BLS12-381).

Format: spec/lottery/README.md section 4. BLS pairings come from py_ecc (Ethereum Foundation),
a pure-Python BLS12-381 implementation; one beacon check takes about a second.

The HTTP fetch is injectable: `DrandClient(chain, fetch=...)` takes any `fetch(url) -> bytes`.
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from py_ecc.bls.g2_primitives import subgroup_check
from py_ecc.bls.hash_to_curve import hash_to_G1, hash_to_G2
from py_ecc.bls.point_compression import decompress_G1, decompress_G2
from py_ecc.bls.typing import G1Compressed, G2Compressed
from py_ecc.optimized_bls12_381 import FQ12, G1, G2, final_exponentiate, is_inf, neg
from py_ecc.optimized_bls12_381.optimized_pairing import miller_loop

QUICKNET = "bls-unchained-g1-rfc9380"
CHAINED = "pedersen-bls-chained"
SCHEMES = (QUICKNET, CHAINED)
DST_G1 = b"BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_"
DST_G2 = b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_"
DEFAULT_URL = "https://api.drand.sh"

Fetch = Callable[[str], bytes]


class BeaconError(ValueError):
    """A beacon or chain info is malformed or does not verify."""


def _hex(value: Any, size: int, what: str) -> bytes:
    """Exactly `size` bytes as lowercase hex: no whitespace, no prefix (bytes.fromhex is laxer)."""
    if not isinstance(value, str) or not re.fullmatch(f"[0-9a-f]{{{2 * size}}}", value):
        raise BeaconError(f"{what} must be {size} bytes of lowercase hex")
    return bytes.fromhex(value)


def _uint(value: Any, what: str, minimum: int = 0) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise BeaconError(f"{what} must be an integer >= {minimum}")
    return value


@dataclass(frozen=True)
class ChainInfo:
    public_key: str
    period: int
    genesis_time: int
    group_hash: str
    scheme: str
    beacon_id: str

    def __post_init__(self) -> None:
        if self.scheme not in SCHEMES:
            raise BeaconError(f"unsupported scheme {self.scheme!r}; supported: {SCHEMES}")
        _hex(self.public_key, 96 if self.scheme == QUICKNET else 48, "public_key")
        _hex(self.group_hash, 32, "group_hash")
        _uint(self.period, "period", 1)
        _uint(self.genesis_time, "genesis_time")
        if not isinstance(self.beacon_id, str) or not self.beacon_id:
            raise BeaconError("beacon_id must be a non-empty string")

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> ChainInfo:
        """Accepts this module's field names or drand's own /info JSON."""
        try:
            return cls(
                public_key=raw["public_key"],
                period=raw["period"],
                genesis_time=raw["genesis_time"],
                group_hash=raw.get("group_hash", raw.get("groupHash")),
                scheme=raw.get("scheme", raw.get("schemeID")),
                beacon_id=raw.get("beacon_id", (raw.get("metadata") or {}).get("beaconID")),
            )
        except (KeyError, TypeError, AttributeError) as exc:
            raise BeaconError(f"malformed chain info: {exc}") from exc

    def matches(self, raw: Any) -> bool:
        """Spec section 7: a transcript's chain_info has exactly the spec's six fields, each
        equal to this chain's in JSON type and value (no drand /info names, no extra fields)."""
        mine = self.to_dict()
        return (
            isinstance(raw, Mapping)
            and set(raw) == set(mine)
            and all(type(raw[k]) is type(v) and raw[k] == v for k, v in mine.items())
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "public_key": self.public_key,
            "period": self.period,
            "genesis_time": self.genesis_time,
            "group_hash": self.group_hash,
            "scheme": self.scheme,
            "beacon_id": self.beacon_id,
        }

    @property
    def hash(self) -> str:
        """drand's chain hash (common/chain/info.go Info.Hash)."""
        h = hashlib.sha256()
        h.update(self.period.to_bytes(4, "big"))
        h.update(self.genesis_time.to_bytes(8, "big"))
        h.update(bytes.fromhex(self.public_key))
        h.update(bytes.fromhex(self.group_hash))
        if self.beacon_id != "default":
            h.update(self.beacon_id.encode())
        return h.hexdigest()

    def round_time(self, round_: int) -> int:
        """Unix time at which `round_` is produced (round 1 at genesis)."""
        return self.genesis_time + (_uint(round_, "round", 1) - 1) * self.period

    def first_round_at_or_after(self, unix: int) -> int:
        """The first round produced at or after `unix`."""
        if unix <= self.genesis_time:
            return 1
        return -((self.genesis_time - unix) // self.period) + 1


# The League of Entropy mainnet chains (values from drand's own clients, tlock-js and
# drand-client; the hashes below are recomputed from these fields by the tests).
KNOWN_CHAINS: dict[str, ChainInfo] = {
    "quicknet": ChainInfo(
        public_key="83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c"
        "8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf8"
        "09bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
        period=3,
        genesis_time=1692803367,
        group_hash="f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
        scheme=QUICKNET,
        beacon_id="quicknet",
    ),
    "default": ChainInfo(
        public_key="868f005eb8e6e4ca0a47c8a77ceaa5309a47978a7c71bc5cce96366b5d7a5699"
        "37c529eeda66c7293784a9402801af31",
        period=30,
        genesis_time=1595431050,
        group_hash="176f93498eac9ca337150b46d21dd58673ea4e3581185f869672e59fa4cb390a",
        scheme=CHAINED,
        beacon_id="default",
    ),
}
KNOWN_CHAIN_HASHES = {c.hash: c for c in KNOWN_CHAINS.values()}


@dataclass(frozen=True)
class Beacon:
    round: int
    randomness: str
    signature: str
    previous_signature: str | None = None

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> Beacon:
        if not isinstance(raw, Mapping):
            raise BeaconError("a beacon is an object")
        if "previous_signature" in raw and raw["previous_signature"] is None:
            raise BeaconError("previous_signature is hex when present, never null")
        return cls(
            round=_uint(raw.get("round"), "round", 1),
            randomness=raw.get("randomness"),
            signature=raw.get("signature"),
            previous_signature=raw.get("previous_signature"),
        )

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "round": self.round,
            "randomness": self.randomness,
            "signature": self.signature,
        }
        if self.previous_signature is not None:
            out["previous_signature"] = self.previous_signature
        return out


def _g1(raw: bytes) -> Any:
    try:
        point = decompress_G1(G1Compressed(int.from_bytes(raw, "big")))
    except (ValueError, AssertionError) as exc:
        raise BeaconError(f"not a G1 point: {exc}") from exc
    if is_inf(point) or not subgroup_check(point):
        raise BeaconError("G1 point is infinity or outside the subgroup")
    return point


def _g2(raw: bytes) -> Any:
    try:
        point = decompress_G2(
            G2Compressed((int.from_bytes(raw[:48], "big"), int.from_bytes(raw[48:], "big")))
        )
    except (ValueError, AssertionError) as exc:
        raise BeaconError(f"not a G2 point: {exc}") from exc
    if is_inf(point) or not subgroup_check(point):
        raise BeaconError("G2 point is infinity or outside the subgroup")
    return point


def _pairings_equal(q1: Any, p1: Any, q2: Any, p2: Any) -> bool:
    """e(p1, q1) == e(p2, q2), with q in G2 and p in G1."""
    product = miller_loop(q1, p1) * miller_loop(neg(q2), p2)
    return final_exponentiate(product) == FQ12.one()


def verify_beacon(chain: ChainInfo, beacon: Beacon, expected_round: int | None = None) -> bytes:
    """Return the beacon's 32 bytes of randomness, or raise BeaconError.

    Checks the round, that randomness = SHA-256(signature), and the BLS signature over the
    scheme's message under the chain's public key.
    """
    if expected_round is not None and beacon.round != expected_round:
        raise BeaconError(f"beacon is round {beacon.round}, expected {expected_round}")
    round_bytes = _uint(beacon.round, "round", 1).to_bytes(8, "big")
    if chain.scheme == QUICKNET:
        sig_raw = _hex(beacon.signature, 48, "signature")
        if beacon.previous_signature is not None:
            raise BeaconError("an unchained beacon has no previous_signature")
        message = hashlib.sha256(round_bytes).digest()
        pk = _g2(bytes.fromhex(chain.public_key))
        sig = _g1(sig_raw)
        ok = _pairings_equal(pk, hash_to_G1(message, DST_G1, hashlib.sha256), G2, sig)
    else:
        sig_raw = _hex(beacon.signature, 96, "signature")
        prev = _hex(beacon.previous_signature, 96, "previous_signature")
        message = hashlib.sha256(prev + round_bytes).digest()
        pk = _g1(bytes.fromhex(chain.public_key))
        sig = _g2(sig_raw)
        ok = _pairings_equal(hash_to_G2(message, DST_G2, hashlib.sha256), pk, sig, G1)
    randomness = _hex(beacon.randomness, 32, "randomness")
    if randomness != hashlib.sha256(sig_raw).digest():
        raise BeaconError("randomness is not SHA-256(signature)")
    if not ok:
        raise BeaconError("BLS signature does not verify under the chain's public key")
    return randomness


def http_fetch(url: str) -> bytes:  # pragma: no cover - network
    with urllib.request.urlopen(url, timeout=20) as response:
        return response.read()


class DrandClient:
    """Fetches and verifies beacons. `fetch(url) -> bytes` is injectable for tests and mirrors."""

    def __init__(self, chain: ChainInfo, base_url: str = DEFAULT_URL, fetch: Fetch = http_fetch):
        self.chain = chain
        self.base_url = base_url.rstrip("/")
        self._fetch = fetch

    def info(self) -> ChainInfo:
        """The relay's chain info, checked against the pinned chain."""
        raw = json.loads(self._fetch(f"{self.base_url}/{self.chain.hash}/info"))
        got = ChainInfo.from_dict(raw)
        if got != self.chain:
            raise BeaconError("the relay serves different chain info than the pinned chain")
        return got

    def beacon(self, round_: int) -> Beacon:
        """Fetch one round and verify it fully; never returns an unverified beacon."""
        raw = json.loads(self._fetch(f"{self.base_url}/{self.chain.hash}/public/{round_}"))
        beacon = Beacon.from_dict(raw)
        verify_beacon(self.chain, beacon, round_)
        return beacon
