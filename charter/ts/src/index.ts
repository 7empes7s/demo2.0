// Charter and Scope: the rules of the game as data, and the tier of a matter.
//
//   tier({ jurisdiction_id: "lu-commune-esch-sur-alzette", topic_ids: ["parks"] }) // "local"
//   param("tiers.local.review_panel") // { min: 5, max: 9 }
//   isProtected({ jurisdiction_id: "lu", topic_ids: ["rights.expression"] }) // true
//
// A matter is any object with `jurisdiction_id` (string) and `topic_ids` (string[]). Every other
// field, including a proposer's own tier label, is ignored. Mirrors the Python d2_charter.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

/** charter/ts/src/index.ts -> charter/ */
export const CHARTER_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const TIERS = ["national", "regional", "local", "minor"] as const;
export type Tier = (typeof TIERS)[number];

export interface Jurisdiction {
  id: string;
  parent_id?: string | null;
  kind: string;
  name?: Record<string, string>;
  population?: number;
}

export interface Matter {
  jurisdiction_id: string;
  topic_ids: string[];
  [other: string]: unknown;
}

export type CharterErrorCode =
  | "invalid_charter"
  | "invalid_matter"
  | "unknown_jurisdiction"
  | "no_population"
  | "duplicate_jurisdiction"
  | "unknown_key"
  | "unknown_version";

/** A rule was asked for something it can't answer. `code` matches the shared test vectors. */
export class CharterError extends Error {
  readonly code: CharterErrorCode;
  constructor(code: CharterErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "CharterError";
    this.code = code;
  }
}

type Data = Record<string, unknown>;

/** One Charter version plus the jurisdictions Scope reads population from. */
export class Charter {
  readonly version: string;
  readonly #data: Data;
  readonly #thresholds: [Tier, number][];
  readonly #protected: string[];
  readonly #jurisdictions = new Map<string, Jurisdiction>();

  /**
   * `extraJurisdictions` adds places the reference data lacks (for example districts inside a
   * commune). They come from the caller, never from the matter, and can't replace a known id.
   */
  constructor(root: string = CHARTER_ROOT, extraJurisdictions: Jurisdiction[] = []) {
    this.#data = parse(readFileSync(join(root, "charter.yaml"), "utf8")) as Data;
    this.version = this.#data.version as string;
    const scope = this.#data.scope as { population_source: string; thresholds: unknown[] };
    this.#thresholds = readThresholds(scope.thresholds);
    const rights = this.#data.protected_rights as { topics: string[] }[];
    this.#protected = rights.flatMap((r) => r.topics);
    const source = JSON.parse(readFileSync(join(root, scope.population_source), "utf8")) as {
      jurisdictions: Jurisdiction[];
    };
    for (const j of [...source.jurisdictions, ...extraJurisdictions]) {
      if (this.#jurisdictions.has(j.id)) {
        throw new CharterError("duplicate_jurisdiction", `jurisdiction "${j.id}" given twice`);
      }
      this.#jurisdictions.set(j.id, j);
    }
  }

  /** The value at a dotted key, such as `delegation.cap_share_of_electorate`. */
  param(key: string, version?: string): unknown {
    if (version !== undefined && version !== this.version) {
      throw new CharterError("unknown_version", `have Charter ${this.version}, asked ${version}`);
    }
    let node: unknown = this.#data;
    for (const part of key.split(".")) {
      if (!isPlainObject(node) || !Object.hasOwn(node, part)) {
        throw new CharterError("unknown_key", `no Charter parameter "${key}"`);
      }
      node = node[part];
    }
    return structuredClone(node);
  }

  affectedPopulation(matter: unknown): number {
    const { jurisdiction_id } = readMatter(matter);
    const j = this.#jurisdictions.get(jurisdiction_id);
    if (j === undefined) {
      throw new CharterError("unknown_jurisdiction", `no jurisdiction "${jurisdiction_id}"`);
    }
    const population = j.population;
    if (typeof population !== "number" || !Number.isInteger(population) || population < 0) {
      throw new CharterError("no_population", `jurisdiction "${jurisdiction_id}" has no population`);
    }
    return population;
  }

  /** The matter's tier from its affected population. Labels on the matter are ignored. */
  tier(matter: unknown): Tier {
    const population = this.affectedPopulation(matter);
    for (const [name, minimum] of this.#thresholds) {
      if (population >= minimum) return name;
    }
    throw new Error("unreachable: the last threshold is 0");
  }

  /** True when any topic is a protected-rights topic or sits under one: no vote may decide it. */
  isProtected(matter: unknown): boolean {
    const { topic_ids } = readMatter(matter);
    return topic_ids.some((topic) =>
      this.#protected.some((p) => topic === p || topic.startsWith(p + ".")),
    );
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readThresholds(raw: unknown[]): [Tier, number][] {
  const pairs = raw.map((t) => {
    const { tier, min_population } = t as { tier: Tier; min_population: number };
    return [tier, min_population] as [Tier, number];
  });
  if (pairs.map(([name]) => name).join() !== TIERS.join()) {
    throw new CharterError("invalid_charter", `thresholds must list ${TIERS.join(", ")} in order`);
  }
  const mins = pairs.map(([, m]) => m);
  if (mins.at(-1) !== 0 || mins.some((m, i) => i > 0 && mins[i - 1] <= m)) {
    throw new CharterError("invalid_charter", "thresholds must fall strictly and end at 0");
  }
  return pairs;
}

function readMatter(matter: unknown): Matter {
  if (!isPlainObject(matter)) throw new CharterError("invalid_matter", "a matter is an object");
  const { jurisdiction_id, topic_ids } = matter;
  if (typeof jurisdiction_id !== "string" || jurisdiction_id === "") {
    throw new CharterError("invalid_matter", "jurisdiction_id must be a non-empty string");
  }
  if (!Array.isArray(topic_ids) || !topic_ids.every((t) => typeof t === "string")) {
    throw new CharterError("invalid_matter", "topic_ids must be a list of strings");
  }
  return { jurisdiction_id, topic_ids: topic_ids as string[] };
}

let current: Charter | undefined;

/** The repo's current Charter with the Luxembourg reference data. */
export function load(): Charter {
  current ??= new Charter();
  return current;
}

export const tier = (matter: unknown): Tier => load().tier(matter);
export const affectedPopulation = (matter: unknown): number => load().affectedPopulation(matter);
export const param = (key: string, version?: string): unknown => load().param(key, version);
export const isProtected = (matter: unknown): boolean => load().isProtected(matter);
/** Same as isProtected, under the name the architecture docs and the Python binding use. */
export const is_protected = isProtected;
