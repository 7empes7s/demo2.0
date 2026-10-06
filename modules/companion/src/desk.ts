/**
 * The Companion forwards `/api/desk/*` to the Desk service (`DESK_URL`), so the browser talks to
 * one origin. The Companion adds nothing and reads nothing: the caller's Authorization header
 * goes through as is, the body goes through as is (capped), the client's address goes in
 * X-Forwarded-For so Desk can rate limit per client, and Desk's status and JSON come back as
 * they are. Model-backed routes get a longer deadline: an open-weight model on a small box is slow.
 */

import type { IncomingMessage } from "node:http";

import { MAX_SMALL_BYTES, readJson, UPSTREAM } from "./upstream.ts";

export const DESK_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);
/** Largest body forwarded to Desk (Desk itself refuses more). */
export const DESK_BODY = 64 * 1024;
/** Routes that wait on the model. */
const SLOW = /^\/(feedback\/[^/]+\/(triage|draft)|ai\/(test|translate))$/;

export class DeskUnavailable extends Error {}

export interface DeskAnswer {
  status: number;
  body: unknown;
}

export async function forwardToDesk(
  base: string,
  req: IncomingMessage,
  path: string,
  search: string,
  body: Buffer | null,
  client: string,
  opts: { timeoutMs?: number; slowTimeoutMs?: number } = {},
): Promise<DeskAnswer> {
  const method = req.method ?? "GET";
  if (!DESK_METHODS.has(method)) return { status: 405, body: { error: "method not allowed" } };
  const headers: Record<string, string> = { "x-forwarded-for": client };
  const auth = req.headers.authorization;
  if (typeof auth === "string") headers.authorization = auth;
  if (body) headers["content-type"] = "application/json";
  const timeout = SLOW.test(path) ? (opts.slowTimeoutMs ?? 150_000) : (opts.timeoutMs ?? 10_000);
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/+$/, "")}${path}${search}`, {
      ...UPSTREAM,
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new DeskUnavailable(e instanceof Error ? e.message : String(e));
  }
  let parsed: unknown;
  try {
    parsed = await readJson(res, 4 * 1024 * 1024);
  } catch (e) {
    throw new DeskUnavailable(`answer could not be read: ${e instanceof Error ? e.message : e}`);
  }
  return { status: res.status, body: parsed };
}

/** Whether the service answers; for /healthz. */
export async function deskUp(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/healthz`, { ...UPSTREAM, signal: AbortSignal.timeout(1_000) });
    return res.ok && ((await readJson(res, MAX_SMALL_BYTES)) as { ok?: unknown })?.ok === true;
  } catch {
    return false;
  }
}
