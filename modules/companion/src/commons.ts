/**
 * Commons, read over HTTP: the arguments real people and groups made on a matter, each with
 * the public link it came from. The Companion draws the other side from here first.
 *
 *   GET {COMMONS_URL}/matters/{docket item id}/arguments -> { arguments: CommonsArgument[] }
 */

import type { Position } from "./types.ts";

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

/** Commons needs at least this many arguments on the other side before the Companion relies on it alone. */
export const MIN_COMMONS = 2;

/** The options that are "the other side" for a resident's position. */
export function otherSide(position: Position): string[] {
  if (position === "for") return ["no"];
  if (position === "against") return ["yes"];
  return ["yes", "no"];
}

function isArgument(value: unknown): value is CommonsArgument {
  const a = value as CommonsArgument;
  return (
    typeof a?.id === "string" &&
    typeof a.matter_id === "string" &&
    typeof a.stance_option_id === "string" &&
    typeof a.text === "string" &&
    a.text.length > 0 &&
    // Only arguments a reader can open at their source are shown as Commons arguments.
    typeof a.source_url === "string" &&
    /^https?:\/\//.test(a.source_url)
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
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) throw new Error(`commons answered ${res.status}`);
    const body = (await res.json()) as { arguments?: unknown[] };
    return (body.arguments ?? []).filter(isArgument).filter((a) => a.matter_id === matterId);
  }
}
