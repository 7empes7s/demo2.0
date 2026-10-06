/**
 * Claim checking through the Provenance service, over HTTP only (modules never import each other).
 * A grade is shown only after it passes spec/schemas/grade.schema.json; anything else is an error,
 * never a made-up grade.
 */

import gradeSchema from "../../../spec/schemas/grade.schema.json" with { type: "json" };

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

/** What the Companion's /api/factcheck answers: a grade, or no record mentions the claim. */
export type FactCheckResult = { result: "graded"; grade: Grade } | { result: "no_record" };

/** Longest claim a resident can send, in characters. Longer claims are refused, never cut. */
export const MAX_CLAIM = 500;

type Schema = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  minItems?: number;
  minLength?: number;
  pattern?: string;
  format?: string;
  $ref?: string;
  $defs?: Record<string, Schema>;
};

const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/**
 * The JSON Schema keywords the shared schemas use (type, enum, properties, required,
 * additionalProperties: false, items, minItems, minLength, pattern, format uri, local $ref).
 * A keyword it does not know fails closed.
 */
function check(schema: Schema, value: unknown, root: Schema, at: string, out: string[]): void {
  const known = new Set(["$schema", "$id", "title", "description", "type", "enum", "properties", "required", "additionalProperties", "items", "minItems", "minLength", "pattern", "format", "$ref", "$defs"]);
  for (const k of Object.keys(schema)) if (!known.has(k)) out.push(`${at}: unsupported schema keyword ${k}`);
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\/\$defs\//, "");
    const target = root.$defs?.[name];
    if (!target) out.push(`${at}: unresolved ${schema.$ref}`);
    else check(target, value, root, at, out);
    return;
  }
  const t = typeOf(value);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.includes(t)) return void out.push(`${at}: expected ${types.join(" or ")}`);
  }
  if (schema.enum && !schema.enum.includes(value)) out.push(`${at}: not one of ${schema.enum.join(", ")}`);
  if (t === "string") {
    const s = value as string;
    if (schema.minLength !== undefined && [...s].length < schema.minLength) out.push(`${at}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(s)) out.push(`${at}: does not match ${schema.pattern}`);
    if (schema.format === "uri" && !URL.canParse(s)) out.push(`${at}: not a URI`);
  }
  if (t === "array") {
    const arr = value as unknown[];
    if (schema.minItems !== undefined && arr.length < schema.minItems) out.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.items) arr.forEach((v, i) => check(schema.items!, v, root, `${at}[${i}]`, out));
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in obj)) out.push(`${at}.${key}: missing`);
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (sub) check(sub, v, root, `${at}.${key}`, out);
      else if (schema.additionalProperties === false) out.push(`${at}.${key}: not allowed`);
    }
  }
}

/** Why a value is not a valid Grade; empty when it is one. */
export function gradeProblems(value: unknown): string[] {
  const out: string[] = [];
  check(gradeSchema as Schema, value, gradeSchema as Schema, "grade", out);
  return out;
}

export const isGrade = (value: unknown): value is Grade => gradeProblems(value).length === 0;

/** The Provenance service could not be reached, timed out or failed. */
export class CheckerUnavailable extends Error {}
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
  if (res.status === 404) {
    await res.body?.cancel();
    return { result: "no_record" };
  }
  if (res.status !== 200) {
    await res.body?.cancel();
    throw new CheckerUnavailable(`provenance answered ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new CheckerInvalid("provenance answered something that is not JSON");
  }
  const problems = gradeProblems(body);
  if (problems.length) throw new CheckerInvalid(`provenance answered an invalid grade: ${problems.slice(0, 3).join("; ")}`);
  return { result: "graded", grade: body as Grade };
}
