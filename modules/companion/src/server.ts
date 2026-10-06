/**
 * Companion server: serves the citizen app, the Docket snapshot and the Companion API.
 * One process, no framework. The browser never sends prompts: it names an item and the
 * server builds the prompt. What a resident types (a claim, the conversation so far) reaches
 * the model only as quoted, size-capped data, and every model-backed route is rate limited.
 *
 *   ANTHROPIC_API_KEY  required for the API routes
 *   COMPANION_MODEL    default claude-sonnet-5-5
 *   SNAPSHOT           path to the Docket snapshot JSON (default data/lu-chd.json)
 *   STATIC_DIR         built app to serve (optional)
 *   PORT               default 8787
 *   HOST               interface to listen on (default 127.0.0.1)
 *   TRUST_PROXY        number of reverse proxies in front (default 0); only then is
 *                      X-Forwarded-For used to tell clients apart
 *   PROVENANCE_URL     the Provenance service that grades claims for /api/factcheck
 *                      (default http://127.0.0.1:8090, its `serve` default)
 */

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join, normalize, resolve, sep } from "node:path";

import { challenge, checkClaim, explain, extractArguments } from "./companion.ts";
import { CheckerInvalid, CheckerUnavailable, gradeClaim, MAX_CLAIM } from "./factcheck.ts";
import { AnthropicProvider, type Provider } from "./provider.ts";
import { readSnapshot } from "./snapshot.ts";
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
}

/** Largest /api/factcheck body: a claim of MAX_CLAIM characters plus an item id fits easily. */
const FACTCHECK_BODY = 4_096;

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
  const factcheckHits = new Map<string, number[]>();
  const factcheckLimit = opts.factcheckPerMinute ?? 20;
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

  /**
   * Proxies a claim to Provenance. Needs no model: it works with or without ANTHROPIC_API_KEY.
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
   * Whether Provenance answers its /healthz, for the Companion's /healthz. Cached for 30 s, waits
   * at most 1 s, and never fails: the claim checker is optional and the app shows "unavailable".
   */
  let provenanceSeen: { ok: boolean; at: number } | null = null;
  let provenanceProbe: Promise<boolean> | null = null;
  const provenanceUp = (): Promise<boolean> => {
    if (!opts.provenanceUrl) return Promise.resolve(false);
    if (provenanceSeen && Date.now() - provenanceSeen.at < 30_000) return Promise.resolve(provenanceSeen.ok);
    provenanceProbe ??= fetch(`${opts.provenanceUrl.replace(/\/+$/, "")}/healthz`, { signal: AbortSignal.timeout(1_000) })
      .then(async (res) => res.ok && ((await res.json()) as { ok?: unknown })?.ok === true)
      .catch(() => false)
      .then((ok) => {
        provenanceSeen = { ok, at: Date.now() };
        provenanceProbe = null;
        return ok;
      });
    return provenanceProbe;
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
        const args = await argumentsFor(it, req);
        return challenge(provider, it, { lang, position, arguments: args.arguments, sources: args.sources, history: history(body.history) });
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
      if (url.pathname === "/healthz") return send(res, 200, { ok: true, items: items.size, companion: !!opts.provider, provenance: await provenanceUp() });
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
        if (url.pathname === "/api/factcheck") return send(res, 200, await factcheck(req));
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
  const provenanceUrl = process.env.PROVENANCE_URL || "http://127.0.0.1:8090";
  createCompanionServer({ provider, snapshot, staticDir: process.env.STATIC_DIR, trustProxy, provenanceUrl }).listen(port, host, () =>
    console.log(`companion listening on ${host}:${port}`),
  );
}
