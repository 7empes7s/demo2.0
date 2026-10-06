import json
from pathlib import Path

import pytest

SPEC = Path(__file__).resolve().parents[3] / "spec" / "lottery" / "vectors"


@pytest.fixture(scope="session")
def vectors():
    return json.loads((SPEC / "draws.json").read_text("utf-8"))


@pytest.fixture(scope="session")
def recorded():
    return {b["name"]: b for b in json.loads((SPEC / "beacons.json").read_text("utf-8"))["beacons"]}
