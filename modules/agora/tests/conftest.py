"""Shared fixtures: a real Lottery for ScopeChallenge panels, with no network.

Agora runs the Lottery module's CLI (`python -m d2_lottery`, installed by `uv sync
--all-packages`), never imports it. The beacon is a real recorded League of Entropy mainnet
`default` beacon (spec/lottery/vectors/beacons.json, round 2634945), which the CLI verifies in
full. Tests open challenges exactly one hour before that round, so the Lottery commits to it.
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest
from d2_agora import LotteryCli

SPEC = Path(__file__).resolve().parents[3] / "spec"
RECORDED = json.loads((SPEC / "lottery" / "vectors" / "beacons.json").read_text())["beacons"]
BEACON = next(b["beacon"] for b in RECORDED if b["name"] == "default-mainnet-2634945")
# drand mainnet `default`: genesis 1595431050, period 30 s. Round 2634945 is out at
# 1674479370; the Lottery commits to the first round at least 3600 s after the commit time.
ROUND_TIME = 1595431050 + (BEACON["round"] - 1) * 30
OPEN_AT = datetime.fromtimestamp(ROUND_TIME - 3600, UTC)
LOTTERY_CMD = [sys.executable, "-m", "d2_lottery"]


def recorded_beacon(round_: int):
    return dict(BEACON) if round_ == BEACON["round"] else None


@pytest.fixture
def lottery_cmd():
    return list(LOTTERY_CMD)


@pytest.fixture
def beacons():
    """The beacon source: the recorded round, None for any other (not out yet)."""
    return recorded_beacon


@pytest.fixture
def lottery():
    return LotteryCli(LOTTERY_CMD, chain="default", beacon=recorded_beacon)


@pytest.fixture
def open_at():
    """When tests open a challenge: one hour before the recorded round."""
    return OPEN_AT
