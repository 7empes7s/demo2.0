/**
 * Companion server: serves the citizen app, the Docket snapshot and the Companion API.
 * One process, no framework. The browser never sends prompts: it names an item and the
 * server builds the prompt, so the API key can't be used as a general-purpose model proxy.
 *
 *   ANTHROPIC_API_KEY  required for the API routes
 *   COMPANION_MODEL    default claude-sonnet-5-5
 *   SNAPSHOT           path to the Docket snapshot JSON (default data/lu-chd.json)
 *   STATIC_DIR         built app to serve (optional)
 *   PORT               default 8787
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

import { challenge, checkClaim, explain, extractArguments } from "./companion.ts";
import { AnthropicProvider, type Provider } from "./provider.ts";
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

export interface ServerOptions {
  provider: Provider | null;
  snapshot: DocketSnapshot;
  staticDir?: string;
  /** Requests per client per minute on the model-backed routes. */
  ratePerMinute?: number;
}

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

function history(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).flatMap((m) => {
    const role = (m as ChatMessage)?.role;
    const content = (m as ChatMessage)?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return [];
    return [{ role, content: content.slice(0, 2_000) }];
  });
}

export function createCompanionServer(opts: ServerOptions) {
  const items = new Map(opts.snapshot.items.map((i) => [i.id, i]));
  const cache = new Map<string, Promise<unknown>>();
  const hits = new Map<string, number[]>();
  const limit = opts.ratePerMinute ?? 20;
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : undefined;

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

  const throttle = (req: IncomingMessage) => {
    const who = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
    const now = Date.now();
    const recent = (hits.get(who) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= limit) throw new HttpError(429, "too many requests, try again in a minute");
    recent.push(now);
    hits.set(who, recent);
  };

  const item = (body: Record<string, unknown>): DocketItem => {
    const found = items.get(String(body.item_id ?? ""));
    if (!found) throw new HttpError(404, "unknown item");
    return found;
  };

  const argumentsFor = (it: DocketItem) => {
    if (!opts.provider) throw new HttpError(503, "the Companion is not configured on this server");
    const provider = opts.provider;
    return cached(`args:${it.id}`, () => extractArguments(provider, it));
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
        return argumentsFor(item(body));
      case "/api/challenge": {
        const it = item(body);
        throttle(req);
        const position = pick<Position>(body.position, ["for", "against", "unsure"]);
        const args = await argumentsFor(it);
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
    let file = resolve(staticRoot, "." + normalize(decodeURIComponent(path)));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) throw new HttpError(404, "not found");
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) file = join(staticRoot, "index.html");
    const data = await readFile(file).catch(() => null);
    if (!data) throw new HttpError(404, "not found");
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/healthz") return send(res, 200, { ok: true, items: items.size, companion: !!opts.provider });
      if (url.pathname === "/data/snapshot.json") return send(res, 200, opts.snapshot);
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
  const snapshot = JSON.parse(await readFile(process.env.SNAPSHOT ?? "data/lu-chd.json", "utf8")) as DocketSnapshot;
  const key = process.env.ANTHROPIC_API_KEY;
  const provider = key ? new AnthropicProvider(key, process.env.COMPANION_MODEL || undefined) : null;
  if (!provider) console.warn("ANTHROPIC_API_KEY is not set: serving the app and data, Companion routes return 503");
  const port = Number(process.env.PORT ?? 8787);
  createCompanionServer({ provider, snapshot, staticDir: process.env.STATIC_DIR }).listen(port, () =>
    console.log(`companion listening on :${port}`),
  );
}
