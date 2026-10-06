/**
 * Claim checking through the Provenance service, over HTTP only (modules never import each other).
 * A grade is shown only after it passes spec/schemas/grade.schema.json; anything else is an error,
 * never a made-up grade.
 */

import gradeSchema from "../../../spec/schemas/grade.schema.json" with { type: "json" };

import { type Schema, schemaProblems } from "./schema.ts";

export type GradeColour = "green" | "yellow" | "red";

export interface GradeEvidence {
  url: string;
  source_document_id?: string | null;
  excerpt: string;
  locator?: string;
}

/** A Provenance grade (spec/schemas/grade.schema.json). */
export interface Grade {
  claim_id: string;
  checker_id: string;
  grade: GradeColour;
  evidence: GradeEvidence[];
  model_version: string;
}

/**
 * What the Companion's /api/factcheck answers: a grade, or no record mentions the claim (also when
 * Provenance does not hold the file the claim is about, for example while the two restart on a new
 * snapshot: none of its records mention the claim in that file).
 */
export type FactCheckResult = { result: "graded"; grade: Grade } | { result: "no_record" };

/** Longest claim a resident can send, in characters. Longer claims are refused, never cut. */
export const MAX_CLAIM = 500;

/** Why a value is not a valid Grade; empty when it is one. */
export function gradeProblems(value: unknown): string[] {
  return schemaProblems(gradeSchema as Schema, value, "grade");
}

export const isGrade = (value: unknown): value is Grade => gradeProblems(value).length === 0;

/** The Provenance service could not be reached, timed out or failed. */
export class CheckerUnavailable extends Error {}

/** The machine-readable `code` Provenance puts in a 404 when no record mentions the claim. */
export const NO_RECORD = "no_record";
/** The `code` Provenance puts in a 400 when the `context` item is not in its records. */
export const UNKNOWN_CONTEXT = "unknown_context";

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

/** Reads a small JSON error body; null if it is not JSON or the read fails. Never throws. */
async function errorCode(res: Response): Promise<unknown> {
  try {
    const body = (await res.json()) as { code?: unknown } | null;
    return body && typeof body === "object" ? body.code : null;
  } catch {
    return null;
  }
}
/** The Provenance service answered something that is not a valid grade. */
export class CheckerInvalid extends Error {}

export interface GradeOptions {
  /** Default 8 s. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Asks Provenance (`POST {base}/claims/grade`) to grade a claim, optionally about one Docket item. */
export async function gradeClaim(base: string, text: string, context?: string, opts: GradeOptions = {}): Promise<FactCheckResult> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${base.replace(/\/+$/, "")}/claims/grade`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(context ? { text, context } : { text }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
    });
  } catch (e) {
    throw new CheckerUnavailable(`provenance unreachable: ${(e as Error).message}`);
  }
  if (res.status === 404 || res.status === 400) {
    // Only Provenance's own codes count: a 404 from a wrong path or another service on the port
    // must never tell a resident "no document mentions this".
    const code = await errorCode(res);
    if ((res.status === 404 && code === NO_RECORD) || (res.status === 400 && code === UNKNOWN_CONTEXT)) return { result: "no_record" };
    throw new CheckerUnavailable(`provenance answered ${res.status}${typeof code === "string" ? ` (${code.slice(0, 40)})` : ""}`);
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    throw new CheckerUnavailable(`provenance answered ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    if (isTimeout(e)) throw new CheckerUnavailable("provenance timed out while sending its answer");
    throw new CheckerInvalid("provenance answered something that is not JSON");
  }
  const problems = gradeProblems(body);
  if (problems.length) throw new CheckerInvalid(`provenance answered an invalid grade: ${problems.slice(0, 3).join("; ")}`);
  return { result: "graded", grade: body as Grade };
}
