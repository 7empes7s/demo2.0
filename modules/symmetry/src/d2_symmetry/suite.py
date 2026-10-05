"""Suite format and pair generation.

A suite is a versioned JSON document:

    {
      "format": "d2-symmetry-suite/1",
      "suite_version": "v0",
      "personas": [{"id": "none", "prefix": ""}, {"id": "retired", "prefix": "I'm retired. "}],
      "scenarios": [
        {
          "id": "car-free-centre",
          "topic": "transport",
          "matter": "A commune proposes ...",
          "positions": {
            "yes": ["I support it ...", "Count me in ..."],
            "no":  ["I oppose it ...", "Count me out ..."]
          }
        }
      ]
    }

Each scenario's "yes" and "no" wordings are mirrored by index: wording i on the yes side says the
same thing as wording i on the no side, with the stance flipped. Personas (demographic framing)
are applied identically to both sides. One `Pair` is generated for each scenario, wording index
and persona, so the only thing that differs inside a pair is the direction the user leans.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

SUITE_FORMAT = "d2-symmetry-suite/1"
POSITIONS = ("yes", "no")


class SuiteError(ValueError):
    """The suite document is malformed."""


@dataclass(frozen=True)
class Persona:
    id: str
    prefix: str


@dataclass(frozen=True)
class Scenario:
    id: str
    topic: str
    matter: str
    yes: tuple[str, ...]
    no: tuple[str, ...]


@dataclass(frozen=True)
class Suite:
    suite_version: str
    personas: tuple[Persona, ...]
    scenarios: tuple[Scenario, ...]


@dataclass(frozen=True)
class Pair:
    """Two prompts that differ only in the user's position on the matter."""

    id: str
    scenario_id: str
    topic: str
    matter: str
    persona_id: str
    wording: int
    yes_message: str
    no_message: str

    def message(self, position: str) -> str:
        if position == "yes":
            return self.yes_message
        if position == "no":
            return self.no_message
        raise ValueError(f"unknown position {position!r}")


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise SuiteError(msg)


def _text(value: object, where: str) -> str:
    _require(isinstance(value, str) and value.strip() != "", f"{where}: expected non-empty text")
    return value  # type: ignore[return-value]


def parse_suite(doc: object) -> Suite:
    _require(isinstance(doc, dict), "suite: expected a JSON object")
    assert isinstance(doc, dict)
    _require(
        doc.get("format") == SUITE_FORMAT,
        f"suite: format must be {SUITE_FORMAT!r}, got {doc.get('format')!r}",
    )
    version = _text(doc.get("suite_version"), "suite_version")

    raw_personas = doc.get("personas", [{"id": "none", "prefix": ""}])
    _require(isinstance(raw_personas, list) and raw_personas, "personas: expected a non-empty list")
    personas = []
    for i, p in enumerate(raw_personas):
        _require(isinstance(p, dict), f"personas[{i}]: expected an object")
        prefix = p.get("prefix", "")
        _require(isinstance(prefix, str), f"personas[{i}].prefix: expected text")
        personas.append(Persona(id=_text(p.get("id"), f"personas[{i}].id"), prefix=prefix))
    _require(len({p.id for p in personas}) == len(personas), "personas: duplicate id")

    raw_scenarios = doc.get("scenarios")
    _require(
        isinstance(raw_scenarios, list) and raw_scenarios, "scenarios: expected a non-empty list"
    )
    assert isinstance(raw_scenarios, list)
    scenarios = []
    for i, s in enumerate(raw_scenarios):
        where = f"scenarios[{i}]"
        _require(isinstance(s, dict), f"{where}: expected an object")
        positions = s.get("positions")
        _require(
            isinstance(positions, dict) and set(positions) == set(POSITIONS),
            f"{where}.positions: expected exactly 'yes' and 'no'",
        )
        sides = {}
        for side in POSITIONS:
            wordings = positions[side]
            _require(
                isinstance(wordings, list) and wordings,
                f"{where}.positions.{side}: expected a non-empty list of wordings",
            )
            sides[side] = tuple(
                _text(w, f"{where}.positions.{side}[{j}]") for j, w in enumerate(wordings)
            )
        _require(
            len(sides["yes"]) == len(sides["no"]),
            f"{where}.positions: 'yes' and 'no' must have the same number of mirrored wordings",
        )
        scenarios.append(
            Scenario(
                id=_text(s.get("id"), f"{where}.id"),
                topic=_text(s.get("topic"), f"{where}.topic"),
                matter=_text(s.get("matter"), f"{where}.matter"),
                yes=sides["yes"],
                no=sides["no"],
            )
        )
    _require(len({s.id for s in scenarios}) == len(scenarios), "scenarios: duplicate id")
    return Suite(suite_version=version, personas=tuple(personas), scenarios=tuple(scenarios))


def load_suite(path: str | Path) -> Suite:
    with open(path, encoding="utf-8") as fh:
        return parse_suite(json.load(fh))


def generate_pairs(suite: Suite) -> list[Pair]:
    pairs = []
    for scenario in suite.scenarios:
        for w, (yes_text, no_text) in enumerate(zip(scenario.yes, scenario.no, strict=True)):
            for persona in suite.personas:
                pairs.append(
                    Pair(
                        id=f"{scenario.id}/w{w}/{persona.id}",
                        scenario_id=scenario.id,
                        topic=scenario.topic,
                        matter=scenario.matter,
                        persona_id=persona.id,
                        wording=w,
                        yes_message=persona.prefix + yes_text,
                        no_message=persona.prefix + no_text,
                    )
                )
    return pairs
