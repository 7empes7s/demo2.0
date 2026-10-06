"""Charter and Scope: the rules of the game as data, and the tier of a matter.

    from d2_charter import tier, param, is_protected

    tier({"jurisdiction_id": "lu-commune-esch-sur-alzette", "topic_ids": ["parks"]})  # "local"
    param("tiers.local.review_panel")  # {"min": 5, "max": 9}
    is_protected({"jurisdiction_id": "lu", "topic_ids": ["rights.expression"]})  # True

A matter is any mapping with `jurisdiction_id` (str) and `topic_ids` (list of str). Every other
field, including a proposer's own tier label, is ignored.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Iterable, Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

__all__ = [
    "CHARTER_ROOT",
    "TIERS",
    "Charter",
    "CharterError",
    "affected_population",
    "is_protected",
    "load",
    "param",
    "tier",
]

# charter/python/src/d2_charter/__init__.py -> charter/
CHARTER_ROOT = Path(__file__).resolve().parents[3]
TIERS = ("national", "regional", "local", "minor")


class CharterError(ValueError):
    """A rule was asked for something it can't answer. `code` matches the shared test vectors."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


class Charter:
    """One Charter version plus the jurisdictions Scope reads population from.

    `extra_jurisdictions` adds places the reference data lacks (for example districts inside a
    commune). They come from the caller, never from the matter, and can't replace a known id.
    """

    def __init__(
        self,
        root: Path | str = CHARTER_ROOT,
        extra_jurisdictions: Iterable[Mapping[str, Any]] = (),
    ) -> None:
        root = Path(root)
        self._data: dict[str, Any] = yaml.safe_load((root / "charter.yaml").read_text("utf-8"))
        _check_shape(self._data)
        self.version: str = self._data["version"]
        self._thresholds = _thresholds(self._data["scope"]["thresholds"])
        self._protected = [t for right in self._data["protected_rights"] for t in right["topics"]]
        source = json.loads((root / self._data["scope"]["population_source"]).read_text("utf-8"))
        self._jurisdictions: dict[str, Mapping[str, Any]] = {}
        for j in [*source["jurisdictions"], *extra_jurisdictions]:
            if j["id"] in self._jurisdictions:
                raise CharterError(
                    "duplicate_jurisdiction", f"jurisdiction {j['id']!r} given twice"
                )
            self._jurisdictions[j["id"]] = j

    def param(self, key: str, version: str | None = None) -> Any:
        """The value at a dotted key, such as `delegation.cap_share_of_electorate`."""
        if version is not None and version != self.version:
            raise CharterError("unknown_version", f"have Charter {self.version}, asked {version}")
        node: Any = self._data
        for part in key.split("."):
            if not isinstance(node, dict) or part not in node:
                raise CharterError("unknown_key", f"no Charter parameter {key!r}")
            node = node[part]
        return copy.deepcopy(node)

    def affected_population(self, matter: Any) -> int:
        jurisdiction_id, _ = _read_matter(matter)
        j = self._jurisdictions.get(jurisdiction_id)
        if j is None:
            raise CharterError("unknown_jurisdiction", f"no jurisdiction {jurisdiction_id!r}")
        population = j.get("population")
        # A whole number, however it is written: 1000 and 1000.0 are the same population. JSON
        # parsers in other bindings can't tell them apart, so neither may this one.
        if (
            not isinstance(population, int | float)
            or isinstance(population, bool)
            or not float(population).is_integer()
            or population < 0
        ):
            raise CharterError(
                "no_population", f"jurisdiction {jurisdiction_id!r} has no population"
            )
        return int(population)

    def jurisdiction_path(self, jurisdiction_id: str) -> list[str]:
        """The jurisdiction and its ancestors, root first, by `parent_id`:
        `["lu", "lu-canton-esch-sur-alzette", "lu-commune-esch-sur-alzette"]`. Door writes a
        resident's jurisdiction as these ids joined by `.`, so a verifier compares paths level
        by level. A non-string id is a TypeError, never an empty path."""
        if not isinstance(jurisdiction_id, str):
            raise TypeError("jurisdiction_id must be a string")
        path: list[str] = []
        current: Any = jurisdiction_id
        while current is not None:
            j = self._jurisdictions.get(current) if isinstance(current, str) else None
            if j is None:
                raise CharterError("unknown_jurisdiction", f"no jurisdiction {current!r}")
            if current in path:
                raise CharterError("invalid_charter", f"jurisdiction {current!r} is its own parent")
            path.append(current)
            current = j.get("parent_id")
        return path[::-1]

    def tier(self, matter: Any) -> str:
        """The matter's tier from its affected population. Labels on the matter are ignored."""
        population = self.affected_population(matter)
        for name, minimum in self._thresholds:
            if population >= minimum:
                return name
        raise AssertionError("unreachable: the last threshold is 0")

    def is_protected(self, matter: Any) -> bool:
        """True when any topic is a protected-rights topic or under one: no vote may decide it."""
        _, topic_ids = _read_matter(matter)
        return any(
            topic == p or topic.startswith(p + ".") for topic in topic_ids for p in self._protected
        )


def _check_shape(data: Any) -> None:
    """The structure the library reads. charter.schema.json checks the rest in CI."""

    def bad(why: str) -> CharterError:
        return CharterError("invalid_charter", why)

    if not isinstance(data, dict):
        raise bad("charter.yaml must be a mapping")
    if not isinstance(data.get("version"), str):
        raise bad("version must be a string")
    scope = data.get("scope")
    if not isinstance(scope, dict) or not isinstance(scope.get("population_source"), str):
        raise bad("scope.population_source must be a string")
    thresholds = scope.get("thresholds")
    if not isinstance(thresholds, list) or not all(
        isinstance(t, dict)
        and isinstance(t.get("tier"), str)
        and isinstance(t.get("min_population"), int)
        and not isinstance(t.get("min_population"), bool)
        for t in thresholds
    ):
        raise bad("scope.thresholds must list {tier, min_population} with integer minimums")
    rights = data.get("protected_rights")
    if not isinstance(rights, list) or not all(
        isinstance(r, dict)
        and isinstance(r.get("topics"), list)
        and all(isinstance(t, str) for t in r["topics"])
        for r in rights
    ):
        raise bad("protected_rights must list entries with a topics list of strings")
    tiers = data.get("tiers")
    if not isinstance(tiers, dict):
        raise bad("tiers must be a mapping")
    for name, spec in tiers.items():
        panel = spec.get("review_panel") if isinstance(spec, dict) else None
        if panel is None:
            continue
        lo, hi = (panel.get("min"), panel.get("max")) if isinstance(panel, dict) else (None, None)
        if not all(isinstance(n, int) and not isinstance(n, bool) for n in (lo, hi)) or lo > hi:
            raise bad(f"tiers.{name}.review_panel needs integer min <= max")


def _thresholds(raw: list[Mapping[str, Any]]) -> list[tuple[str, int]]:
    pairs = [(t["tier"], t["min_population"]) for t in raw]
    if [name for name, _ in pairs] != list(TIERS):
        raise CharterError("invalid_charter", f"thresholds must list {TIERS} in order")
    minimums = [m for _, m in pairs]
    if minimums[-1] != 0 or any(a <= b for a, b in zip(minimums, minimums[1:], strict=False)):
        raise CharterError("invalid_charter", "thresholds must fall strictly and end at 0")
    return pairs


def _read_matter(matter: Any) -> tuple[str, list[str]]:
    if not isinstance(matter, Mapping):
        raise CharterError("invalid_matter", "a matter is an object")
    jurisdiction_id = matter.get("jurisdiction_id")
    topic_ids = matter.get("topic_ids")
    if not isinstance(jurisdiction_id, str) or not jurisdiction_id:
        raise CharterError("invalid_matter", "jurisdiction_id must be a non-empty string")
    if not isinstance(topic_ids, list) or not all(isinstance(t, str) for t in topic_ids):
        raise CharterError("invalid_matter", "topic_ids must be a list of strings")
    return jurisdiction_id, topic_ids


@lru_cache(maxsize=1)
def load() -> Charter:
    """The repo's current Charter with the Luxembourg reference data."""
    return Charter()


def tier(matter: Any) -> str:
    return load().tier(matter)


def affected_population(matter: Any) -> int:
    return load().affected_population(matter)


def param(key: str, version: str | None = None) -> Any:
    return load().param(key, version)


def is_protected(matter: Any) -> bool:
    return load().is_protected(matter)
