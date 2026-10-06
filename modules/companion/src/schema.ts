/**
 * A small JSON Schema checker for the shared schemas in spec/schemas, used on every answer the
 * Companion takes from another service before it reaches a resident. It knows only the keywords
 * those schemas use; a keyword it does not know fails closed.
 */

import localizedTextSchema from "../../../spec/schemas/localized-text.schema.json" with { type: "json" };

export type Schema = {
  $id?: string;
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  minimum?: number;
  minProperties?: number;
  pattern?: string;
  format?: string;
  $ref?: string;
  $defs?: Record<string, Schema>;
};

/** Schemas another schema may `$ref` by file name (`"localized-text.schema.json"`). */
const SHARED: Record<string, Schema> = { "localized-text.schema.json": localizedTextSchema as Schema };

const KNOWN = new Set([
  "$schema", "$id", "title", "description", "type", "enum", "properties", "required", "additionalProperties",
  "items", "minItems", "maxItems", "uniqueItems", "minLength", "minimum", "minProperties", "pattern", "format", "$ref", "$defs",
]);

/** RFC 3339 date-time, as `format: date-time` means it (`2026-10-06T09:00:00.000000Z`, `+02:00`). */
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/i;

/** A real calendar date and clock time: no 30 February, no hour 24, no offset +25:00. */
function isDateTime(s: string): boolean {
  const m = DATE_TIME.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  const day = new Date(0);
  day.setUTCFullYear(y, mo - 1, d); // not Date.UTC: it reads years 0-99 as 1900-1999
  const sameDay = day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d;
  const offsetOk = m[9] === undefined || (Number(m[9]) <= 23 && Number(m[10]) <= 59);
  return sameDay && h <= 23 && mi <= 59 && se <= 59 && offsetOk && !Number.isNaN(Date.parse(s));
}

/** Own keys only: "constructor", "__proto__" or "toString" must never resolve to Object built-ins. */
const own = <T>(rec: Record<string, T> | undefined, key: string): T | undefined =>
  rec !== undefined && Object.hasOwn(rec, key) ? rec[key] : undefined;

// Only a safe integer counts as an integer: 1e300 or 2^53 is never a count anyone can show exactly.
const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isSafeInteger(v) ? "integer" : typeof v);

function check(schema: Schema, value: unknown, root: Schema, at: string, out: string[]): void {
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) out.push(`${at}: unsupported schema keyword ${k}`);
  if (schema.$ref) {
    if (schema.$ref.startsWith("#/$defs/")) {
      const target = own(root.$defs, schema.$ref.slice("#/$defs/".length));
      if (!target) out.push(`${at}: unresolved ${schema.$ref}`);
      else check(target, value, root, at, out);
    } else {
      const target = own(SHARED, schema.$ref);
      if (!target) out.push(`${at}: unresolved ${schema.$ref}`);
      else check(target, value, target, at, out);
    }
    return;
  }
  const t = typeOf(value);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    // An integer is also a number.
    if (!types.includes(t) && !(t === "integer" && types.includes("number"))) return void out.push(`${at}: expected ${types.join(" or ")}`);
  }
  if (schema.enum && !schema.enum.includes(value)) out.push(`${at}: not one of ${schema.enum.join(", ")}`);
  if (t === "string") {
    const s = value as string;
    if (schema.minLength !== undefined && [...s].length < schema.minLength) out.push(`${at}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(s)) out.push(`${at}: does not match ${schema.pattern}`);
    if (schema.format === "uri" && !URL.canParse(s)) out.push(`${at}: not a URI`);
    if (schema.format === "date-time" && !isDateTime(s)) out.push(`${at}: not a date-time`);
  }
  if ((t === "integer" || t === "number") && schema.minimum !== undefined && (value as number) < schema.minimum) out.push(`${at}: below ${schema.minimum}`);
  if (t === "array") {
    const arr = value as unknown[];
    if (schema.minItems !== undefined && arr.length < schema.minItems) out.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && arr.length > schema.maxItems) out.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(arr.map((v) => JSON.stringify(v))).size !== arr.length) out.push(`${at}: items are not unique`);
    if (schema.items) arr.forEach((v, i) => check(schema.items!, v, root, `${at}[${i}]`, out));
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    if (schema.minProperties !== undefined && Object.keys(obj).length < schema.minProperties) out.push(`${at}: fewer than ${schema.minProperties} properties`);
    for (const key of schema.required ?? []) if (!Object.hasOwn(obj, key)) out.push(`${at}.${key}: missing`);
    for (const [key, v] of Object.entries(obj)) {
      const sub = own(schema.properties, key);
      if (sub) check(sub, v, root, `${at}.${key}`, out);
      else if (schema.additionalProperties === false) out.push(`${at}.${key}: not allowed`);
    }
  }
}

/** Why `value` does not match `schema`, each problem prefixed with `at`; empty when it matches. */
export function schemaProblems(schema: Schema, value: unknown, at: string): string[] {
  const out: string[] = [];
  check(schema, value, schema, at, out);
  return out;
}
