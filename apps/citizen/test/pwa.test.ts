import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

type Net = "online" | "offline" | "502" | "hang";
type Route = (path: string) => Response | undefined;

/**
 * Runs a service worker source against an in-memory Cache Storage and a network that can be
 * switched off, made to fail with 5xx, or made to hang. `route` overrides what the network returns.
 */
function worker(source: string, route: Route = () => undefined) {
  const origin = "https://app.test";
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: string | { url: string }) => new URL(typeof r === "string" ? r : r.url, `${origin}/`).href;
  const faults = { putFails: false, installRequests: [] as { url: string; cache?: string }[] };
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (r: string | { url: string }, res: Response) => {
        if (faults.putFails) throw new DOMException("quota", "QuotaExceededError");
        // Like the real Cache API: a partial response cannot be stored.
        if (res.status === 206) throw new TypeError("206 cannot be cached");
        store.set(key(r), res);
      },
      match: async (r: string | { url: string }) => store.get(key(r))?.clone(),
      addAll: async (reqs: (string | { url: string; cache?: string })[]) => {
        for (const r of reqs) {
          faults.installRequests.push(typeof r === "string" ? { url: r } : { url: r.url, cache: r.cache });
          store.set(key(r), new Response(`shell ${new URL(key(r)).pathname}`, { headers: { "content-type": "text/html" } }));
        }
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
  const net = { mode: "online" as Net, calls: [] as string[] };
  const fetchStub = (r: { url: string; method: string }) => {
    const path = new URL(r.url).pathname;
    net.calls.push(`${r.method} ${path}`);
    if (net.mode === "offline") return Promise.reject(new TypeError("offline"));
    if (net.mode === "502") return Promise.resolve(new Response("Bad gateway", { status: 502 }));
    if (net.mode === "hang") return new Promise<Response>(() => {});
    return Promise.resolve(route(path) ?? new Response(`net ${path}`, { headers: { "content-type": "text/html" } }));
  };
  const handlers: Record<string, (e: unknown) => void> = {};
  const self = {
    location: new URL(`${origin}/sw.js`),
    registration: { scope: `${origin}/` },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
  };
  // Timers run 100x faster so the 4 s network timeout takes 40 ms here.
  const fastTimeout = (fn: () => void, ms: number) => setTimeout(fn, ms / 100);
  runInNewContext(source, { self, caches, fetch: fetchStub, URL, Request, Response, Promise, console, DOMException, setTimeout: fastTimeout, clearTimeout });

  const lifecycle = async (type: string) => {
    let done: Promise<unknown> = Promise.resolve();
    handlers[type]({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  };
  /** The response text the worker gives, "REJECT" when it fails, or null when it leaves the request alone. */
  const request = async (path: string, init: { method?: string; mode?: string } = {}) => {
    const req = { url: path.startsWith("http") ? path : origin + path, method: init.method ?? "GET", mode: init.mode ?? "cors" };
    let answer: Promise<Response> | null = null;
    const pending: Promise<unknown>[] = [];
    handlers.fetch({ request: req, respondWith: (p: Promise<Response>) => (answer = p), waitUntil: (p: Promise<unknown>) => pending.push(p) });
    if (!answer) return null;
    let text: string;
    try {
      const res = await (answer as Promise<Response>);
      text = `${res.status} ${await res.text()}`;
    } catch {
      text = "REJECT";
    }
    // Background cache writes must settle (and never reject) before the next step.
    await Promise.all(pending);
    return text;
  };
  const cached = (cache: string, path: string) => stores.get(cache)?.get(`${origin}${path}`);
  return { stores, net, faults, lifecycle, request, cached };
}

const template = (shell: string[]) => readFileSync(here("sw.js"), "utf8").replace("__VERSION__", "test").replace("__SHELL__", JSON.stringify(shell));
const json = (body: string) => new Response(body, { headers: { "content-type": "application/json" } });

describe("service worker", () => {
  const shell = ["./", "assets/index-abc.js", "manifest.webmanifest"];

  it("caches the shell on install, bypassing the HTTP cache, and drops other versions' caches on activate, keeping the data", async () => {
    const w = worker(template(shell));
    w.stores.set("citizen-shell-old", new Map());
    w.stores.set("citizen-data-1", new Map());
    w.stores.set("someone-else", new Map());
    await w.lifecycle("install");
    await w.lifecycle("activate");
    expect([...w.stores.keys()].sort()).toEqual(["citizen-data-1", "citizen-shell-test", "someone-else"]);
    expect(w.stores.get("citizen-shell-test")!.size).toBe(3);
    expect(w.faults.installRequests.map((r) => r.cache)).toEqual(["reload", "reload", "reload"]);
  });

  it("serves the shell from cache and the snapshot from the network, then the saved copy offline", async () => {
    const w = worker(template(shell));
    await w.lifecycle("install");
    expect(await w.request("/assets/index-abc.js")).toBe("200 shell /assets/index-abc.js");
    expect(await w.request("/data/snapshot.json")).toBe("200 net /data/snapshot.json");
    w.net.mode = "offline";
    expect(await w.request("/data/snapshot.json")).toBe("200 net /data/snapshot.json");
    expect(await w.request("/", { mode: "navigate" })).toBe("200 shell /");
  });

  it("never handles /api calls, other origins or non-GET requests", async () => {
    const w = worker(template(shell));
    await w.lifecycle("install");
    expect(await w.request("/api/explain", { method: "POST" })).toBeNull();
    expect(await w.request("/api/anything")).toBeNull();
    expect(await w.request("/healthz")).toBeNull();
    expect(await w.request("https://fonts.googleapis.com/css2?family=Public+Sans")).toBeNull();
    expect(w.net.calls).toEqual([]);
    expect([...w.stores.values()].every((s) => [...s.keys()].every((k) => !k.includes("/api/")))).toBe(true);
  });

  it("never lets a page other than the app (/healthz, JSON, an icon) become the offline app", async () => {
    const w = worker(
      template(shell),
      (path) => (path === "/healthz" ? json('{"ok":true}') : path === "/" ? new Response("<html>fresh app</html>", { headers: { "content-type": "text/html" } }) : undefined),
    );
    await w.lifecycle("install");
    expect(await w.request("/healthz", { mode: "navigate" })).toBe('200 {"ok":true}');
    expect(await w.request("/icon-512.png", { mode: "navigate" })).toBe("200 net /icon-512.png");
    w.net.mode = "offline";
    expect(await w.request("/", { mode: "navigate" })).toBe("200 shell /");
    // An online load of the app itself does refresh the saved page.
    w.net.mode = "online";
    expect(await w.request("/", { mode: "navigate" })).toBe("200 <html>fresh app</html>");
    w.net.mode = "offline";
    expect(await w.request("/healthz", { mode: "navigate" })).toBe("200 <html>fresh app</html>");
  });

  it("does not save /index.html served as something other than HTML", async () => {
    const w = worker(template(shell), (path) => (path === "/index.html" ? json("{}") : undefined));
    await w.lifecycle("install");
    expect(await w.request("/index.html", { mode: "navigate" })).toBe("200 {}");
    w.net.mode = "offline";
    expect(await w.request("/", { mode: "navigate" })).toBe("200 shell /");
  });

  it("still returns a good network response when saving it fails, for the page and the snapshot", async () => {
    const w = worker(template(shell));
    await w.lifecycle("install");
    w.faults.putFails = true;
    expect(await w.request("/data/snapshot.json")).toBe("200 net /data/snapshot.json");
    expect(await w.request("/", { mode: "navigate" })).toBe("200 net /");
    expect(w.cached("citizen-data-1", "/data/snapshot.json")).toBeUndefined();
  });

  it("passes a 206 partial response through without saving it", async () => {
    const w = worker(template(shell), (path) => (path === "/data/snapshot.json" ? new Response("part", { status: 206 }) : undefined));
    await w.lifecycle("install");
    expect(await w.request("/data/snapshot.json")).toBe("206 part");
    expect(w.cached("citizen-data-1", "/data/snapshot.json")).toBeUndefined();
  });

  it("uses the saved copy when the server answers 5xx, and never saves the error", async () => {
    const w = worker(template(shell));
    await w.lifecycle("install");
    expect(await w.request("/data/snapshot.json")).toBe("200 net /data/snapshot.json");
    w.net.mode = "502";
    expect(await w.request("/data/snapshot.json")).toBe("200 net /data/snapshot.json");
    expect(await w.request("/", { mode: "navigate" })).toBe("200 shell /");
    expect(await w.cached("citizen-data-1", "/data/snapshot.json")!.clone().text()).toBe("net /data/snapshot.json");
    expect(await w.cached("citizen-shell-test", "/")!.clone().text()).toBe("shell /");
  });

  it("passes a 5xx through when there is no saved copy, and does not save it", async () => {
    const w = worker(template(shell));
    w.net.mode = "502";
    expect(await w.request("/data/snapshot.json")).toBe("502 Bad gateway");
    expect(w.cached("citizen-data-1", "/data/snapshot.json")).toBeUndefined();
  });

  it("does not save other error responses either", async () => {
    const w = worker(template(shell), (path) => (path === "/data/snapshot.json" ? new Response("nope", { status: 404 }) : undefined));
    expect(await w.request("/data/snapshot.json")).toBe("404 nope");
    expect(w.cached("citizen-data-1", "/data/snapshot.json")).toBeUndefined();
  });

  it("falls back to the saved copy when the network hangs, but waits when there is none", async () => {
    const w = worker(template(shell));
    await w.lifecycle("install");
    w.net.mode = "hang";
    expect(await w.request("/", { mode: "navigate" })).toBe("200 shell /");
    const noCopy = w.request("/data/snapshot.json");
    const winner = await Promise.race([noCopy, new Promise((r) => setTimeout(() => r("still waiting"), 200))]);
    expect(winner).toBe("still waiting");
  });

  it("caches hashed assets the first time they are fetched, so a newer page still opens offline", async () => {
    const w = worker(template(shell));
    await w.lifecycle("install");
    expect(await w.request("/assets/index-NEW.js")).toBe("200 net /assets/index-NEW.js");
    w.net.mode = "offline";
    expect(await w.request("/assets/index-NEW.js")).toBe("200 net /assets/index-NEW.js");
    expect(await w.request("/assets/missing.css")).toBe("REJECT");
    // Only same-origin assets, and nothing outside /assets/ that is not in the shell.
    w.net.mode = "online";
    expect(await w.request("/other.js")).toBeNull();
    expect(await w.request("https://cdn.example/assets/x.js")).toBeNull();
  });
});

const root = fileURLToPath(new URL("..", import.meta.url));
const builds: string[] = [];
async function buildTo(mode: "production" | "single", extra: { publicDir?: string } = {}) {
  const outDir = mkdtempSync(join(tmpdir(), `citizen-${mode}-`));
  builds.push(outDir);
  // Vitest sets NODE_ENV=test, which would make this a development build (no worker registration).
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await build({ root, mode, logLevel: "silent", configFile: join(root, "vite.config.ts"), build: { outDir, emptyOutDir: true }, ...extra });
  } finally {
    process.env.NODE_ENV = env;
  }
  return outDir;
}
const filesIn = (dir: string, prefix = ""): string[] =>
  readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(dir, `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));
afterAll(() => builds.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("built service worker (dist/sw.js)", () => {
  let dist = "";
  let source = "";
  beforeAll(async () => {
    dist = await buildTo("production");
    source = readFileSync(join(dist, "sw.js"), "utf8");
  }, 120_000);

  it("has its placeholders filled in, and every precached file exists in the build", () => {
    expect(source).not.toContain("__VERSION__");
    expect(source).not.toContain("__SHELL__");
    const shell = JSON.parse(/const SHELL = (\[.*?\]);/.exec(source)![1]) as string[];
    expect(shell).toContain("./");
    for (const path of shell) expect(existsSync(join(dist, path === "./" ? "index.html" : path)), path).toBe(true);
    // Every file the build emitted (other than the worker and the page itself) is precached.
    const emitted = filesIn(dist).filter((f) => f !== "sw.js" && f !== "index.html");
    expect([...emitted].sort()).toEqual(shell.filter((p) => p !== "./").sort());
    expect(/const SHELL_CACHE = `citizen-shell-\$\{VERSION\}`/.test(source)).toBe(true);
    expect(/const VERSION = "[0-9a-f]{12}";/.test(source)).toBe(true);
  });

  it("links the manifest and icons with absolute URLs", () => {
    const html = readFileSync(join(dist, "index.html"), "utf8");
    expect(html).toContain('href="/manifest.webmanifest"');
    expect(html).toContain('href="/apple-touch-icon.png"');
    expect(html).toContain('href="/icon-192.png"');
    const js = filesIn(dist).filter((f) => f.endsWith(".js") && f !== "sw.js").map((f) => readFileSync(join(dist, f), "utf8")).join("");
    expect(js).toContain("serviceWorker");
    expect(js).toContain("`/sw.js`");
  });

  it("keeps the offline app when /healthz is opened, survives a 502 and a failed cache write", async () => {
    const w = worker(source, (path) => (path === "/healthz" ? json('{"ok":true}') : undefined));
    await w.lifecycle("install");
    await w.lifecycle("activate");
    expect(await w.request("/healthz", { mode: "navigate" })).toBe('200 {"ok":true}');
    w.net.mode = "offline";
    expect(await w.request("/", { mode: "navigate" })).toBe("200 shell /");
    w.net.mode = "online";
    expect(await w.request("/data/snapshot.json")).toBe("200 net /data/snapshot.json");
    w.net.mode = "502";
    expect(await w.request("/", { mode: "navigate" })).toBe("200 shell /");
    expect(await w.request("/data/snapshot.json")).toBe("200 net /data/snapshot.json");
    w.net.mode = "online";
    w.stores.get("citizen-data-1")!.clear();
    w.faults.putFails = true;
    expect(await w.request("/data/snapshot.json")).toBe("200 net /data/snapshot.json");
  });
});

describe("single-file build", () => {
  it("has no service worker and no manifest", async () => {
    const out = await buildTo("single");
    expect(filesIn(out)).toEqual(["index.html"]);
    const html = readFileSync(join(out, "index.html"), "utf8");
    for (const word of ["serviceWorker", "sw.js", "manifest", "webmanifest", "apple-touch-icon", "theme-color", "icon-192"]) {
      expect(html, word).not.toContain(word);
    }
  }, 120_000);
});

describe("cache version", () => {
  const version = (dir: string) => /const VERSION = "([0-9a-f]{12})";/.exec(readFileSync(join(dir, "sw.js"), "utf8"))![1];

  it("changes when only the bytes of a public/ file change", async () => {
    const pub = mkdtempSync(join(tmpdir(), "citizen-public-"));
    builds.push(pub);
    cpSync(join(root, "public"), pub, { recursive: true });
    const before = version(await buildTo("production", { publicDir: pub }));
    expect(version(await buildTo("production", { publicDir: pub }))).toBe(before);
    const manifest = join(pub, "manifest.webmanifest");
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace("#1B2A4A", "#1B2A4B"));
    expect(version(await buildTo("production", { publicDir: pub }))).not.toBe(before);
  }, 180_000);
});
