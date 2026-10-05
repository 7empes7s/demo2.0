import { mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCompanionServer } from "../src/server.ts";
import { ESCH_CONSULTATION, ESCH_POINT, FakeProvider, ITEM } from "./fixtures.ts";

const snapshot = { schema: "d2.docket.snapshot/1", generated_at: "2026-02-01T00:00:00Z", items: [ITEM] };
const servers: { close: () => void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start(opts: Partial<Parameters<typeof createCompanionServer>[0]> = {}) {
  const server = createCompanionServer({ provider: null, snapshot, ...opts });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { base, post };
}

const explainAnswer = JSON.stringify({
  headline: "h",
  sections: [{ heading: "x", sentences: [{ text: "t", sources: [2], quote: "créer un réseau cyclable continu" }] }],
});

describe("companion server", () => {
  it("reports health and serves the snapshot without a model", async () => {
    const { base, post } = await start();
    expect(await (await fetch(base + "/healthz")).json()).toEqual({ ok: true, items: 1, companion: false });
    expect((await (await fetch(base + "/data/snapshot.json")).json()).items[0].id).toBe(ITEM.id);
    expect((await post("/api/explain", { item_id: ITEM.id })).status).toBe(503);
  });

  it("explains a known item, caches it, and rejects unknown items and bad input", async () => {
    const provider = new FakeProvider([explainAnswer]);
    const { post } = await start({ provider });
    const first = await post("/api/explain", { item_id: ITEM.id, lang: "fr", depth: "short" });
    expect(first.status).toBe(200);
    expect((await first.json()).sections[0].sentences[0].verified).toBe(true);
    expect((await post("/api/explain", { item_id: ITEM.id, lang: "fr", depth: "short" })).status).toBe(200);
    expect(provider.requests).toHaveLength(1);
    expect((await post("/api/explain", { item_id: "nope" })).status).toBe(404);
    expect((await post("/api/challenge", { item_id: ITEM.id, position: "maybe" })).status).toBe(400);
    expect((await post("/api/claim", { item_id: ITEM.id, claim: "  " })).status).toBe(400);
    expect((await fetch((await start()).base + "/api/explain")).status).toBe(405);
  });

  it("limits model calls per client", async () => {
    const answer = JSON.stringify({ grade: "yellow", explanation: "e", evidence: [] });
    const { post } = await start({ provider: new FakeProvider([answer, answer, answer]), ratePerMinute: 2 });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await post("/api/claim", { item_id: ITEM.id, claim: `c${i}` })).status);
    expect(codes).toEqual([200, 200, 429]);
  });

  it("ignores X-Forwarded-For unless told a proxy is in front", async () => {
    const answer = JSON.stringify({ grade: "yellow", explanation: "e", evidence: [] });
    const { base } = await start({ provider: new FakeProvider([answer, answer, answer]), ratePerMinute: 2 });
    const codes = [];
    for (let i = 0; i < 3; i++) {
      const res = await fetch(base + "/api/claim", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `9.9.9.${i}` },
        body: JSON.stringify({ item_id: ITEM.id, claim: `c${i}` }),
      });
      codes.push(res.status);
    }
    expect(codes).toEqual([200, 200, 429]);
  });

  it("does not retry a failed argument extraction in a loop", async () => {
    const provider = new FakeProvider(["not json"]);
    const { post } = await start({ provider });
    expect((await post("/api/arguments", { item_id: ITEM.id })).status).toBe(500);
    expect((await post("/api/arguments", { item_id: ITEM.id })).status).toBe(503);
    expect(provider.requests).toHaveLength(1);
  });

  it("accepts a snapshot/2 and serves /1 in the /2 shape", async () => {
    const v2 = {
      schema: "d2.docket.snapshot/2",
      generated_at: "2026-10-05T00:00:00Z",
      sources: [{ id: "chd" }, { id: "esch" }],
      meetings: [],
      items: [ITEM, ESCH_POINT, ESCH_CONSULTATION],
      errors: [],
    };
    const two = await start({ snapshot: v2 });
    expect(await (await fetch(two.base + "/healthz")).json()).toEqual({ ok: true, items: 3, companion: false });
    expect((await (await fetch(two.base + "/data/snapshot.json")).json()).items[1].votes.counts).toEqual({ Oui: 11, Non: 8 });

    const one = await start({ snapshot: { ...snapshot, source: { name: "Chambre des Députés" } } as typeof snapshot });
    const served = await (await fetch(one.base + "/data/snapshot.json")).json();
    expect(served.sources).toEqual([{ id: "chd", name: "Chambre des Députés" }]);
    expect(served.items[0].id).toBe(ITEM.id);
  });

  it("refuses a snapshot schema it does not know", () => {
    expect(() => createCompanionServer({ provider: null, snapshot: { ...snapshot, schema: "d2.docket.snapshot/9" } })).toThrow(/unsupported/);
  });

  it("serves the snapshot with an ETag", async () => {
    const { base } = await start();
    const first = await fetch(base + "/data/snapshot.json");
    const tag = first.headers.get("etag");
    expect(tag).toBeTruthy();
    expect((await fetch(base + "/data/snapshot.json", { headers: { "if-none-match": tag ?? "" } })).status).toBe(304);
  });

  it("serves the app and never files outside it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "d2-static-"));
    await writeFile(join(dir, "index.html"), "<p>app</p>");
    const { base } = await start({ staticDir: dir });
    expect(await (await fetch(base + "/")).text()).toBe("<p>app</p>");
    expect(await (await fetch(base + "/bill/123")).text()).toBe("<p>app</p>");
    const escape = await fetch(base + "/%2e%2e/%2e%2e/etc/passwd");
    expect(await escape.text()).not.toContain("root:");
    expect((await fetch(base + "/%E0%A4%A")).status).toBe(400);
  });

  it("serves the manifest and service worker with their types, and never lets them go stale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "d2-static-"));
    await writeFile(join(dir, "index.html"), "<p>app</p>");
    await writeFile(join(dir, "sw.js"), "self.addEventListener('fetch', () => {});");
    await writeFile(join(dir, "manifest.webmanifest"), '{"name":"Civic Companion"}');
    await writeFile(join(dir, "icon-192.png"), "png");
    const { base } = await start({ staticDir: dir });

    const sw = await fetch(base + "/sw.js");
    expect(sw.headers.get("content-type")).toBe("text/javascript");
    expect(sw.headers.get("cache-control")).toBe("no-cache");
    const manifest = await fetch(base + "/manifest.webmanifest");
    expect(manifest.headers.get("content-type")).toBe("application/manifest+json");
    expect(manifest.headers.get("cache-control")).toBe("no-cache");
    expect((await manifest.json()).name).toBe("Civic Companion");
    expect((await fetch(base + "/")).headers.get("cache-control")).toBe("no-cache");
    const icon = await fetch(base + "/icon-192.png");
    expect(icon.headers.get("content-type")).toBe("image/png");
    expect(icon.headers.get("cache-control")).toBeNull();
  });
});
