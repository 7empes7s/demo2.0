"""The shared vectors in charter/vectors/. The TypeScript binding runs the same files."""

import json

import pytest
import yaml
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


def test_charter_yaml_reads_as_the_pinned_json():
    # vectors/charter.parsed.json pins what charter.yaml means. The TypeScript binding checks the
    # same file, so a YAML dialect difference (300_000, 014, no) fails CI in one of them.
    pinned = json.loads((VECTORS / "charter.parsed.json").read_text())
    loaded = {key: param(key) for key in pinned}
    assert json.dumps(loaded, sort_keys=True) == json.dumps(pinned, sort_keys=True)


def test_whole_float_population_is_an_int():
    area = {"id": "test-float", "parent_id": "lu", "kind": "district", "population": 1000.0}
    population = Charter(extra_jurisdictions=[area]).affected_population(
        {"jurisdiction_id": "test-float", "topic_ids": []}
    )
    assert population == 1000
    assert type(population) is int


def _charter_with(tmp_path, change):
    data = yaml.safe_load((CHARTER_ROOT / "charter.yaml").read_text())
    change(data)
    (tmp_path / "charter.yaml").write_text(yaml.safe_dump(data))
    (tmp_path / "data").mkdir()
    src = CHARTER_ROOT / "data" / "lu-jurisdictions.json"
    (tmp_path / "data" / src.name).write_text(src.read_text())
    return lambda: Charter(tmp_path)


@pytest.mark.parametrize(
    "change",
    [
        lambda d: d.pop("protected_rights"),
        lambda d: d.pop("scope"),
        lambda d: d.pop("tiers"),
        lambda d: d.pop("version"),
        lambda d: d["scope"].pop("thresholds"),
        lambda d: d["protected_rights"][0].pop("topics"),
        lambda d: d["tiers"]["local"]["review_panel"].update(min=10, max=9),
    ],
    ids=[
        "no protected_rights",
        "no scope",
        "no tiers",
        "no version",
        "no thresholds",
        "right without topics",
        "panel min above max",
    ],
)
def test_malformed_charter_is_rejected(tmp_path, change):
    build = _charter_with(tmp_path, change)
    with pytest.raises(CharterError) as err:
        build()
    assert err.value.code == "invalid_charter"


def test_jurisdiction_path_root_first():
    c = Charter()
    assert c.jurisdiction_path("lu") == ["lu"]
    assert c.jurisdiction_path("lu-commune-esch-sur-alzette") == [
        "lu",
        "lu-canton-esch-sur-alzette",
        "lu-commune-esch-sur-alzette",
    ]
    with pytest.raises(CharterError) as e:
        c.jurisdiction_path("lu-commune-nowhere")
    assert e.value.code == "unknown_jurisdiction"


def test_jurisdiction_path_refuses_a_cycle_and_a_missing_parent():
    c = Charter(
        extra_jurisdictions=[
            {"id": "a", "parent_id": "b", "kind": "district", "population": 1},
            {"id": "b", "parent_id": "a", "kind": "district", "population": 1},
            {"id": "orphan", "parent_id": "gone", "kind": "district", "population": 1},
        ]
    )
    with pytest.raises(CharterError) as e:
        c.jurisdiction_path("a")
    assert e.value.code == "invalid_charter"
    with pytest.raises(CharterError) as e:
        c.jurisdiction_path("orphan")
    assert e.value.code == "unknown_jurisdiction"


@pytest.mark.parametrize("bad", [None, 5, b"lu", ["lu"]])
def test_jurisdiction_path_refuses_a_non_string(bad):
    # An empty path would cover every jurisdiction (levels[:0] == []), so never return one.
    with pytest.raises(TypeError):
        Charter().jurisdiction_path(bad)
