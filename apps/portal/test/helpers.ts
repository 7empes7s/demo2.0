/** A fake desk behind `fetch`: routes keyed by "METHOD /path", answering JSON. Every call is recorded. */

import { flushSync, mount, unmount } from "svelte";
import type { Component } from "svelte";
import { vi } from "vitest";

import { prefs } from "../src/lib/prefs.ts";
import { forget, session } from "../src/lib/session.svelte.ts";
import type { Role, Staff } from "../src/lib/types.ts";

export type Answer = { status?: number; body: unknown } | ((init: RequestInit | undefined, url: URL) => { status?: number; body: unknown });

export interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export function fakeDesk(routes: Record<string, Answer>) {
  const calls: Call[] = [];
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname + url.search, headers, body });
    const key = `${method} ${url.pathname}`;
    const answer = routes[key] ?? routes[`${method} ${url.pathname}${url.search}`];
    if (!answer) return new Response(JSON.stringify({ error: `no fake route for ${key}` }), { status: 404, headers: { "content-type": "application/json" } });
    const out = typeof answer === "function" ? answer(init, url) : answer;
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return { calls, fetchSpy };
}

export function staffOf(role: Role, over: Partial<Staff> = {}): Staff {
  return { id: `s-${role}`, login: role, name: role === "admin" ? "Ada Admin" : role === "operator" ? "Olga Operator" : "Avi Auditor", role, ...over };
}

/** Puts a signed-in person in place, as a sign-in would. */
export function signedInAs(role: Role) {
  const staff = staffOf(role);
  prefs.setToken("tok-" + role + "-xxxxxxxxxxxxxxxxxxxxxxxx");
  prefs.setStaff(JSON.stringify(staff));
  session.staff = staff;
  return staff;
}

export function signedOut() {
  forget();
}

let mounted: Record<string, unknown> | null = null;

export function show<P extends Record<string, unknown>>(component: Component<P>, props: P): HTMLElement {
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(component, { target, props }) as Record<string, unknown>;
  flushSync();
  return target;
}

export function cleanup() {
  if (mounted) unmount(mounted);
  mounted = null;
  document.body.innerHTML = "";
  location.hash = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

export const button = (root: ParentNode, text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(text)) ?? null;

export function click(el: Element | null) {
  if (!el) throw new Error("no such element to click");
  (el as HTMLElement).click();
  flushSync();
}

export function type(el: Element | null, value: string) {
  if (!el) throw new Error("no such input");
  const input = el as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}
