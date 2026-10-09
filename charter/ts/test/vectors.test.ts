// The shared vectors in charter/vectors/. The Python binding runs the same files.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import {
  basis,
  CHARTER_ROOT,
  Charter,
  CharterError,
  is_protected,
  isProtected,
  param,
  source,
} from "../src/index.ts";

interface Case {
  name?: string;
  key?: string;
  version?: string;
  matter?: unknown;
  expect?: unknown;
  expect_error?: string;
}
interface VectorFile {
  charter_version: string;
  extra_jurisdictions?: ConstructorParameters<typeof Charter>[1];
  cases: Case[];
}

const vectors = (name: string): VectorFile =>
  JSON.parse(readFileSync(join(CHARTER_ROOT, "vectors", `${name}.json`), "utf8")) as VectorFile;
const TIER = vectors("tier");
const PROTECTED = vectors("protected");
const PARAM = vectors("param");
const PROVENANCE = vectors("provenance");
const charter = new Charter(CHARTER_ROOT, TIER.extra_jurisdictions);

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof CharterError) return e.code;
    throw e;
  }
  throw new Error("expected a CharterError");
}

it("vectors match this Charter version", () => {
  for (const v of [TIER, PROTECTED, PARAM, PROVENANCE]) expect(v.charter_version).toBe(charter.version);
});

describe("tier", () => {
  it.each(TIER.cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    if (c.expect_error) {
      expect(errorCode(() => charter.tier(c.matter))).toBe(c.expect_error);
      return;
    }
    const want = c.expect as { tier: string; affected_population: number };
    expect(charter.tier(c.matter)).toBe(want.tier);
    expect(charter.affectedPopulation(c.matter)).toBe(want.affected_population);
  });
});

describe("isProtected", () => {
  it.each(PROTECTED.cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    if (c.expect_error) {
      expect(errorCode(() => isProtected(c.matter))).toBe(c.expect_error);
      return;
    }
    expect(isProtected(c.matter)).toBe(c.expect);
    expect(is_protected(c.matter)).toBe(c.expect);
  });
});

describe("param", () => {
  it.each(PARAM.cases.map((c) => [`${c.key}@${c.version}`, c] as const))("%s", (_, c) => {
    if (c.expect_error) {
      expect(errorCode(() => param(c.key as string, c.version))).toBe(c.expect_error);
      return;
    }
    expect(param(c.key as string, c.version)).toEqual(c.expect);
  });

  it("returns a copy", () => {
    (param("tiers.national.review_panel") as { min: number }).min = 1;
    expect(param("tiers.national.review_panel.min")).toBe(50);
  });
});

describe("source and basis", () => {
  it.each(PROVENANCE.cases.map((c) => [c.key, c] as const))("%s", (_, c) => {
    const key = c.key as string;
    if (c.expect_error) {
      expect(errorCode(() => source(key))).toBe(c.expect_error);
      expect(errorCode(() => basis(key))).toBe(c.expect_error);
      return;
    }
    const want = c.expect as { basis: string; source: unknown };
    expect(source(key)).toEqual(want.source);
    expect(basis(key)).toBe(want.basis);
  });

  it("returns a copy", () => {
    source("charter_change.majority").status = "to_verify";
    expect(source("charter_change.majority").status).toBe("verified");
  });
});

it("extra jurisdictions cannot replace reference data", () => {
  const fake = { id: "lu-commune-esch-sur-alzette", kind: "commune", population: 10_000_000 };
  expect(errorCode(() => new Charter(CHARTER_ROOT, [fake]))).toBe("duplicate_jurisdiction");
});

it("rejects thresholds out of order", () => {
  const dir = mkdtempSync(join(tmpdir(), "charter-"));
  cpSync(join(CHARTER_ROOT, "data"), join(dir, "data"), { recursive: true });
  const text = readFileSync(join(CHARTER_ROOT, "charter.yaml"), "utf8");
  writeFileSync(
    join(dir, "charter.yaml"),
    text.replace("min_population: 50000", "min_population: 400000"),
  );
  expect(errorCode(() => new Charter(dir))).toBe("invalid_charter");
});

it("reads charter.yaml as the pinned JSON", () => {
  // vectors/charter.parsed.json pins what charter.yaml means. The Python binding checks the same
  // file, so a YAML dialect difference (300_000, 014, no) fails CI in one of them.
  const pinned = JSON.parse(
    readFileSync(join(CHARTER_ROOT, "vectors", "charter.parsed.json"), "utf8"),
  ) as Record<string, unknown>;
  const loaded = Object.fromEntries(Object.keys(pinned).map((k) => [k, param(k)]));
  expect(loaded).toEqual(pinned);
});

it("counts a population written as 1000.0 as 1000", () => {
  const area = { id: "test-float", parent_id: "lu", kind: "district", population: 1000.0 };
  const c = new Charter(CHARTER_ROOT, [area]);
  expect(c.affectedPopulation({ jurisdiction_id: "test-float", topic_ids: [] })).toBe(1000);
});

describe("rejects a malformed charter", () => {
  type D = Record<string, any>;
  const changes: [string, (d: D) => void][] = [
    ["no protected_rights", (d) => delete d.protected_rights],
    ["no scope", (d) => delete d.scope],
    ["no tiers", (d) => delete d.tiers],
    ["no version", (d) => delete d.version],
    ["no thresholds", (d) => delete d.scope.thresholds],
    ["right without topics", (d) => delete d.protected_rights[0].topics],
    ["panel min above max", (d) => Object.assign(d.tiers.local.review_panel, { min: 10, max: 9 })],
  ];
  it.each(changes)("%s", (_, change) => {
    const dir = mkdtempSync(join(tmpdir(), "charter-"));
    cpSync(join(CHARTER_ROOT, "data"), join(dir, "data"), { recursive: true });
    const data = parse(readFileSync(join(CHARTER_ROOT, "charter.yaml"), "utf8"), {
      version: "1.1",
    }) as D;
    change(data);
    writeFileSync(join(dir, "charter.yaml"), stringify(data, { version: "1.1" }));
    expect(errorCode(() => new Charter(dir))).toBe("invalid_charter");
  });
});
