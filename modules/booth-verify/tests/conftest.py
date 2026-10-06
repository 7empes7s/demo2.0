import json
from pathlib import Path

import pytest

SPEC = Path(__file__).resolve().parents[3] / "spec" / "booth"


@pytest.fixture(scope="session")
def vectors():
    return json.loads((SPEC / "vectors.json").read_text("utf-8"))
