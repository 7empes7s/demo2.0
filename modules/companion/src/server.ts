/**
 * Companion server: serves the citizen app, the Docket snapshot and the Companion API.
 * One process, no framework. The browser never sends prompts: it names an item and the
 * server builds the prompt. What a resident types (a claim, the conversation so far) reaches
 * the model only as quoted, size-capped data, and every model-backed route is rate limited.
 *
 *   LLM_PROVIDER       openai | anthropic (default: openai when LLM_BASE_URL is set, anthropic
 *                      when only ANTHROPIC_API_KEY is set, none otherwise: the model routes then 503)
 *   LLM_BASE_URL       OpenAI-compatible base URL, such as http://127.0.0.1:11434/v1 (Ollama)
 *   LLM_API_KEY        Bearer token for that URL (optional: local servers need none)
 *   LLM_MODEL          model name (required with openai)
 *   LLM_TIMEOUT_MS     one model attempt's wait (default 120000)
 *   ANTHROPIC_API_KEY  the Anthropic path, kept for the bridge period
 *   COMPANION_MODEL    older name for the Anthropic model; LLM_MODEL wins
 *   SNAPSHOT           path to the Docket snapshot JSON (default data/lu-chd.json)
 *   COMMONS_URL        Commons API base URL (optional); the devil's advocate draws from it first
 *   STATIC_DIR         built app to serve (optional)
 *   PORT               default 8787
 *   HOST               interface to listen on (default 127.0.0.1)
 *   TRUST_PROXY        number of reverse proxies in front (default 0); only then is
 *                      X-Forwarded-For used to tell clients apart
 *   PROVENANCE_URL     the Provenance service that grades claims for /api/factcheck
 *                      (default http://127.0.0.1:8090, its `serve` default)
 *   AGORA_URL          the Agora service whose queue GET /api/ideas reads
 *                      (default http://127.0.0.1:8091, its `serve` default). Read only: posting
 *                      and supporting ideas are never proxied until secure sign-in exists.
 *   DESK_URL           the Desk service (feedback, ideas, votes, procedures, staff portals);
 *                      /api/desk/* is forwarded to it as is (default http://127.0.0.1:8094)
 *   PORTAL_DIR         the built staff portals, served under /portal/ (optional)
 */

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join, normalize, resolve, sep } from "node:path";

import { type CommonsArgument, type CommonsClient, commonsSuffices, HttpCommons } from "./commons.ts";
import { challenge, checkClaim, explain, extractArguments } from "./companion.ts";
import { CheckerInvalid, CheckerUnavailable, gradeClaim, MAX_CLAIM } from "./factcheck.ts";
import { DESK_BODY, DeskUnavailable, forwardToDesk } from "./desk.ts";
import { AgoraInvalid, AgoraUnavailable, DEFAULT_IDEAS, type IdeasPage, JURISDICTION, MAX_IDEAS, MAX_JURISDICTIONS, readQueue } from "./ideas.ts";
import { MAX_SMALL_BYTES, readJson, UPSTREAM } from "./upstream.ts";
import { ModelError, type Provider, providerFromEnv } from "./provider.ts";
import { readSnapshot } from "./snapshot.ts";
import { buildSources, ModelAnswerError } from "./sources.ts";
import { LANGS, type ChatMessage, type Depth, type DocketItem, type DocketSnapshot, type Lang, type Position } from "./types.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

/** Static files served with Cache-Control: no-cache (besides every .html page). */
const REVALIDATE = new Set(["sw.js", "manifest.webmanifest"]);

export interface ServerOptions {
  provider: Provider | null;
  snapshot: DocketSnapshot;
  /** Where the devil's advocate finds real arguments first. Without it, only the file's documents are used. */
  commons?: CommonsClient | null;
  /** Commons-first rule (default on). Test seam: off only as a control for the Phase 1 metric. */
  commonsFirst?: boolean;
  staticDir?: string;
  /** Requests per client per minute on the model-backed routes. */
  ratePerMinute?: number;
  /** Claim checks per client per minute (default 20). Their own bucket: they cost no model tokens. */
  factcheckPerMinute?: number;
  /** Reverse proxies in front of the server. 0 (default) ignores X-Forwarded-For entirely. */
  trustProxy?: number;
  /** Base URL of the Provenance service. Without it /api/factcheck answers 503. */
  provenanceUrl?: string;
  /** How long to wait for Provenance, in ms (default 8000). */
  provenanceTimeoutMs?: number;
  /** Base URL of the Agora service. Without it /api/ideas answers 503. */
  agoraUrl?: string;
  /** Base URL of the Desk service. Without it /api/desk/* answers 503. */
  deskUrl?: string;
  /** Deadline for a Desk answer, in ms (default 10 s; model-backed Desk routes 150 s). */
  deskTimeoutMs?: number;
  deskSlowTimeoutMs?: number;
  /** The built staff portals, served under /portal/. */
  portalDir?: string;
  /** How long to wait for Agora's whole answer, in ms (default 3000). */
  agoraTimeoutMs?: number;
  /** How long one Agora answer is reused for the same query, in ms. Default 15 s. */
  ideasCacheMs?: number;
  /** Ideas-list reads per client per minute (default 60). Their own bucket: they cost no model tokens. */
  ideasPerMinute?: number;
}

/** Largest /api/factcheck body: a claim of MAX_CLAIM characters plus an item id fits easily. */
const FACTCHECK_BODY = 4_096;

/** Most clients tracked by the rate limiter before old entries are dropped. */
const MAX_CLIENTS = 10_000;
/** How long a failed argument extraction stays cached, so failures can't be retried in a loop. */
const FAILURE_TTL_MS = 60_000;

class HttpError extends Error {
  readonly status: number;
  readonly headers: Record<string, string>;
  constructor(status: number, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

async function readBody(req: IncomingMessage, limit = 32_000): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "request too large");
    chunks.push(chunk as Buffer);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "body must be a JSON object");
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { ...headers, "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T {
  if (allowed.includes(value as T)) return value as T;
  if (fallback !== undefined) return fallback;
  throw new HttpError(400, `expected one of ${allowed.join(", ")}`);
}

/** The last few turns, trimmed to a fixed budget. They reach the model only as quoted data. */
function history(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  const turns = value.slice(-8).flatMap((m) => {
    const role = (m as ChatMessage)?.role;
    const content = (m as ChatMessage)?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return [];
    return [{ role, content: content.slice(0, 1_000) }];
  });
  let budget = 6_000;
  const kept: ChatMessage[] = [];
  for (const turn of turns.reverse()) {
    if (turn.content.length > budget) break;
    budget -= turn.content.length;
    kept.unshift(turn);
  }
  return kept;
}

export function createCompanionServer(opts: ServerOptions) {
  // Accepts snapshot/1 and /2, and serves it in the /2 shape.
  const snapshot = readSnapshot(opts.snapshot);
  const items = new Map(snapshot.items.map((i) => [i.id, i]));
  const cache = new Map<string, Promise<unknown>>();
  const hits = new Map<string, number[]>();
  const limit = opts.ratePerMinute ?? 20;
  const factcheckHits = new Map<string, number[]>();
  const factcheckLimit = opts.factcheckPerMinute ?? 20;
  const ideasHits = new Map<string, number[]>();
  const ideasLimit = opts.ideasPerMinute ?? 60;
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : undefined;
  const portalRoot = opts.portalDir ? resolve(opts.portalDir) : undefined;
  const trustProxy = opts.trustProxy ?? 0;
  // The snapshot can be megabytes of document text: serialise it once, not per request.
  const snapshotBody = Buffer.from(JSON.stringify(snapshot));
  const snapshotTag = `"${createHash("sha256").update(snapshotBody).digest("hex").slice(0, 32)}"`;

  const cached = <T>(key: string, make: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) {
      const p = make().catch((e) => {
        cache.delete(key);
        throw e;
      });
      cache.set(key, p);
    }
    return cache.get(key) as Promise<T>;
  };

  /** The socket address, or the entry the nearest trusted proxy appended to X-Forwarded-For. */
  const clientOf = (req: IncomingMessage): string => {
    const socket = req.socket.remoteAddress ?? "?";
    if (trustProxy <= 0) return socket;
    const chain = String(req.headers["x-forwarded-for"] ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    return chain[chain.length - trustProxy] ?? chain[0] ?? socket;
  };

  const throttle = (req: IncomingMessage, bucket = hits, max = limit) => {
    const who = clientOf(req);
    const now = Date.now();
    const recent = (bucket.get(who) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= max) throw new HttpError(429, "too many requests, try again in a minute");
    recent.push(now);
    if (!bucket.has(who) && bucket.size >= MAX_CLIENTS) {
      for (const [key, times] of bucket) if (times.every((t) => now - t >= 60_000)) bucket.delete(key);
      if (bucket.size >= MAX_CLIENTS) bucket.clear();
    }
    bucket.set(who, recent);
  };

  const item = (body: Record<string, unknown>): DocketItem => {
    const found = items.get(String(body.item_id ?? ""));
    if (!found) throw new HttpError(404, "unknown item");
    return found;
  };

  const failures = new Map<string, { error: unknown; until: number }>();
  const argumentsFor = (it: DocketItem, req: IncomingMessage) => {
    if (!opts.provider) throw new HttpError(503, "the Companion is not configured on this server");
    const provider = opts.provider;
    const key = `args:${it.id}`;
    const failed = failures.get(key);
    if (failed && failed.until > Date.now()) throw new HttpError(503, "the Companion could not read this file, try again later");
    return cached(key, () => {
      throttle(req);
      return extractArguments(provider, it).catch((error) => {
        failures.set(key, { error, until: Date.now() + FAILURE_TTL_MS });
        throw error;
      });
    });
  };

  /** Commons' arguments on an item; an unreachable Commons means none, never a failed turn. */
  const commonsFor = async (it: DocketItem): Promise<CommonsArgument[]> => {
    if (!opts.commons) return [];
    try {
      return await opts.commons.argumentsFor(it.id);
    } catch (e) {
      console.warn(`commons unavailable for ${it.id}: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  };

  /**
   * Proxies a claim to Provenance. Needs no model: it works with or without one configured.
   * 200 {result: "graded", grade} | {result: "no_record"}; 503 when Provenance is unreachable;
   * 502 when it answers something that is not a valid grade. Never a grade it did not give.
   */
  async function factcheck(req: IncomingMessage): Promise<unknown> {
    const body = await readBody(req, FACTCHECK_BODY);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw new HttpError(400, "claim is empty");
    if ([...text].length > MAX_CLAIM) throw new HttpError(413, `claim is longer than ${MAX_CLAIM} characters`);
    const context = body.item_id === undefined || body.item_id === null ? undefined : item(body).id;
    if (!opts.provenanceUrl) throw new HttpError(503, "the claim checker is not configured on this server");
    throttle(req, factcheckHits, factcheckLimit);
    try {
      return await gradeClaim(opts.provenanceUrl, text, context, { timeoutMs: opts.provenanceTimeoutMs });
    } catch (e) {
      // Logs say what went wrong upstream, never what the resident wrote (only its length).
      if (e instanceof CheckerUnavailable) {
        console.error(`factcheck: ${e.message} (claim of ${[...text].length} characters)`);
        throw new HttpError(503, "the claim checker is unavailable");
      }
      if (e instanceof CheckerInvalid) {
        console.error(`factcheck: ${e.message} (claim of ${[...text].length} characters)`);
        throw new HttpError(502, "the claim checker gave an answer that could not be read");
      }
      throw e;
    }
  }

  /**
   * Whether an optional service answers its /healthz, for the Companion's /healthz. Cached for
   * 30 s, waits at most 1 s, and never fails: the claim checker and the ideas list are optional,
   * and the app says "unavailable" when one is down.
   */
  const healthProbe = (base: string | undefined) => {
    let seen: { ok: boolean; at: number } | null = null;
    let probe: Promise<boolean> | null = null;
    return (): Promise<boolean> => {
      if (!base) return Promise.resolve(false);
      if (seen && Date.now() - seen.at < 30_000) return Promise.resolve(seen.ok);
      probe ??= fetch(`${base.replace(/\/+$/, "")}/healthz`, { ...UPSTREAM, signal: AbortSignal.timeout(1_000) })
        .then(async (res) => res.ok && ((await readJson(res, MAX_SMALL_BYTES)) as { ok?: unknown })?.ok === true)
        .catch(() => false)
        .then((ok) => {
          seen = { ok, at: Date.now() };
          probe = null;
          return ok;
        });
      return probe;
    };
  };
  const provenanceUp = healthProbe(opts.provenanceUrl);
  const agoraUp = healthProbe(opts.agoraUrl);
  const deskUp = healthProbe(opts.deskUrl);

  /** Reads a request body as bytes, up to a cap, to pass on unchanged. */
  async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer | null> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > limit) throw new HttpError(413, "request too large");
      chunks.push(chunk as Buffer);
    }
    return chunks.length ? Buffer.concat(chunks) : null;
  }

  /** /api/desk/<path>: the Desk's answer, status and all. 503 when Desk is unreachable. */
  async function deskRoute(req: IncomingMessage, url: URL): Promise<{ status: number; body: unknown }> {
    if (!opts.deskUrl) throw new HttpError(503, "the desk is not configured on this server");
    const path = url.pathname.slice("/api/desk".length) || "/";
    const body = req.method === "GET" ? null : await readRaw(req, DESK_BODY);
    try {
      return await forwardToDesk(opts.deskUrl, req, path, url.search, body, clientOf(req), { timeoutMs: opts.deskTimeoutMs, slowTimeoutMs: opts.deskSlowTimeoutMs });
    } catch (e) {
      if (e instanceof DeskUnavailable) {
        console.error(`desk: ${e.message}`);
        throw new HttpError(503, "the desk is unavailable");
      }
      throw e;
    }
  }

  /**
   * GET /api/ideas?jurisdiction=<id>&jurisdiction=<id>&limit=<n>: Agora's queue, read only.
   * 200 {charter_version, ideas} without proposer pseudonyms; 400 on a bad query; 503 when Agora
   * is unreachable, slow or failing; 502 when it answers something that is not a valid queue.
   */
  /**
   * Agora's answer per query (sorted jurisdictions and limit), shared by every request in the next
   * 15 s, including the ones that arrive while it is still being read: page views never multiply
   * reads of a large queue. Failures are not kept.
   */
  const queueCache = new Map<string, { at: number; page: Promise<IdeasPage> }>();
  function cachedQueue(base: string, jurisdictions: string[], limit: number): Promise<IdeasPage> {
    const now = Date.now();
    for (const [k, v] of queueCache) if (now - v.at >= (opts.ideasCacheMs ?? 15_000)) queueCache.delete(k);
    const key = `${jurisdictions.join(",")}|${limit}`;
    const hit = queueCache.get(key);
    if (hit) return hit.page;
    // Bounded: at most 32 queries are kept, the oldest goes first.
    if (queueCache.size >= 32) queueCache.delete(queueCache.keys().next().value!);
    const entry = { at: now, page: readQueue(base, { jurisdictions, limit }, { timeoutMs: opts.agoraTimeoutMs }) };
    queueCache.set(key, entry);
    entry.page.catch(() => {
      if (queueCache.get(key) === entry) queueCache.delete(key);
    });
    return entry.page;
  }

  async function ideas(req: IncomingMessage, url: URL): Promise<unknown> {
    for (const key of url.searchParams.keys()) {
      if (key !== "jurisdiction" && key !== "limit") throw new HttpError(400, `unknown parameter ${key.slice(0, 40)}`);
    }
    const limits = url.searchParams.getAll("limit");
    if (limits.length > 1) throw new HttpError(400, "give limit once");
    if (limits.length && !/^[1-9][0-9]{0,2}$/.test(limits[0])) throw new HttpError(400, `limit must be a whole number from 1 to ${MAX_IDEAS}`);
    const limit = limits.length ? Number(limits[0]) : DEFAULT_IDEAS;
    if (limit > MAX_IDEAS) throw new HttpError(400, `limit must be a whole number from 1 to ${MAX_IDEAS}`);
    const jurisdictions = [...new Set(url.searchParams.getAll("jurisdiction"))];
    if (jurisdictions.some((j) => !JURISDICTION.test(j))) throw new HttpError(400, "jurisdiction must be a jurisdiction id");
    if (jurisdictions.length > MAX_JURISDICTIONS) throw new HttpError(400, `at most ${MAX_JURISDICTIONS} jurisdictions`);
    if (!opts.agoraUrl) throw new HttpError(503, "the ideas list is not configured on this server");
    throttle(req, ideasHits, ideasLimit);
    try {
      return await cachedQueue(opts.agoraUrl, jurisdictions.sort(), limit);
    } catch (e) {
      if (e instanceof AgoraUnavailable) {
        console.error(`ideas: ${e.message}`);
        throw new HttpError(503, "the ideas list is unavailable");
      }
      if (e instanceof AgoraInvalid) {
        console.error(`ideas: ${e.message}`);
        throw new HttpError(502, "the ideas list gave an answer that could not be read");
      }
      throw e;
    }
  }

  async function api(path: string, body: Record<string, unknown>, req: IncomingMessage): Promise<unknown> {
    if (!opts.provider) throw new HttpError(503, "the Companion is not configured on this server");
    const provider = opts.provider;
    const lang = pick<Lang>(body.lang, LANGS, "en");
    switch (path) {
      case "/api/explain": {
        const it = item(body);
        const depth = pick<Depth>(body.depth, ["short", "standard", "deep"], "standard");
        return cached(`explain:${it.id}:${lang}:${depth}`, () => {
          throttle(req);
          return explain(provider, it, { lang, depth });
        });
      }
      case "/api/arguments":
        return argumentsFor(item(body), req);
      case "/api/challenge": {
        const it = item(body);
        throttle(req);
        const position = pick<Position>(body.position, ["for", "against", "unsure"]);
        const commons = await commonsFor(it);
        const commonsFirst = opts.commonsFirst ?? true;
        // Enough real reasons in Commons: no need to extract more from the documents.
        const args =
          commonsFirst && commonsSuffices(commons, position)
            ? { arguments: [], sources: buildSources(it, "fr") }
            : await argumentsFor(it, req);
        return challenge(provider, it, {
          lang,
          position,
          arguments: args.arguments,
          sources: args.sources,
          history: history(body.history),
          commons,
          commonsFirst,
        });
      }
      case "/api/claim": {
        const it = item(body);
        throttle(req);
        const claim = String(body.claim ?? "").trim().slice(0, 500);
        if (!claim) throw new HttpError(400, "claim is empty");
        return checkClaim(provider, it, { lang, claim });
      }
      default:
        throw new HttpError(404, "not found");
    }
  }

  async function serveStatic(path: string, res: ServerResponse) {
    // The staff portals are a second built app under /portal/, with their own fallback page.
    if (portalRoot && (path === "/portal" || path.startsWith("/portal/"))) return serveFrom(portalRoot, path.slice("/portal".length) || "/", res);
    if (!staticRoot) throw new HttpError(404, "not found");
    return serveFrom(staticRoot, path, res);
  }

  async function serveFrom(root: string, path: string, res: ServerResponse) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      throw new HttpError(400, "bad path");
    }
    let file = resolve(root, "." + normalize(decoded));
    if (file !== root && !file.startsWith(root + sep)) throw new HttpError(404, "not found");
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) file = join(root, "index.html");
    const data = await readFile(file).catch(() => null);
    if (!data) throw new HttpError(404, "not found");
    const headers: Record<string, string> = { "content-type": MIME[extname(file)] ?? "application/octet-stream" };
    // The page, the manifest and the service worker must be revalidated on every load, or an
    // installed app keeps running an old version. Hashed assets can be cached as the browser likes.
    if (REVALIDATE.has(basename(file)) || extname(file) === ".html") headers["cache-control"] = "no-cache";
    res.writeHead(200, headers);
    res.end(data);
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/healthz") {
        const [provenance, agora, desk] = await Promise.all([provenanceUp(), agoraUp(), deskUp()]);
        const model = opts.provider ? { kind: opts.provider.kind ?? "unknown", name: opts.provider.model } : null;
        return send(res, 200, { ok: true, items: items.size, companion: !!opts.provider, model, provenance, agora, desk });
      }
      if (url.pathname === "/data/snapshot.json") {
        if (req.headers["if-none-match"] === snapshotTag) {
          res.writeHead(304, { etag: snapshotTag });
          return res.end();
        }
        res.writeHead(200, { "content-type": "application/json", etag: snapshotTag, "cache-control": "public, max-age=300" });
        return res.end(snapshotBody);
      }
      if (url.pathname === "/api/desk" || url.pathname.startsWith("/api/desk/")) {
        const out = await deskRoute(req, url);
        return send(res, out.status, out.body);
      }
      if (url.pathname === "/api/ideas" || url.pathname.startsWith("/api/ideas/")) {
        // Read only. Posting and supporting ideas stay off until secure sign-in (Door) exists:
        // Agora's stand-in identity lets anyone who reaches it invent participants.
        if (req.method !== "GET") throw new HttpError(405, "posting and supporting ideas is not open yet", { allow: "GET" });
        if (url.pathname !== "/api/ideas") throw new HttpError(404, "not found");
        return send(res, 200, await ideas(req, url));
      }
      if (url.pathname.startsWith("/api/")) {
        if (req.method !== "POST") throw new HttpError(405, "use POST");
        if (url.pathname === "/api/factcheck") return send(res, 200, await factcheck(req));
        return send(res, 200, await api(url.pathname, await readBody(req), req));
      }
      await serveStatic(url.pathname, res);
    } catch (e) {
      if (e instanceof ModelAnswerError || e instanceof ModelError) {
        // The model's fault, not ours: a refusal, prose instead of JSON, a timeout or an upstream error.
        console.error(`model: ${e.message}`);
        return send(res, 502, { error: e instanceof ModelError ? "the model did not answer" : "the model gave an answer that could not be read" });
      }
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: e instanceof HttpError ? e.message : "something went wrong" }, e instanceof HttpError ? e.headers : {});
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const snapshot = readSnapshot(JSON.parse(await readFile(process.env.SNAPSHOT ?? "data/lu-chd.json", "utf8")));
  const chosen = providerFromEnv(process.env);
  const provider = chosen?.provider ?? null;
  if (chosen) console.log(`companion model: ${chosen.provider.kind} ${chosen.provider.model} at ${chosen.endpoint}`);
  else console.warn("no model configured (LLM_BASE_URL or ANTHROPIC_API_KEY): serving the app and data, Companion routes return 503");
  const port = Number(process.env.PORT ?? 8787);
  const trustProxy = Number(process.env.TRUST_PROXY ?? 0) || 0;
  const host = process.env.HOST || "127.0.0.1";
  const commons = process.env.COMMONS_URL ? new HttpCommons(process.env.COMMONS_URL) : null;
  const provenanceUrl = process.env.PROVENANCE_URL || "http://127.0.0.1:8090";
  const agoraUrl = process.env.AGORA_URL || "http://127.0.0.1:8091";
  const deskUrl = process.env.DESK_URL || "http://127.0.0.1:8094";
  createCompanionServer({ provider, snapshot, commons, staticDir: process.env.STATIC_DIR, portalDir: process.env.PORTAL_DIR, trustProxy, provenanceUrl, agoraUrl, deskUrl }).listen(port, host, () =>
    console.log(`companion listening on ${host}:${port}`),
  );
}
