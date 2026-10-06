/**
 * Node only: the Charter inputs Pulse needs, read once at build time and shipped with the app
 * (the browser cannot read charter.yaml). Same data on every device.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CHARTER_ROOT, Charter, CharterError } from "@democracy2/charter";

import type { Place } from "./places.ts";

export interface PulseCharter {
  version: string;
  /** `vote_budget.matters_per_week`, or null when this Charter version has none. */
  budget: number | null;
  places: Place[];
}

export function pulseCharter(root: string = CHARTER_ROOT): PulseCharter {
  const charter = new Charter(root);
  let budget: number | null = null;
  try {
    const value = charter.param("vote_budget.matters_per_week");
    budget = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch (error) {
    if (!(error instanceof CharterError && error.code === "unknown_key")) throw error;
  }
  const source = charter.param("scope.population_source") as string;
  const data = JSON.parse(readFileSync(join(root, source), "utf8")) as { jurisdictions: Place[] };
  const places = data.jurisdictions.map(({ id, parent_id, kind, name }) => ({ id, parent_id: parent_id ?? null, kind, name: name ?? {} }));
  return { version: charter.version, budget, places };
}
