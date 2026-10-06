/**
 * Companion server: serves the citizen app, the Docket snapshot and the Companion API.
 * One process, no framework. The browser never sends prompts: it names an item and the
 * server builds the prompt. What a resident types (a claim, the conversation so far) reaches
 * the model only as quoted, size-capped data, and every model-backed route is rate limited.
 *
 *   ANTHROPIC_API_KEY  required for the API routes
 *   COMPANION_MODEL    default claude-sonnet-5-5
 *   SNAPSHOT           path to the Docket snapshot JSON (default data/lu-chd.json)
 *   COMMONS_URL        Commons API base URL (optional); the devil's advocate draws from it first
 *   STATIC_DIR         built app to serve (optional)
 *   PORT               default 8787
 *   HOST               interface to listen on (default 127.0.0.1)
 *   TRUST_PROXY        number of reverse proxies in front (default 0); only then is
 *                      X-Forwarded-For used to tell clients apart
 */

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join, normalize, resolve, sep } from "node:path";

import { type CommonsArgument, type CommonsClient, HttpCommons, MIN_COMMONS, otherSide } from "./commons.ts";
import { challenge, checkClaim, explain, extractArguments } from "./companion.ts";
import { AnthropicProvider, type Provider } from "./provider.ts";
import { readSnapshot } from "./snapshot.ts";
import { buildSources } from "./sources.ts";
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
  staticDir?: string;
  /** Requests per client per minute on the model-backed routes. */
  ratePerMinute?: number;
  /** Reverse proxies in front of the server. 0 (default) ignores X-Forwarded-For entirely. */
  trustProxy?: number;
}

/** Most clients tracked by the rate limiter before old entries are dropped. */
const MAX_CLIENTS = 10_000;
/** How long a failed argument extraction stays cached, so failures can't be retried in a loop. */
const FAILURE_TTL_MS = 60_000;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
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
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : undefined;
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

  const throttle = (req: IncomingMessage) => {
    const who = clientOf(req);
    const now = Date.now();
    const recent = (hits.get(who) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= limit) throw new HttpError(429, "too many requests, try again in a minute");
    recent.push(now);
    if (!hits.has(who) && hits.size >= MAX_CLIENTS) {
      for (const [key, times] of hits) if (times.every((t) => now - t >= 60_000)) hits.delete(key);
      if (hits.size >= MAX_CLIENTS) hits.clear();
    }
    hits.set(who, recent);
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
        const sides = otherSide(position);
        // Enough real arguments in Commons: no need to extract more from the documents.
        const args =
          commons.filter((a) => sides.includes(a.stance_option_id)).length >= MIN_COMMONS
            ? { arguments: [], sources: buildSources(it, "fr") }
            : await argumentsFor(it, req);
        return challenge(provider, it, {
          lang,
          position,
          arguments: args.arguments,
          sources: args.sources,
          history: history(body.history),
          commons,
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
    if (!staticRoot) throw new HttpError(404, "not found");
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      throw new HttpError(400, "bad path");
    }
    let file = resolve(staticRoot, "." + normalize(decoded));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) throw new HttpError(404, "not found");
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) file = join(staticRoot, "index.html");
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
      if (url.pathname === "/healthz") return send(res, 200, { ok: true, items: items.size, companion: !!opts.provider });
      if (url.pathname === "/data/snapshot.json") {
        if (req.headers["if-none-match"] === snapshotTag) {
          res.writeHead(304, { etag: snapshotTag });
          return res.end();
        }
        res.writeHead(200, { "content-type": "application/json", etag: snapshotTag, "cache-control": "public, max-age=300" });
        return res.end(snapshotBody);
      }
      if (url.pathname.startsWith("/api/")) {
        if (req.method !== "POST") throw new HttpError(405, "use POST");
        return send(res, 200, await api(url.pathname, await readBody(req), req));
      }
      await serveStatic(url.pathname, res);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: e instanceof HttpError ? e.message : "something went wrong" });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const snapshot = readSnapshot(JSON.parse(await readFile(process.env.SNAPSHOT ?? "data/lu-chd.json", "utf8")));
  const key = process.env.ANTHROPIC_API_KEY;
  const provider = key ? new AnthropicProvider(key, process.env.COMPANION_MODEL || undefined) : null;
  if (!provider) console.warn("ANTHROPIC_API_KEY is not set: serving the app and data, Companion routes return 503");
  const port = Number(process.env.PORT ?? 8787);
  const trustProxy = Number(process.env.TRUST_PROXY ?? 0) || 0;
  const host = process.env.HOST || "127.0.0.1";
  const commons = process.env.COMMONS_URL ? new HttpCommons(process.env.COMMONS_URL) : null;
  createCompanionServer({ provider, snapshot, commons, staticDir: process.env.STATIC_DIR, trustProxy }).listen(port, host, () =>
    console.log(`companion listening on ${host}:${port}`),
  );
}
