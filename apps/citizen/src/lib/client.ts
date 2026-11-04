/**
 * The app talks to the Companion through this interface. The served app uses the Companion
 * server (which holds the API key and builds every prompt); the shareable demo runs the same
 * Companion core in the page, with the viewer's own Claude as the model.
 */

import {
  challenge,
  checkClaim,
  explain,
  extractArguments,
  type Argument,
  type ChallengeTurn,
  type ChatMessage,
  type ClaimCheck,
  type Depth,
  type DocketItem,
  type Explanation,
  type FactCheckResult,
  type FileArguments,
  fileArgumentsProblems,
  type IdeasPage,
  type Lang,
  type Position,
  type Provider,
  type Source,
  gradeProblems,
  ideasPageProblems,
} from "@democracy2/companion";

import { CompanionFailure } from "./errors.ts";

export interface ArgumentSet {
  arguments: Argument[];
  sources: Source[];
}

export interface CompanionClient {
  explain(item: DocketItem, lang: Lang, depth: Depth): Promise<Explanation>;
  arguments(item: DocketItem): Promise<ArgumentSet>;
  challenge(item: DocketItem, lang: Lang, position: Position, history: ChatMessage[]): Promise<ChallengeTurn>;
  claim(item: DocketItem, lang: Lang, claim: string): Promise<ClaimCheck>;
}

export class RemoteClient implements CompanionClient {
  private readonly base: string;
  constructor(base = "") {
    this.base = base;
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.base}/api/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return (await res.json()) as T;
  }

  explain(item: DocketItem, lang: Lang, depth: Depth) {
    return this.post<Explanation>("explain", { item_id: item.id, lang, depth });
  }
  arguments(item: DocketItem) {
    return this.post<ArgumentSet>("arguments", { item_id: item.id });
  }
  challenge(item: DocketItem, lang: Lang, position: Position, history: ChatMessage[]) {
    return this.post<ChallengeTurn>("challenge", { item_id: item.id, lang, position, history });
  }
  claim(item: DocketItem, lang: Lang, claim: string) {
    return this.post<ClaimCheck>("claim", { item_id: item.id, lang, claim });
  }
}

/**
 * One devil's-advocate turn. The server decides what is shown (`shown`) and reads the documents
 * itself when Commons is not enough, so the app asks for the documents' arguments only when an
 * older server sends no `shown`.
 */
export async function challengeTurn(
  client: CompanionClient,
  item: DocketItem,
  lang: Lang,
  position: Position,
  history: ChatMessage[],
  known: Argument[] | null,
): Promise<{ turn: ChallengeTurn; args: Argument[] | null }> {
  const turn = await client.challenge(item, lang, position, history);
  if ((turn as Partial<ChallengeTurn>).shown !== undefined || known) return { turn, args: known };
  return { turn, args: (await client.arguments(item)).arguments };
}

/** Runs the Companion core in the page. Results are kept for the session, like the server's cache. */
export class LocalClient implements CompanionClient {
  private readonly provider: Provider;
  private readonly memo = new Map<string, Promise<unknown>>();
  constructor(provider: Provider) {
    this.provider = provider;
  }

  private once<T>(key: string, make: () => Promise<T>): Promise<T> {
    if (!this.memo.has(key)) {
      const p = make().catch((e) => {
        this.memo.delete(key);
        throw e;
      });
      this.memo.set(key, p);
    }
    return this.memo.get(key) as Promise<T>;
  }

  explain(item: DocketItem, lang: Lang, depth: Depth) {
    return this.once(`explain:${item.id}:${lang}:${depth}`, () => explain(this.provider, item, { lang, depth }));
  }
  arguments(item: DocketItem) {
    return this.once(`args:${item.id}`, () => extractArguments(this.provider, item));
  }
  async challenge(item: DocketItem, lang: Lang, position: Position, history: ChatMessage[]) {
    const args = await this.arguments(item);
    return challenge(this.provider, item, { lang, position, arguments: args.arguments, sources: args.sources, history });
  }
  claim(item: DocketItem, lang: Lang, claim: string) {
    return checkClaim(this.provider, item, { lang, claim: claim.slice(0, 500) });
  }
}

/** Checks a claim against the official documents (the Provenance service, through the Companion server). */
export interface FactChecker {
  check(text: string, item?: DocketItem): Promise<FactCheckResult>;
}

/**
 * Calls the Companion server's /api/factcheck. Fails with "unavailable" when the checker is down
 * or answers anything that is not a valid grade: the app then says so and shows no grade.
 */
export class RemoteFactChecker implements FactChecker {
  private readonly base: string;
  constructor(base = "") {
    this.base = base;
  }

  async check(text: string, item?: DocketItem): Promise<FactCheckResult> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/api/factcheck`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(item ? { text, item_id: item.id } : { text }),
      });
    } catch {
      throw new CompanionFailure("unavailable");
    }
    if (res.status === 429) throw new CompanionFailure("busy");
    if (res.status === 413) throw new CompanionFailure("too_long");
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new CompanionFailure("unavailable");
    if (!res.ok) throw new Error(`factcheck: ${res.status}`);
    const body = (await res.json().catch(() => null)) as FactCheckResult | null;
    if (body?.result === "no_record") return body;
    // Checked again here: a grade is shown only when it matches the schema.
    if (body?.result === "graded" && gradeProblems(body.grade).length === 0) return body;
    throw new CompanionFailure("unavailable");
  }
}

/** Reads the ideas residents posted on Agora (read only: posting and supporting are not open yet). */
export interface IdeasReader {
  list(): Promise<IdeasPage>;
}

/** Ideas the app asks for at once. */
export const IDEAS_PAGE = 50;

/**
 * Calls the Companion server's GET /api/ideas. Fails with "unavailable" when Agora is down or
 * answers anything that is not a valid list: the app then says so and shows no ideas.
 */
export class RemoteIdeas implements IdeasReader {
  private readonly base: string;
  constructor(base = "") {
    this.base = base;
  }

  async list(): Promise<IdeasPage> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/api/ideas?limit=${IDEAS_PAGE}`);
    } catch {
      throw new CompanionFailure("unavailable");
    }
    if (res.status === 429) throw new CompanionFailure("busy");
    if (!res.ok) throw new CompanionFailure("unavailable");
    const body = (await res.json().catch(() => null)) as unknown;
    // Checked again here: an idea is shown only when it matches the schema and carries no pseudonym.
    if (ideasPageProblems(body, IDEAS_PAGE).length) throw new CompanionFailure("unavailable");
    return body as IdeasPage;
  }
}

/** Why a file's arguments could not be shown: not on this server, failing, too many requests, or offline with no saved copy. */
export type ArgumentsFailureKind = "off" | "unavailable" | "busy" | "offline";
export class ArgumentsFailure extends Error {
  readonly kind: ArgumentsFailureKind;
  constructor(kind: ArgumentsFailureKind) {
    super(kind);
    this.kind = kind;
  }
}

/** A file's arguments, and when they were saved on this device if they come from the saved copy. */
export interface ArgumentsRead {
  list: FileArguments;
  /** null when the list just came from the network. */
  savedAt: string | null;
}

/** Reads what residents and council groups argued on a file (Commons, read only). */
export interface ArgumentsReader {
  forFile(fileId: string): Promise<ArgumentsRead>;
}

/** The browser cache that keeps the last list of each file opened, for reading offline. */
export const ARGUMENTS_CACHE = "citizen-arguments-1";
const SAVED_AT = "x-saved-at";

async function savedCopy(url: string): Promise<Response | undefined> {
  try {
    return await (await caches.open(ARGUMENTS_CACHE)).match(url);
  } catch {
    return undefined;
  }
}

/**
 * Calls the Companion server's GET /api/files/{id}/arguments. The request is the same whatever
 * the resident chose (no stance, no language): the tabs filter in the page. Each list that
 * passes the check is saved on this device, so a file opened before can show it offline.
 */
export class RemoteArguments implements ArgumentsReader {
  private readonly base: string;
  private readonly now: () => Date;
  constructor(base = "", now = () => new Date()) {
    this.base = base;
    this.now = now;
  }

  async forFile(fileId: string): Promise<ArgumentsRead> {
    const url = `${this.base}/api/files/${encodeURIComponent(fileId)}/arguments`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      // No network: the copy saved the last time this file was opened, if there is one.
      const saved = await savedCopy(url);
      const list = saved ? ((await saved.json().catch(() => null)) as unknown) : null;
      if (saved && list && fileArgumentsProblems(list, fileId).length === 0) {
        return { list: list as FileArguments, savedAt: saved.headers.get(SAVED_AT) };
      }
      throw new ArgumentsFailure(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "unavailable");
    }
    if (res.status === 429) throw new ArgumentsFailure("busy");
    if (res.status === 503) throw new ArgumentsFailure("off");
    if (!res.ok) throw new ArgumentsFailure("unavailable");
    const body = (await res.json().catch(() => null)) as unknown;
    // Checked again here: an argument is shown only when it matches the schema and carries no pseudonym.
    if (fileArgumentsProblems(body, fileId).length) throw new ArgumentsFailure("unavailable");
    try {
      const cache = await caches.open(ARGUMENTS_CACHE);
      await cache.put(url, new Response(JSON.stringify(body), { headers: { "content-type": "application/json", [SAVED_AT]: this.now().toISOString() } }));
    } catch {
      // No Cache API (an old browser, a private window): the list still shows, it is just not kept.
    }
    return { list: body as FileArguments, savedAt: null };
  }
}
