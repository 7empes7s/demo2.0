"""charter.yaml matches its schema and the Luxembourg reference data is consistent."""

import json
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

CHARTER = Path(__file__).resolve().parent.parent
SPEC = CHARTER.parent / "spec" / "schemas"
SCHEMA = json.loads((CHARTER / "charter.schema.json").read_text())
DATA = yaml.safe_load((CHARTER / "charter.yaml").read_text())
LU = json.loads((CHARTER / "data" / "lu-jurisdictions.json").read_text())
BY_ID = {j["id"]: j for j in LU["jurisdictions"]}


def test_schema_is_valid_2020_12():
    assert SCHEMA["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    Draft202012Validator.check_schema(SCHEMA)


def test_charter_matches_schema():
    errors = [e.message for e in Draft202012Validator(SCHEMA).iter_errors(DATA)]
    assert errors == []


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.pop("protected_rights"),
        lambda d: d["tiers"]["national"].update(review_panel={"min": 0, "max": 5}),
        lambda d: d["scope"]["thresholds"].reverse(),
        lambda d: d["scope"]["thresholds"][3].update(min_population=1),
        lambda d: d["delegation"].update(cap_share_of_electorate=1.5),
        lambda d: d.update(surprise=1),
    ],
    ids=[
        "no-protected-rights",
        "empty-panel",
        "thresholds-reversed",
        "minor-not-zero",
        "cap-over-one",
        "unknown-section",
    ],
)
def test_schema_rejects_broken_charters(mutate):
    data = yaml.safe_load((CHARTER / "charter.yaml").read_text())
    mutate(data)
    assert list(Draft202012Validator(SCHEMA).iter_errors(data))


def test_rules_the_schema_cannot_express():
    minimums = [t["min_population"] for t in DATA["scope"]["thresholds"]]
    assert minimums == sorted(minimums, reverse=True) and len(set(minimums)) == len(minimums)
    priorities = [
        DATA["tiers"][t]["queue_priority"] for t in ("national", "regional", "local", "minor")
    ]
    assert priorities == sorted(priorities) and len(set(priorities)) == 4
    for name, t in DATA["tiers"].items():
        assert t["review_panel"]["min"] <= t["review_panel"]["max"], name
    ids = [r["id"] for r in DATA["protected_rights"]]
    assert len(ids) == len(set(ids))


def test_every_placeholder_is_marked_for_a_decision():
    lines = (CHARTER / "charter.yaml").read_text().splitlines()
    values = [line for line in lines if "placeholder" in line and not line.lstrip().startswith("#")]
    assert values, "expected marked placeholders"
    for line in values:
        assert line.endswith(" # placeholder: decision needed"), line


def test_jurisdictions_match_spec_schema():
    registry = Registry().with_resources(
        (s["$id"], Resource.from_contents(s))
        for s in (json.loads(p.read_text()) for p in SPEC.glob("*.schema.json"))
    )
    schema = json.loads((SPEC / "jurisdiction.schema.json").read_text())
    validator = Draft202012Validator(schema, registry=registry)
    for j in LU["jurisdictions"]:
        assert [e.message for e in validator.iter_errors(j)] == [], j["id"]


def test_reference_data_is_consistent():
    assert LU["source"].startswith("STATEC")
    assert LU["reference_date"] == "2024-01-01"
    assert "refreshed from STATEC" in LU["note"]
    assert len(BY_ID) == len(LU["jurisdictions"])
    assert DATA["scope"]["population_source"] == "data/lu-jurisdictions.json"
    for j in LU["jurisdictions"]:
        assert isinstance(j["population"], int), j["id"]
        if j["parent_id"] is not None:
            parent = BY_ID[j["parent_id"]]
            assert j["population"] <= parent["population"], j["id"]
    cantons = [j for j in LU["jurisdictions"] if j["kind"] == "region"]
    assert len(cantons) == 12
    total = BY_ID["lu"]["population"]
    # The canton figures are rounded estimates (verified_against_source: false) and sum to about
    # 0.65% above the national figure. 1% tolerates that rounding but not a wrong canton. Make it
    # exact once the STATEC table is entered.
    assert abs(sum(c["population"] for c in cantons) - total) / total < 0.01
    assert {"lu-commune-luxembourg", "lu-commune-esch-sur-alzette"} <= BY_ID.keys()
