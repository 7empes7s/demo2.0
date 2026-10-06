/**
 * Commons, read over HTTP: the arguments real people and groups made on a matter, each with
 * the public link it came from. The Companion draws the other side from here first.
 *
 *   GET {COMMONS_URL}/matters/{docket item id}/arguments -> { arguments: CommonsArgument[] }
 */

import type { Position } from "./types.ts";
import { readJson, UPSTREAM } from "./upstream.ts";

/** An argument as Commons serves it (spec/schemas/argument.schema.json). */
export interface CommonsArgument {
  id: string;
  matter_id: string;
  /** "yes" or "no" for a council point; other matters may have their own options. */
  stance_option_id: string;
  text: string;
  source_refs: string[];
  author_nym: string;
  cluster_id?: string | null;
  /** "position" says who took a side (for example a group's recorded vote), without reasons. */
  kind?: "argument" | "position" | "proposal";
  attribution?: string;
  source_url?: string;
}

export interface CommonsClient {
  argumentsFor(matterId: string, signal?: AbortSignal): Promise<CommonsArgument[]>;
}

/**
 * Commons needs at least this many reasons on the other side before the Companion relies on it
 * alone. A `position` (who voted which way) is shown but gives no reason, so it does not count.
 */
export const MIN_COMMONS = 2;

/** At most this many arguments are read from one Commons answer. */
export const MAX_COMMONS_ARGUMENTS = 20;
/** Longest argument text and attribution kept from Commons; longer ones are cut. */
export const MAX_COMMONS_TEXT = 1_000;
export const MAX_COMMONS_ATTRIBUTION = 200;

const KINDS = new Set(["argument", "position", "proposal"]);

/** The options that are "the other side" for a resident's position. */
export function otherSide(position: Position): string[] {
  if (position === "for") return ["no"];
  if (position === "against") return ["yes"];
  return ["yes", "no"];
}

/** True when the other side has enough reasons in Commons (positions don't count). */
export function commonsSuffices(commons: CommonsArgument[], position: Position): boolean {
  const sides = otherSide(position);
  return commons.filter((a) => sides.includes(a.stance_option_id) && a.kind !== "position").length >= MIN_COMMONS;
}

function isArgument(value: unknown): value is CommonsArgument {
  const a = value as CommonsArgument;
  return (
    typeof a?.id === "string" &&
    typeof a.matter_id === "string" &&
    typeof a.stance_option_id === "string" &&
    typeof a.text === "string" &&
    a.text.length > 0 &&
    (a.attribution === undefined || typeof a.attribution === "string") &&
    (a.kind === undefined || (typeof a.kind === "string" && KINDS.has(a.kind))) &&
    // Only arguments a reader can open at their source are shown as Commons arguments.
    typeof a.source_url === "string" &&
    /^https?:\/\//i.test(a.source_url)
  );
}

export class HttpCommons implements CommonsClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 2_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
  }

  async argumentsFor(matterId: string, signal?: AbortSignal): Promise<CommonsArgument[]> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const res = await fetch(`${this.baseUrl}/matters/${encodeURIComponent(matterId)}/arguments`, {
      ...UPSTREAM,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) throw new Error(`commons answered ${res.status}`);
    // Past the cap this throws, and an oversized answer is treated like an outage.
    const body = (await readJson(res)) as { arguments?: unknown } | null;
    // A malformed answer is treated like an outage: the caller falls back to the documents.
    if (typeof body !== "object" || body === null || !Array.isArray(body.arguments)) {
      throw new Error("commons answered with an unexpected shape");
    }
    return body.arguments
      .filter(isArgument)
      .filter((a) => a.matter_id === matterId)
      .slice(0, MAX_COMMONS_ARGUMENTS)
      .map((a) => ({
        ...a,
        text: a.text.slice(0, MAX_COMMONS_TEXT),
        ...(a.attribution === undefined ? {} : { attribution: a.attribution.slice(0, MAX_COMMONS_ATTRIBUTION) }),
      }));
  }
}
