/** Read a Docket snapshot of any schema this code understands into one shape. */

import type { DocketError, DocketItem, DocketMeeting, DocketSnapshot, DocketSource } from "./types.ts";

export const SNAPSHOT_SCHEMAS = ["d2.docket.snapshot/1", "d2.docket.snapshot/2"] as const;

/**
 * /1 has one `source` (the Chamber) and no source on meetings or errors; /2 has a `sources`
 * list and tags meetings and errors with their site. Both come back in the /2 shape, labelled
 * /2, so whatever serves the result never shows a /1 label on a /2 body. Any other schema is
 * refused rather than half-read.
 */
export function readSnapshot(raw: unknown): DocketSnapshot {
  const data = (raw ?? {}) as Record<string, unknown>;
  const schema = String(data.schema ?? "");
  if (!(SNAPSHOT_SCHEMAS as readonly string[]).includes(schema)) {
    throw new Error(`unsupported Docket snapshot schema ${JSON.stringify(schema)}; expected ${SNAPSHOT_SCHEMAS.join(" or ")}`);
  }
  if (!Array.isArray(data.items)) throw new Error("Docket snapshot has no items list");
  const items = data.items as DocketItem[];
  const meetings = (Array.isArray(data.meetings) ? data.meetings : []) as DocketMeeting[];
  const errors = (Array.isArray(data.errors) ? data.errors : []) as DocketError[];
  if (schema === "d2.docket.snapshot/1") {
    const one = data.source as DocketSource | undefined;
    return {
      schema: "d2.docket.snapshot/2",
      generated_at: String(data.generated_at ?? ""),
      sources: one ? [{ ...one, id: one.id ?? "chd" }] : [],
      meetings: meetings.map((m) => ({ source: "chd.lu", ...m })),
      items,
      errors: errors.map((e) => ({ source: "chd.lu", ...e })),
    };
  }
  return {
    schema,
    generated_at: String(data.generated_at ?? ""),
    sources: (Array.isArray(data.sources) ? data.sources : []) as DocketSource[],
    meetings,
    items,
    errors,
  };
}
