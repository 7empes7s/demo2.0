"""The shared vectors in charter/vectors/. The TypeScript binding runs the same files."""

import json

import pytest
from d2_charter import CHARTER_ROOT, Charter, CharterError, is_protected, param

VECTORS = CHARTER_ROOT / "vectors"
TIER = json.loads((VECTORS / "tier.json").read_text())
PROTECTED = json.loads((VECTORS / "protected.json").read_text())
PARAM = json.loads((VECTORS / "param.json").read_text())
CHARTER = Charter(extra_jurisdictions=TIER["extra_jurisdictions"])


def test_vectors_match_this_charter_version():
    for doc in (TIER, PROTECTED, PARAM):
        assert doc["charter_version"] == CHARTER.version


@pytest.mark.parametrize("case", TIER["cases"], ids=lambda c: c["name"])
def test_tier(case):
    if "expect_error" in case:
        with pytest.raises(CharterError) as err:
            CHARTER.tier(case["matter"])
        assert err.value.code == case["expect_error"]
        return
    assert CHARTER.tier(case["matter"]) == case["expect"]["tier"]
    assert CHARTER.affected_population(case["matter"]) == case["expect"]["affected_population"]


@pytest.mark.parametrize("case", PROTECTED["cases"], ids=lambda c: c["name"])
def test_is_protected(case):
    if "expect_error" in case:
        with pytest.raises(CharterError) as err:
            is_protected(case["matter"])
        assert err.value.code == case["expect_error"]
        return
    assert is_protected(case["matter"]) is case["expect"]


@pytest.mark.parametrize("case", PARAM["cases"], ids=lambda c: f"{c['key']}@{c.get('version')}")
def test_param(case):
    if "expect_error" in case:
        with pytest.raises(CharterError) as err:
            param(case["key"], case.get("version"))
        assert err.value.code == case["expect_error"]
        return
    assert param(case["key"], case.get("version")) == case["expect"]


def test_param_returns_a_copy():
    param("tiers.national.review_panel")["min"] = 1
    assert param("tiers.national.review_panel.min") == 50


def test_extra_jurisdictions_cannot_replace_reference_data():
    fake = {"id": "lu-commune-esch-sur-alzette", "kind": "commune", "population": 10_000_000}
    with pytest.raises(CharterError) as err:
        Charter(extra_jurisdictions=[fake])
    assert err.value.code == "duplicate_jurisdiction"


def test_thresholds_out_of_order_are_rejected(tmp_path):
    text = (CHARTER_ROOT / "charter.yaml").read_text()
    (tmp_path / "charter.yaml").write_text(
        text.replace("min_population: 50000", "min_population: 400000")
    )
    (tmp_path / "data").mkdir()
    src = CHARTER_ROOT / "data" / "lu-jurisdictions.json"
    (tmp_path / "data" / src.name).write_text(src.read_text())
    with pytest.raises(CharterError) as err:
        Charter(tmp_path)
    assert err.value.code == "invalid_charter"
