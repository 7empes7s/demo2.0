import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { ideaProblems, ideasPageProblems, queueProblems, readQueue } from "../src/ideas.ts";
import { gradeProblems } from "../src/factcheck.ts";
import { createCompanionServer } from "../src/server.ts";
import { ITEM } from "./fixtures.ts";

/** Synthetic ideas, shaped as Agora's GET /queue serves them. */
const IDEA = {
  id: "01JQ8Z6Y2V3W4X5Y6Z7A8B9C0D",
  jurisdiction_id: "lu",
  topic_ids: ["transport.cycling"],
  title: { en: "Safe cycle lanes on national roads", fr: "Des pistes cyclables sûres sur les routes nationales" },
  text: { en: "Separate cycle lanes on every national road that crosses a town." },
  proposer_nym: "nym-abcdefghijklmnopqrstuvwxyz",
  created_at: "2026-10-01T09:00:00.000000Z",
  scope_tier: "national",
  charter_version: "0.1.0",
  upvote_count: 12,
};
const HIDDEN = {
  ...IDEA,
  id: "01JQ8Z6Y2V3W4X5Y6Z7A8B9C0E",
  jurisdiction_id: "lu-commune-esch-sur-alzette",
  topic_ids: [],
  title: { lb: "Méi Beem an der Uelzechtstrooss" },
  text: { lb: "Beem pflanzen." },
  proposer_nym: "nym-zyxwvutsrqponmlkjihgfedcba",
  created_at: "2026-10-06T08:00:00.000000Z",
  scope_tier: "local",
  upvote_count: null,
};
const QUEUE = { charter_version: "0.1.0", ideas: [IDEA, HIDDEN] };

const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((c) => c()));

async function listen(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A stand-in for Agora that records every request it gets. */
async function fakeAgora(answer: (req: IncomingMessage, res: ServerResponse) => void) {
  const seen: { method?: string; path?: string }[] = [];
  const server = createServer((req, res) => {
    seen.push({ method: req.method, path: req.url });
    answer(req, res);
  });
  return { url: await listen(server), seen };
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

/** A port nothing listens on. */
async function deadUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((r) => server.close(() => r()));
  return `http://127.0.0.1:${port}`;
}

const snapshot = { schema: "d2.docket.snapshot/1", generated_at: "2026-02-01T00:00:00Z", items: [ITEM] };

async function companion(agoraUrl: string | undefined, extra: Record<string, unknown> = {}) {
  const base = await listen(createCompanionServer({ provider: null, snapshot, agoraUrl, ...extra }));
  return (path = "/api/ideas", init?: RequestInit) => fetch(base + path, init);
}

const quiet = () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => log.mockRestore());
  return log;
};

const { proposer_nym: _a, ...PUBLIC_IDEA } = IDEA;
const { proposer_nym: _b, ...PUBLIC_HIDDEN } = HIDDEN;

describe("idea schema check", () => {
  it("accepts ideas and a queue that match the spec", () => {
    expect(ideaProblems(IDEA)).toEqual([]);
    expect(ideaProblems(HIDDEN)).toEqual([]);
    expect(queueProblems(QUEUE)).toEqual([]);
    expect(queueProblems({ charter_version: "0.1.0", ideas: [] })).toEqual([]);
    for (const created_at of ["2024-02-29T00:00:00Z", "2026-12-31T23:59:59.999999+14:00", "0099-01-01T00:00:00-23:59"]) {
      expect(ideaProblems({ ...IDEA, created_at }), created_at).toEqual([]);
    }
    expect(ideaProblems({ ...IDEA, upvote_count: Number.MAX_SAFE_INTEGER })).toEqual([]);
  });

  it("rejects anything spec/schemas/idea.schema.json does not allow", () => {
    const bad = [
      null,
      { ...IDEA, id: "not-a-ulid" },
      { ...IDEA, scope_tier: "galactic" },
      { ...IDEA, upvote_count: -1 },
      { ...IDEA, upvote_count: 1.5 },
      { ...IDEA, upvote_count: "12" },
      { ...IDEA, title: {} },
      { ...IDEA, title: { xx: "Hi" } },
      { ...IDEA, title: { en: "" } },
      { ...IDEA, text: "plain" },
      { ...IDEA, topic_ids: ["Not A Topic"] },
      { ...IDEA, topic_ids: ["a", "a"] },
      { ...IDEA, topic_ids: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] },
      { ...IDEA, created_at: "yesterday" },
      { ...IDEA, created_at: "2026-13-45T99:00:00Z" },
      { ...IDEA, created_at: "2026-02-30T00:00:00Z" },
      { ...IDEA, created_at: "2025-02-29T00:00:00Z" },
      { ...IDEA, created_at: "2026-04-31T00:00:00Z" },
      { ...IDEA, created_at: "2026-10-06T24:00:00Z" },
      { ...IDEA, created_at: "2026-10-06T09:60:00Z" },
      { ...IDEA, created_at: "2026-10-06T09:00:00+24:00" },
      { ...IDEA, created_at: "2026-10-06T09:00:00+02:60" },
      { ...IDEA, upvote_count: 1e300 },
      { ...IDEA, upvote_count: 2 ** 53 },
      { ...IDEA, charter_version: "" },
      { ...IDEA, extra: 1 },
      { ...IDEA, proposer_nym: undefined },
      { ...IDEA, upvote_count: undefined },
    ];
    for (const value of bad) expect(ideaProblems(JSON.parse(JSON.stringify(value) ?? "null")), JSON.stringify(value)).not.toEqual([]);
  });

  it("rejects a queue of the wrong shape or longer than asked", () => {
    for (const value of [[IDEA], { ideas: [IDEA] }, { charter_version: "0.1.0" }, { ...QUEUE, extra: 1 }, { charter_version: "0.1.0", ideas: [{ ...IDEA, id: 1 }] }]) {
      expect(queueProblems(value), JSON.stringify(value)).not.toEqual([]);
    }
    expect(queueProblems(QUEUE, 1)).toContain("queue.ideas: more than 1 items");
  });

  it("refuses a page that lists the same idea twice", () => {
    expect(queueProblems({ ...QUEUE, ideas: [IDEA, HIDDEN, { ...IDEA, upvote_count: 3 }] })).toEqual(["queue.ideas[2].id: appears twice"]);
    expect(ideasPageProblems({ ...QUEUE, ideas: [PUBLIC_IDEA, PUBLIC_IDEA] })).toEqual(["ideas.ideas[1].id: appears twice"]);
  });

  it("never accepts a pseudonym in what the app is sent", () => {
    expect(ideasPageProblems({ charter_version: "0.1.0", ideas: [PUBLIC_IDEA, PUBLIC_HIDDEN] })).toEqual([]);
    expect(ideasPageProblems(QUEUE)).toContain("ideas.ideas[0].proposer_nym: not allowed");
  });

  it("still checks grades as before (shared checker)", () => {
    expect(gradeProblems({ claim_id: "c", checker_id: "x", grade: "green", evidence: [{ url: "https://x.lu/", excerpt: "e" }], model_version: "m" })).toEqual([]);
  });
});

describe("readQueue", () => {
  it("asks Agora for the queue and drops proposer pseudonyms", async () => {
    const agora = await fakeAgora((_, res) => json(res, 200, QUEUE));
    const page = await readQueue(agora.url + "/", { jurisdictions: ["lu", "lu-commune-esch-sur-alzette"], limit: 10 });
    expect(page).toEqual({ charter_version: "0.1.0", ideas: [PUBLIC_IDEA, PUBLIC_HIDDEN] });
    expect(JSON.stringify(page)).not.toContain("nym-");
    expect(agora.seen).toEqual([{ method: "GET", path: "/queue?jurisdiction=lu&jurisdiction=lu-commune-esch-sur-alzette&limit=10" }]);
  });

  it("times out on a body that stalls after the headers", async () => {
    const agora = await fakeAgora((_, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"charter_version":');
    });
    await expect(readQueue(agora.url, { limit: 10 }, { timeoutMs: 100 })).rejects.toThrow(/timed out while sending/);
  });
});

describe("GET /api/ideas", () => {
  it("returns the queue in Agora's order, without pseudonyms, with no model and no key", async () => {
    const agora = await fakeAgora((_, res) => json(res, 200, QUEUE));
    const res = await (await companion(agora.url))();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ charter_version: "0.1.0", ideas: [PUBLIC_IDEA, PUBLIC_HIDDEN] });
    expect(body.ideas[1].upvote_count).toBeNull();
    expect(JSON.stringify(body)).not.toContain("proposer_nym");
    expect(agora.seen).toEqual([{ method: "GET", path: "/queue?limit=50" }]);
  });

  it("returns an empty queue as it is", async () => {
    const agora = await fakeAgora((_, res) => json(res, 200, { charter_version: "0.1.0", ideas: [] }));
    const res = await (await companion(agora.url))();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ charter_version: "0.1.0", ideas: [] });
  });

  it("passes valid jurisdictions and limit on", async () => {
    const agora = await fakeAgora((_, res) => json(res, 200, QUEUE));
    const get = await companion(agora.url);
    expect((await get("/api/ideas?jurisdiction=lu&jurisdiction=lu-commune-esch-sur-alzette&jurisdiction=lu&limit=100")).status).toBe(200);
    expect(agora.seen[0].path).toBe("/queue?jurisdiction=lu&jurisdiction=lu-commune-esch-sur-alzette&limit=100");
  });

  it("refuses a bad query before calling Agora", async () => {
    const agora = await fakeAgora((_, res) => json(res, 200, QUEUE));
    const get = await companion(agora.url);
    const many = Array.from({ length: 21 }, (_, i) => `jurisdiction=j${i}`).join("&");
    for (const query of ["limit=0", "limit=101", "limit=-1", "limit=1.5", "limit=abc", "limit=", "limit=01", "limit=5&limit=6", "limit=1e2", "jurisdiction=", "jurisdiction=LU", "jurisdiction=lu/../x", "jurisdiction=lu%00", `jurisdiction=${"a".repeat(65)}`, many, "participant=abc", "sort=new"]) {
      const res = await get(`/api/ideas?${query}`);
      expect(res.status, query).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    }
    expect(agora.seen).toHaveLength(0);
  });

  it("never forwards posting or supporting: every other method is 405, and Agora sees nothing", async () => {
    const agora = await fakeAgora((_, res) => json(res, 201, IDEA));
    const call = await companion(agora.url);
    const body = JSON.stringify({ participant: "p".repeat(20), jurisdiction_id: "lu", title: { en: "x" }, text: { en: "y" } });
    const paths = ["/api/ideas", `/api/ideas/${IDEA.id}`, `/api/ideas/${IDEA.id}/upvote`, "/api/ideas/upvote"];
    for (const path of paths) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const res = await call(path, { method, headers: { "content-type": "application/json" }, body });
        expect(res.status, `${method} ${path}`).toBe(405);
        expect(res.headers.get("allow")).toBe("GET");
        expect((await res.json()).error).toMatch(/not open yet/);
      }
    }
    expect(agora.seen).toHaveLength(0);
  });

  it("serves only the list: no other path under /api/ideas", async () => {
    const agora = await fakeAgora((_, res) => json(res, 200, IDEA));
    const get = await companion(agora.url);
    for (const path of [`/api/ideas/${IDEA.id}`, "/api/ideas/", "/api/ideas/queue"]) expect((await get(path)).status, path).toBe(404);
    expect(agora.seen).toHaveLength(0);
  });

  it("refuses a schema-invalid answer with 502 and shows nothing of it", async () => {
    const log = quiet();
    const answers = [
      { ...QUEUE, ideas: [{ ...IDEA, scope_tier: "galactic" }] },
      { ...QUEUE, ideas: [{ ...IDEA, upvote_count: -3 }] },
      { ...QUEUE, ideas: [{ ...IDEA, extra: "x" }] },
      { ...QUEUE, ideas: [{ ...IDEA, proposer_nym: undefined }] },
      { ideas: [IDEA] },
      [IDEA],
      { charter_version: "0.1.0", ideas: Array.from({ length: 51 }, () => IDEA) },
      { ...QUEUE, ideas: [IDEA, HIDDEN, IDEA] },
      "<html>oops</html>",
    ];
    for (const answer of answers) {
      const agora = await fakeAgora((_, res) => json(res, 200, answer));
      const res = await (await companion(agora.url))();
      expect(res.status, JSON.stringify(answer).slice(0, 80)).toBe(502);
      const body = await res.json();
      expect(body).toEqual({ error: "the ideas list gave an answer that could not be read" });
    }
    expect(log.mock.calls.map((c) => c[0])[0]).toMatch(/^ideas: agora answered an invalid queue: queue\.ideas\[0\]\.scope_tier/);
  });

  it("answers 503 when Agora is unreachable, slow, failing or not configured", async () => {
    const log = quiet();
    expect((await (await companion(await deadUrl()))()).status).toBe(503);

    const slow = await fakeAgora(() => {});
    const started = Date.now();
    expect((await (await companion(slow.url, { agoraTimeoutMs: 100 }))()).status).toBe(503);
    expect(Date.now() - started).toBeLessThan(2_000);

    const stalls = await fakeAgora((_, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write("{");
    });
    expect((await (await companion(stalls.url, { agoraTimeoutMs: 100 }))()).status).toBe(503);

    for (const status of [400, 404, 500, 503]) {
      const failing = await fakeAgora((_, res) => json(res, status, { error: "x", code: "x" }));
      const res = await (await companion(failing.url))();
      expect(res.status, String(status)).toBe(503);
      expect(await res.json()).toEqual({ error: "the ideas list is unavailable" });
    }

    const none = await (await companion(undefined))();
    expect(none.status).toBe(503);
    expect((await none.json()).error).toMatch(/not configured/);
    expect(log.mock.calls.map((c) => c[0])).toContain("ideas: agora timed out while sending its answer");
  });

  it("reads Agora once per query in 15 s, however many requests arrive, and never keeps a failure", async () => {
    let fail = true;
    const agora = await fakeAgora((_, res) => setTimeout(() => (fail ? json(res, 500, {}) : json(res, 200, QUEUE)), 50));
    const get = await companion(agora.url);
    quiet();
    expect((await get()).status).toBe(503);
    fail = false;
    expect((await get()).status).toBe(200);
    const statuses = await Promise.all(Array.from({ length: 5 }, () => get("/api/ideas?jurisdiction=lu&jurisdiction=lu-commune-esch-sur-alzette")));
    expect(statuses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await get("/api/ideas?jurisdiction=lu-commune-esch-sur-alzette&jurisdiction=lu&limit=50")).status).toBe(200);
    expect(agora.seen.map((s) => s.path)).toEqual(["/queue?limit=50", "/queue?limit=50", "/queue?jurisdiction=lu&jurisdiction=lu-commune-esch-sur-alzette&limit=50"]);
  });

  it("asks Agora again once the cached answer is older than the cache time", async () => {
    const agora = await fakeAgora((_, res) => json(res, 200, QUEUE));
    const get = await companion(agora.url, { ideasCacheMs: 50 });
    await get();
    await get();
    expect(agora.seen).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 80));
    await get();
    expect(agora.seen).toHaveLength(2);
  });

  it("is rate limited per client, in its own bucket apart from claim checks", async () => {
    const agora = await fakeAgora((_, res) => json(res, 200, QUEUE));
    const prov = await fakeAgora((_, res) => json(res, 404, { code: "no_record" }));
    const call = await companion(agora.url, { ideasPerMinute: 2, factcheckPerMinute: 1, provenanceUrl: prov.url });
    const check = () => call("/api/factcheck", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x" }) });
    const codes = [(await check()).status];
    for (let i = 0; i < 3; i++) codes.push((await call()).status);
    codes.push((await check()).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });
});

describe("GET /healthz with Agora", () => {
  const health = async (agoraUrl: string | undefined) => {
    const base = await listen(createCompanionServer({ provider: null, snapshot, agoraUrl }));
    return async () => {
      const res = await fetch(base + "/healthz");
      expect(res.status).toBe(200);
      return ((await res.json()) as { ok: unknown; agora: unknown });
    };
  };

  it("reports whether Agora is up, caches it, and never fails on it", async () => {
    let calls = 0;
    const up = createServer((req, res) => {
      calls++;
      json(res, req.url === "/healthz" ? 200 : 404, { ok: true, ideas: 0 });
    });
    const check = await health(await listen(up));
    expect(await check()).toEqual(expect.objectContaining({ ok: true, agora: true }));
    expect((await check()).agora).toBe(true);
    expect(calls).toBe(1);

    expect(await (await health(await deadUrl()))()).toEqual(expect.objectContaining({ ok: true, agora: false }));
    expect((await (await health(undefined))()).agora).toBe(false);
    const hung = createServer(() => {});
    const started = Date.now();
    expect((await (await health(await listen(hung)))()).agora).toBe(false);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("probes Agora and Provenance at the same time: both hung costs one 1 s wait, not two", async () => {
    const hung = await listen(createServer(() => {}));
    const base = await listen(createCompanionServer({ provider: null, snapshot, agoraUrl: hung, provenanceUrl: hung }));
    const started = Date.now();
    const body = (await (await fetch(base + "/healthz")).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, agora: false, provenance: false });
    expect(Date.now() - started).toBeLessThan(1_700);
  });
});
