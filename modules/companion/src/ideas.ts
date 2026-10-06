/**
 * The Agora queue, read over HTTP only (modules never import each other), for the citizen app's
 * read-only Ideas view.
 *
 *   GET {AGORA_URL}/queue?jurisdiction=<id>&limit=<n> -> { charter_version, ideas: Idea[] }
 *
 * Every idea must pass spec/schemas/idea.schema.json before it is passed on, and the proposer's
 * pseudonym is dropped here, so it never reaches a browser. Posting and supporting ideas are not
 * proxied: Agora's identity is a stand-in until secure sign-in (Door) exists.
 */

import ideaSchema from "../../../spec/schemas/idea.schema.json" with { type: "json" };

import { type Schema, schemaProblems } from "./schema.ts";

export type ScopeTier = "national" | "regional" | "local" | "minor";
export const TIERS: readonly ScopeTier[] = ["national", "regional", "local", "minor"];

/** An idea as Agora serves it (spec/schemas/idea.schema.json). */
export interface Idea {
  id: string;
  jurisdiction_id: string;
  topic_ids: string[];
  title: Partial<Record<string, string>>;
  text: Partial<Record<string, string>>;
  proposer_nym: string;
  created_at: string;
  scope_tier: ScopeTier;
  charter_version: string;
  /** null while the count is hidden (Charter agora.upvote_hidden_hours after created_at). */
  upvote_count: number | null;
}

/** An idea as the Companion passes it to the app: never with the proposer's pseudonym. */
export type PublicIdea = Omit<Idea, "proposer_nym">;

/** What GET /api/ideas answers: the queue in Agora's order. */
export interface IdeasPage {
  /** The Charter version Agora ranked the queue under. */
  charter_version: string;
  ideas: PublicIdea[];
}

/** Ideas per page when the app does not ask for a number, and the most it may ask for. */
export const DEFAULT_IDEAS = 50;
export const MAX_IDEAS = 100;
/** Most jurisdictions in one request (Agora's own limit). */
export const MAX_JURISDICTIONS = 20;
/** A jurisdiction id as Agora accepts it. */
export const JURISDICTION = /^[a-z0-9-]{1,64}$/;

const queueSchema = (maxItems: number, idea: Schema): Schema => ({
  type: "object",
  properties: {
    charter_version: { type: "string", minLength: 1 },
    ideas: { type: "array", maxItems, items: { $ref: "#/$defs/Idea" } },
  },
  required: ["charter_version", "ideas"],
  additionalProperties: false,
  $defs: { Idea: idea },
});

/** The idea schema without `proposer_nym`: what the app accepts from the Companion. */
const publicIdeaSchema: Schema = (() => {
  const { proposer_nym: _, ...properties } = (ideaSchema as Schema).properties!;
  return { ...(ideaSchema as Schema), properties, required: (ideaSchema as Schema).required!.filter((k) => k !== "proposer_nym") };
})();

/** Why a value is not a valid Idea; empty when it is one. */
export const ideaProblems = (value: unknown): string[] => schemaProblems(ideaSchema as Schema, value, "idea");

/** Why a value is not a valid Agora /queue answer of at most `limit` ideas; empty when it is one. */
export const queueProblems = (value: unknown, limit = MAX_IDEAS): string[] =>
  schemaProblems(queueSchema(limit, ideaSchema as Schema), value, "queue");

/** Why a value is not a valid /api/ideas answer (no pseudonyms allowed); empty when it is one. */
export const ideasPageProblems = (value: unknown, limit = MAX_IDEAS): string[] =>
  schemaProblems(queueSchema(limit, publicIdeaSchema), value, "ideas");

/** Agora could not be reached, timed out or failed. */
export class AgoraUnavailable extends Error {}
/** Agora answered something that is not a valid queue. */
export class AgoraInvalid extends Error {}

export interface QueueOptions {
  /** Default 3 s, for the whole answer. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

/** Reads Agora's queue (`GET {base}/queue`) and returns it without proposer pseudonyms. */
export async function readQueue(base: string, query: { jurisdictions?: string[]; limit: number }, opts: QueueOptions = {}): Promise<IdeasPage> {
  const doFetch = opts.fetch ?? fetch;
  const params = new URLSearchParams();
  for (const j of query.jurisdictions ?? []) params.append("jurisdiction", j);
  params.set("limit", String(query.limit));
  let res: Response;
  try {
    res = await doFetch(`${base.replace(/\/+$/, "")}/queue?${params}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 3_000) });
  } catch (e) {
    throw new AgoraUnavailable(`agora unreachable: ${(e as Error).message}`);
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    throw new AgoraUnavailable(`agora answered ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    if (isTimeout(e)) throw new AgoraUnavailable("agora timed out while sending its answer");
    throw new AgoraInvalid("agora answered something that is not JSON");
  }
  const problems = queueProblems(body, query.limit);
  if (problems.length) throw new AgoraInvalid(`agora answered an invalid queue: ${problems.slice(0, 3).join("; ")}`);
  const queue = body as { charter_version: string; ideas: Idea[] };
  return {
    charter_version: queue.charter_version,
    ideas: queue.ideas.map(({ proposer_nym: _, ...idea }) => idea),
  };
}
