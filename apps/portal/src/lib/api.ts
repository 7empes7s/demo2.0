/**
 * One way to call Desk. The browser reaches it through the Companion server at /api/desk/<path>
 * on the same origin. Every failed call throws an ApiError carrying the API's `{error}` sentence
 * and the status; a 401 also signs the portal out (see session.svelte.ts).
 */

import { prefs } from "./prefs.ts";

export const BASE = "/api/desk";

export class ApiError extends Error {
  readonly status: number;
  /** True when this 401 ended the session (a wrong password at sign-in does not). */
  readonly signedOut: boolean;
  constructor(status: number, message: string, signedOut = false) {
    super(message);
    this.status = status;
    this.signedOut = signedOut;
  }
}

let onUnauthorized: (() => void) | null = null;

/** Called once by the session so a 401 anywhere returns to sign-in. */
export function whenUnauthorized(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  const token = prefs.token();
  if (token) headers.authorization = `Staff ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "the desk cannot be reached");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : `request failed (${res.status})`;
    const endsSession = res.status === 401 && !path.startsWith("/staff/login");
    if (endsSession) onUnauthorized?.();
    throw new ApiError(res.status, message, endsSession);
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}) => api<T>("POST", path, body);
export const patch = <T>(path: string, body: unknown) => api<T>("PATCH", path, body);

/** Builds `?a=b&c=d` from the given filters, leaving out empty ones. */
export function query(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}
