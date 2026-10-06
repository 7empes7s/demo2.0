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
        lambda d: d["protected_rights"][0].pop("source"),
        lambda d: d["protected_rights"][0].update(basis="whim"),
        lambda d: d["provenance"]["door.epoch_months"]["source"].update(status="maybe"),
        lambda d: d["provenance"]["charter_change.majority"]["source"].update(status="verified"),
        lambda d: d["provenance"].update({"door": {"basis": "project", "source": {}}}),
    ],
    ids=[
        "no-protected-rights",
        "empty-panel",
        "thresholds-reversed",
        "minor-not-zero",
        "cap-over-one",
        "unknown-section",
        "right-without-source",
        "unknown-basis",
        "unknown-source-status",
        "verified-without-article",
        "provenance-key-not-dotted",
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


# Rules read as one value: `param` returns them whole and provenance names them whole.
COMPOUND_RULES = {"scope.thresholds", "charter_change.majority"} | {
    f"tiers.{t}.review_panel" for t in ("national", "regional", "local", "minor")
}
# Not rules: metadata, the pointer to the reference data, and the provenance sections themselves.
NOT_RULES = {"version", "scope.population_source", "protected_rights", "sources", "provenance"}


def rule_keys(node, prefix=""):
    """Every dotted key of a rule in charter.yaml, in file order."""
    keys = []
    for name, value in node.items():
        key = f"{prefix}{name}"
        if key in NOT_RULES:
            continue
        if isinstance(value, dict) and key not in COMPOUND_RULES:
            keys.extend(rule_keys(value, key + "."))
        else:
            keys.append(key)
    return keys


def test_every_rule_has_provenance_and_nothing_else_does():
    rules = rule_keys(DATA)
    assert len(rules) >= 40
    assert set(DATA["provenance"]) == set(rules)


def test_every_placeholder_has_provenance():
    # A placeholder line is `  <name>: <value> # placeholder: decision needed` inside a section.
    # Map each to its dotted key by indentation and check a provenance entry names it.
    lines = (CHARTER / "charter.yaml").read_text().splitlines()
    stack: list[tuple[int, str]] = []
    placeholders = []
    for line in lines:
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#") or stripped.startswith("- "):
            continue
        indent = len(line) - len(stripped)
        name = stripped.split(":", 1)[0]
        while stack and stack[-1][0] >= indent:
            stack.pop()
        stack.append((indent, name))
        if "# placeholder: decision needed" in line:
            placeholders.append(".".join(n for _, n in stack))
    assert placeholders
    assert "vote_budget.matters_per_week" in placeholders
    for key in placeholders:
        key = next((c for c in COMPOUND_RULES if key.startswith(c + ".")), key)
        assert key in DATA["provenance"], key
    # The list-shaped thresholds carry placeholders too; their provenance is the whole list.
    threshold_lines = [
        line for line in lines if "min_population:" in line and "placeholder" in line
    ]
    assert len(threshold_lines) == 3 and "scope.thresholds" in DATA["provenance"]


def every_source():
    for key, entry in DATA["provenance"].items():
        yield key, entry["basis"], entry["source"]
    for right in DATA["protected_rights"]:
        yield f"protected_rights.{right['id']}", right["basis"], right["source"]


def test_sources_are_well_formed():
    statuses = {"verified", "to_verify", "none"}
    for key, basis, src in every_source():
        citations = [src, *src.get("cross_references", [])]
        for c in citations:
            assert c["instrument"] in DATA["sources"], (key, c["instrument"])
            assert c["status"] in statuses, key
            if c["status"] == "verified":
                assert c.get("article"), f"{key}: verified without an article"
            if c["status"] == "to_verify":
                assert c.get("article") or c.get("chapter") or c.get("right"), key
        # A legal basis cites a legal instrument; a project rule cites the project's own docs.
        if basis in ("constitution", "law"):
            assert src["instrument"] != "d2_architecture", key
            assert src["status"] != "none", key
        else:
            assert src["instrument"] == "d2_architecture", key
            assert src["status"] == "none", key
    used = {
        c["instrument"] for _, _, s in every_source() for c in [s, *s.get("cross_references", [])]
    }
    assert used == set(DATA["sources"])


def test_constitution_is_the_source_for_protected_rights():
    for right in DATA["protected_rights"]:
        if right["id"] == "anonymity_of_participation":
            assert right["basis"] == "project"
            continue
        assert right["basis"] == "constitution", right["id"]
        assert right["source"]["instrument"] == "lu_constitution_2023", right["id"]
    assert DATA["sources"]["lu_constitution_2023"]["consulted"] is False, (
        "flip to_verify entries to verified in the same change that marks the text consulted"
    )


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
    assert LU["population_source"] == {"name": "STATEC", "status": "to_verify"}
    assert LU["verified_against_source"] is False
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
