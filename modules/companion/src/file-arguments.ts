/**
 * A file's arguments from Commons, read over HTTP only, for the citizen app's read-only
 * arguments section on a file page.
 *
 *   GET {COMMONS_URL}/matters/{docket item id}/arguments -> { matter_id, stance, ranker, arguments[], ranking? }
 *
 * Every argument must pass spec/schemas/argument.schema.json and belong to the file asked for,
 * or the whole answer is refused. The author's pseudonym and cluster are dropped here, so they
 * never reach a browser. Rating and posting are not proxied: they wait for secure sign-in (Door).
 *
 * Commons serves no ratings yet, so `ranker` is null and the list is in the order Commons
 * collected it. Once it ranks, `ranker` is the RankerVersion (spec/schemas/ranker-version.schema.json)
 * and `ranking` says, per argument, what the ranker found: `scored` or `needs more ratings`, and
 * whether raters on both sides rated it strong. The order of `arguments` is always Commons' own.
 */

import argumentSchema from "../../../spec/schemas/argument.schema.json" with { type: "json" };
import rankerVersionSchema from "../../../spec/schemas/ranker-version.schema.json" with { type: "json" };

import { type Schema, schemaProblems } from "./schema.ts";
import { MAX_UPSTREAM_BYTES, readJson, TooLarge, UPSTREAM } from "./upstream.ts";

/** Most arguments one answer may hold; more is treated as an invalid answer. */
export const MAX_FILE_ARGUMENTS = 500;

/** What the ranker says about one argument (Commons' `ranker.py` statuses). */
export type RankStatus = "scored" | "needs more ratings";

/** One argument as the Companion passes it to the app: no pseudonym, no cluster. */
export interface FileArgument {
  id: string;
  /** "yes" or "no" on a council point; a consultation's own option id for a proposal. */
  stance_option_id: string;
  /** argument: a reason. position: who took this side, without reasons. proposal: a resident's proposal. */
  kind: "argument" | "position" | "proposal";
  text: string;
  /** Who made it, as the public source names them. Never a private individual's name. */
  attribution?: string;
  source_url?: string;
  /** Only when Commons ranks: what the ranker found. */
  status?: RankStatus;
  /** Only when the ranker says raters on both sides rated it strong. */
  strong_both_sides?: true;
}

/** What GET /api/files/{id}/arguments answers. */
export interface FileArguments {
  file_id: string;
  /** The ranker that ordered the list, or null when nothing is rated yet (collection order). */
  ranker: { id: string; algorithm: string } | null;
  arguments: FileArgument[];
}

const rankingEntry: Schema = {
  type: "object",
  properties: {
    argument_id: { type: "string", minLength: 1 },
    status: { enum: ["scored", "needs more ratings"] },
    n_ratings: { type: "integer", minimum: 0 },
    score: { type: ["number", "null"] },
    strong_both_sides: { type: "boolean" },
  },
  required: ["argument_id", "status"],
  additionalProperties: false,
};

/** Commons' answer: arguments as the shared schema says, plus the ranker and its findings. */
const commonsSchema: Schema = {
  type: "object",
  properties: {
    matter_id: { type: "string", minLength: 1 },
    stance: { type: ["string", "null"] },
    // The ranker version's own `type: object`, widened: null means nothing is rated yet.
    ranker: { ...(rankerVersionSchema as Schema), type: ["object", "null"] },
    arguments: { type: "array", maxItems: MAX_FILE_ARGUMENTS, items: { $ref: "#/$defs/Argument" } },
    ranking: { type: "array", maxItems: MAX_FILE_ARGUMENTS, items: rankingEntry },
  },
  required: ["matter_id", "arguments"],
  additionalProperties: false,
  $defs: { Argument: argumentSchema as Schema },
};

/** What the app accepts from the Companion: checked again in the browser before anything is shown. */
const fileArgumentsSchema: Schema = {
  type: "object",
  properties: {
    file_id: { type: "string", minLength: 1 },
    ranker: {
      type: ["object", "null"],
      properties: { id: { type: "string", minLength: 1 }, algorithm: { type: "string", minLength: 1 } },
      required: ["id", "algorithm"],
      additionalProperties: false,
    },
    arguments: {
      type: "array",
      maxItems: MAX_FILE_ARGUMENTS,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          stance_option_id: { type: "string", minLength: 1 },
          kind: { enum: ["argument", "position", "proposal"] },
          text: { type: "string", minLength: 1 },
          attribution: { type: "string", minLength: 1 },
          source_url: { type: "string", format: "uri", pattern: "^https?://" },
          status: { enum: ["scored", "needs more ratings"] },
          strong_both_sides: { enum: [true] },
        },
        required: ["id", "stance_option_id", "kind", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["file_id", "ranker", "arguments"],
  additionalProperties: false,
};

/** Ids that appear twice (the app keys its list by id) and arguments about another file. */
function listProblems(args: { id: string; matter_id?: string }[], fileId: string | null, at: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  args.forEach((a, i) => {
    if (seen.has(a.id)) out.push(`${at}.arguments[${i}].id: appears twice`);
    seen.add(a.id);
    if (fileId !== null && a.matter_id !== undefined && a.matter_id !== fileId) out.push(`${at}.arguments[${i}].matter_id: another file`);
  });
  return out;
}

/** Why a value is not a valid Commons answer for `fileId`; empty when it is one. */
export function commonsAnswerProblems(value: unknown, fileId: string): string[] {
  const problems = schemaProblems(commonsSchema, value, "commons");
  if (problems.length) return problems;
  const body = value as { matter_id: string; arguments: { id: string; matter_id: string }[] };
  if (body.matter_id !== fileId) problems.push("commons.matter_id: another file");
  return [...problems, ...listProblems(body.arguments, fileId, "commons")];
}

/** Why a value is not a valid /api/files/{id}/arguments answer; empty when it is one. */
export function fileArgumentsProblems(value: unknown, fileId?: string): string[] {
  const problems = schemaProblems(fileArgumentsSchema, value, "arguments");
  if (problems.length) return problems;
  const body = value as FileArguments;
  if (fileId !== undefined && body.file_id !== fileId) problems.push("arguments.file_id: another file");
  return [...problems, ...listProblems(body.arguments, null, "arguments")];
}

/** Commons could not be reached, timed out or failed. */
export class CommonsUnavailable extends Error {}
/** Commons answered something that is not a valid list of the file's arguments. */
export class CommonsInvalid extends Error {}

export interface FileArgumentsOptions {
  /** Default 3 s, for the whole answer. */
  timeoutMs?: number;
  /** Default MAX_UPSTREAM_BYTES; a longer answer is refused, never read in full. */
  maxBytes?: number;
  fetch?: typeof fetch;
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

/** Reads one file's arguments from Commons and returns them without pseudonyms. */
export async function readFileArguments(base: string, fileId: string, opts: FileArgumentsOptions = {}): Promise<FileArguments> {
  const doFetch = opts.fetch ?? fetch;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 3_000);
  let res: Response;
  try {
    res = await doFetch(`${base.replace(/\/+$/, "")}/matters/${encodeURIComponent(fileId)}/arguments`, { ...UPSTREAM, signal });
  } catch (e) {
    throw new CommonsUnavailable(`commons unreachable: ${(e as Error).message}`);
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    throw new CommonsUnavailable(`commons answered ${res.status}`);
  }
  let body: unknown;
  try {
    body = await readJson(res, opts.maxBytes ?? MAX_UPSTREAM_BYTES, signal);
  } catch (e) {
    if (isTimeout(e)) throw new CommonsUnavailable("commons timed out while sending its answer");
    if (e instanceof TooLarge) throw new CommonsInvalid(`commons' ${e.message}`);
    throw new CommonsInvalid("commons answered something that is not JSON");
  }
  const problems = commonsAnswerProblems(body, fileId);
  if (problems.length) throw new CommonsInvalid(`commons answered an invalid list: ${problems.slice(0, 3).join("; ")}`);
  const answer = body as {
    ranker: { id: string; algorithm: string } | null;
    arguments: { id: string; stance_option_id: string; kind?: FileArgument["kind"]; text: string; attribution?: string; source_url?: string }[];
    ranking?: { argument_id: string; status: RankStatus; strong_both_sides?: boolean }[];
  };
  const ranked = answer.ranker ? new Map((answer.ranking ?? []).map((r) => [r.argument_id, r])) : new Map();
  return {
    file_id: fileId,
    ranker: answer.ranker ? { id: answer.ranker.id, algorithm: answer.ranker.algorithm } : null,
    arguments: answer.arguments.map((a) => {
      const r = ranked.get(a.id);
      return {
        id: a.id,
        stance_option_id: a.stance_option_id,
        // An argument without a kind is a reason (the schema's default reading).
        kind: a.kind ?? "argument",
        text: a.text,
        ...(a.attribution === undefined ? {} : { attribution: a.attribution }),
        ...(a.source_url === undefined ? {} : { source_url: a.source_url }),
        ...(r ? { status: r.status } : {}),
        ...(r?.status === "scored" && r.strong_both_sides === true ? { strong_both_sides: true as const } : {}),
      };
    }),
  };
}
