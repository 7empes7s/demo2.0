import json

import pytest
from d2_lottery import KNOWN_CHAINS, Beacon, BeaconError, ChainInfo, DrandClient, verify_beacon


def test_chain_hashes_match_the_published_ones(recorded):
    # Published by drand: api.drand.sh/<hash>/info. Recomputed here from the chain fields.
    assert KNOWN_CHAINS["quicknet"].hash == (
        "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
    )
    assert KNOWN_CHAINS["default"].hash == (
        "8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce"
    )
    walk = recorded["walkthrough-rfc9380-38"]
    assert ChainInfo.from_dict(walk["chain_info"]).hash == walk["chain_hash"]


def test_recorded_mainnet_default_beacon_verifies(recorded):
    b = Beacon.from_dict(recorded["default-mainnet-2634945"]["beacon"])
    assert verify_beacon(KNOWN_CHAINS["default"], b, 2634945).hex() == b.randomness


def test_recorded_rfc9380_beacon_verifies(recorded):
    walk = recorded["walkthrough-rfc9380-38"]
    b = Beacon.from_dict(walk["beacon"])
    assert verify_beacon(ChainInfo.from_dict(walk["chain_info"]), b, 38).hex() == b.randomness


def _flip(s, i=20):
    return s[:i] + ("0" if s[i] != "0" else "1") + s[i + 1 :]


@pytest.mark.parametrize(
    "change",
    [
        {"round": 2634946},
        {"randomness": "00" * 32},
        {"signature": "SIG"},
        {"previous_signature": "PREV"},
        {"previous_signature": None},
        {"signature": "ab" * 96},
    ],
)
def test_bad_default_beacons_fail(recorded, change):
    raw = dict(recorded["default-mainnet-2634945"]["beacon"])
    if change.get("signature") == "SIG":
        change = {"signature": _flip(raw["signature"])}
    if change.get("previous_signature") == "PREV":
        change = {"previous_signature": _flip(raw["previous_signature"])}
    raw.update(change)
    with pytest.raises(BeaconError):
        verify_beacon(KNOWN_CHAINS["default"], Beacon.from_dict(raw))


def test_rfc9380_beacon_for_wrong_round_or_key_fails(recorded):
    walk = recorded["walkthrough-rfc9380-38"]
    chain = ChainInfo.from_dict(walk["chain_info"])
    with pytest.raises(BeaconError):
        verify_beacon(chain, Beacon.from_dict({**walk["beacon"], "round": 55}))
    with pytest.raises(BeaconError):
        verify_beacon(chain, Beacon.from_dict(walk["beacon"]), expected_round=2)
    # Same beacon under the real quicknet key: a valid point, the wrong signer.
    with pytest.raises(BeaconError, match="does not verify"):
        verify_beacon(KNOWN_CHAINS["quicknet"], Beacon.from_dict(walk["beacon"]))


def test_round_timing():
    q = KNOWN_CHAINS["quicknet"]
    assert q.round_time(1) == q.genesis_time
    assert q.round_time(11) == q.genesis_time + 30
    assert q.first_round_at_or_after(q.genesis_time + 30) == 11
    assert q.first_round_at_or_after(q.genesis_time + 31) == 12
    assert q.first_round_at_or_after(0) == 1


class FakeRelay:
    """Serves recorded responses; records every URL asked for."""

    def __init__(self, responses):
        self.responses, self.urls = responses, []

    def __call__(self, url):
        self.urls.append(url)
        return json.dumps(self.responses[url]).encode()


def test_client_fetches_and_verifies_through_injected_fetch(recorded):
    chain = KNOWN_CHAINS["default"]
    beacon = recorded["default-mainnet-2634945"]["beacon"]
    url = f"https://relay.example/{chain.hash}/public/2634945"
    info_url = f"https://relay.example/{chain.hash}/info"
    drand_info = {
        "public_key": chain.public_key,
        "period": 30,
        "genesis_time": chain.genesis_time,
        "hash": chain.hash,
        "groupHash": chain.group_hash,
        "schemeID": "pedersen-bls-chained",
        "metadata": {"beaconID": "default"},
    }
    relay = FakeRelay({url: beacon, info_url: drand_info})
    client = DrandClient(chain, "https://relay.example/", fetch=relay)
    assert client.info() == chain
    assert client.beacon(2634945).randomness == beacon["randomness"]
    assert relay.urls == [info_url, url]


def test_client_rejects_a_forged_beacon(recorded):
    chain = KNOWN_CHAINS["default"]
    beacon = dict(recorded["default-mainnet-2634945"]["beacon"])
    beacon["signature"] = _flip(beacon["signature"], 50)
    url = f"https://relay.example/{chain.hash}/public/2634945"
    client = DrandClient(chain, "https://relay.example", fetch=FakeRelay({url: beacon}))
    with pytest.raises(BeaconError):
        client.beacon(2634945)


def test_client_rejects_a_relay_serving_another_chain(recorded):
    chain = KNOWN_CHAINS["default"]
    walk_info = recorded["walkthrough-rfc9380-38"]["chain_info"]
    relay = FakeRelay({f"https://r/{chain.hash}/info": walk_info})
    with pytest.raises(BeaconError):
        DrandClient(chain, "https://r", fetch=relay).info()


def test_chain_info_rules():
    with pytest.raises(BeaconError):
        ChainInfo.from_dict({**KNOWN_CHAINS["default"].to_dict(), "scheme": "bls-bn254"})
    with pytest.raises(BeaconError):
        ChainInfo.from_dict({**KNOWN_CHAINS["default"].to_dict(), "public_key": "ab"})
