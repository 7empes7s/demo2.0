"""Every schema in spec/schemas is valid, and its examples pass or fail as named.

Examples live in spec/examples/<name>/ for spec/schemas/<name>.schema.json.
Files named invalid-*.json must fail; every other file must pass.
"""

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

SPEC = Path(__file__).resolve().parent.parent
SCHEMA_FILES = sorted((SPEC / "schemas").glob("*.schema.json"))
SCHEMAS = {p.name.removesuffix(".schema.json"): json.loads(p.read_text()) for p in SCHEMA_FILES}
REGISTRY = Registry().with_resources(
    (schema["$id"], Resource.from_contents(schema)) for schema in SCHEMAS.values()
)
EXAMPLES = sorted((SPEC / "examples").glob("*/*.json"))


def _validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(SCHEMAS[name], registry=REGISTRY, format_checker=FormatChecker())


def test_schemas_found():
    assert SCHEMAS


@pytest.mark.parametrize("name", sorted(SCHEMAS))
def test_schema_is_valid_2020_12(name):
    schema = SCHEMAS[name]
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert schema["$id"] == f"https://democracy2.dev/spec/{name}.schema.json"
    Draft202012Validator.check_schema(schema)


@pytest.mark.parametrize("name", sorted(SCHEMAS))
def test_schema_has_valid_and_invalid_examples(name):
    files = [p.name for p in (SPEC / "examples" / name).glob("*.json")]
    assert any(not f.startswith("invalid-") for f in files), f"{name}: no valid example"
    assert any(f.startswith("invalid-") for f in files), f"{name}: no invalid example"


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_example(path):
    name = path.parent.name
    assert name in SCHEMAS, f"examples/{name} has no matching schema"
    errors = list(_validator(name).iter_errors(json.loads(path.read_text())))
    if path.name.startswith("invalid-"):
        assert errors, f"{path.name} should fail but passed"
    else:
        assert not errors, [e.message for e in errors]


def test_record_types():
    data = json.loads((SPEC / "record-types.json").read_text())
    types = [entry["type"] for entry in data["types"]]
    assert types and len(types) == len(set(types))
