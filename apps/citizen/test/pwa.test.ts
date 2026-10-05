import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { canRegister } from "../src/lib/pwa.ts";

const here = (path: string) => new URL(`../${path}`, import.meta.url);
const sw = { serviceWorker: {} };

describe("service worker registration guard", () => {
  it("registers on https and on this machine over http", () => {
    expect(canRegister({ protocol: "https:", hostname: "cracia.example.lu" }, sw)).toBe(true);
    expect(canRegister({ protocol: "http:", hostname: "localhost" }, sw)).toBe(true);
    expect(canRegister({ protocol: "http:", hostname: "127.0.0.1" }, sw)).toBe(true);
  });

  it("does not register on plain http elsewhere, in pages without a URL, or without support", () => {
    expect(canRegister({ protocol: "http:", hostname: "192.168.1.20" }, sw)).toBe(false);
    expect(canRegister({ protocol: "about:", hostname: "" }, sw)).toBe(false);
    expect(canRegister({ protocol: "blob:", hostname: "" }, sw)).toBe(false);
    expect(canRegister({ protocol: "https:", hostname: "x.lu" }, {})).toBe(false);
    expect(canRegister({ protocol: "https:", hostname: "x.lu" }, undefined)).toBe(false);
  });
});

describe("web app manifest", () => {
  const manifest = JSON.parse(readFileSync(here("public/manifest.webmanifest"), "utf8"));

  it("names the app and opens standalone at the root", () => {
    expect(manifest.name).toBe("Civic Companion");
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest).toMatchObject({ start_url: "/", scope: "/", display: "standalone" });
    expect(manifest.theme_color).toBe("#1B2A4A");
    expect(manifest.background_color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("lists PNG icons that exist at the stated sizes, including a maskable one", () => {
    for (const icon of manifest.icons) {
      const png = readFileSync(here(`public/${icon.src}`));
      expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
      const size = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
      expect(size).toBe(icon.sizes);
    }
    const sizes = manifest.icons.filter((i: { purpose: string }) => i.purpose === "any").map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
  });
});

/** Runs sw.js against an in-memory Cache Storage and a network that can be switched off. */
function worker(shell: string[]) {
  const origin = "https://app.test";
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: string | { url: string }) => new URL(typeof r === "string" ? r : r.url, `${origin}/`).href;
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (r: string | Request, res: Response) => void store.set(key(r), res),
      match: async (r: string | { url: string }) => store.get(key(r))?.clone(),
      addAll: async (urls: string[]) => {
        for (const u of urls) store.set(key(u), new Response(`shell ${u}`));
      },
    };
  };
  const caches = {
    open: async (name: string) => open(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (r: { url: string }) => {
      for (const store of stores.values()) if (store.has(key(r))) return store.get(key(r))!.clone();
      return undefined;
    },
  };
  const net = { online: true, calls: [] as string[] };
  const fetchStub = async (r: { url: string; method: string }) => {
    net.calls.push(`${r.method} ${new URL(r.url).pathname}`);
    if (!net.online) throw new TypeError("offline");
    return new Response(`net ${new URL(r.url).pathname}`);
  };
  const handlers: Record<string, (e: unknown) => void> = {};
  const self = {
    location: new URL(`${origin}/sw.js`),
    registration: { scope: `${origin}/` },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
  };
  const source = readFileSync(here("sw.js"), "utf8").replace("__VERSION__", "test").replace("__SHELL__", JSON.stringify(shell));
  runInNewContext(source, { self, caches, fetch: fetchStub, URL, Response, Promise, console });

  const lifecycle = async (type: string) => {
    let done: Promise<unknown> = Promise.resolve();
    handlers[type]({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  };
  /** The response the worker gives, or null when it leaves the request to the browser. */
  const request = async (path: string, init: { method?: string; mode?: string } = {}) => {
    const req = { url: path.startsWith("http") ? path : origin + path, method: init.method ?? "GET", mode: init.mode ?? "cors" };
    let answer: Promise<Response> | null = null;
    handlers.fetch({ request: req, respondWith: (p: Promise<Response>) => (answer = p) });
    return answer ? (answer as Promise<Response>).then((r) => r.text()) : null;
  };
  return { stores, net, lifecycle, request };
}

describe("service worker", () => {
  const shell = ["./", "assets/index-abc.js", "manifest.webmanifest"];

  it("caches the shell on install and drops other versions' caches on activate, keeping the data", async () => {
    const w = worker(shell);
    w.stores.set("citizen-shell-old", new Map());
    w.stores.set("citizen-data-1", new Map());
    w.stores.set("someone-else", new Map());
    await w.lifecycle("install");
    await w.lifecycle("activate");
    expect([...w.stores.keys()].sort()).toEqual(["citizen-data-1", "citizen-shell-test", "someone-else"]);
    expect(w.stores.get("citizen-shell-test")!.size).toBe(3);
  });

  it("serves the shell from cache and the snapshot from the network, then the saved copy offline", async () => {
    const w = worker(shell);
    await w.lifecycle("install");
    expect(await w.request("/assets/index-abc.js")).toBe("shell assets/index-abc.js");
    expect(await w.request("/data/snapshot.json")).toBe("net /data/snapshot.json");
    w.net.online = false;
    expect(await w.request("/data/snapshot.json")).toBe("net /data/snapshot.json");
    expect(await w.request("/", { mode: "navigate" })).toBe("shell ./");
  });

  it("never handles /api calls, other origins or non-GET requests", async () => {
    const w = worker(shell);
    await w.lifecycle("install");
    expect(await w.request("/api/explain", { method: "POST" })).toBeNull();
    expect(await w.request("/api/anything")).toBeNull();
    expect(await w.request("/healthz")).toBeNull();
    expect(await w.request("https://fonts.googleapis.com/css2?family=Public+Sans")).toBeNull();
    expect(w.net.calls).toEqual([]);
    expect([...w.stores.values()].every((s) => [...s.keys()].every((k) => !k.includes("/api/")))).toBe(true);
  });
});
