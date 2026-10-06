import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createCompanionServer } from "../src/server.ts";
import { ITEM } from "./fixtures.ts";

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

/** A stand-in Desk: echoes what it received, as JSON, with a status the path asks for. */
function fakeDesk() {
  const seen: { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString() });
      if (req.url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (req.url?.startsWith("/slow")) return setTimeout(() => res.end("{}"), 200);
      if (req.url?.startsWith("/text")) {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("not json");
      }
      const status = Number(new URL(req.url ?? "/", "http://x").searchParams.get("status") ?? 200);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ echo: { method: req.method, url: req.url, auth: req.headers.authorization ?? null, forwarded: req.headers["x-forwarded-for"] ?? null, body: Buffer.concat(chunks).toString() } }));
    });
  });
  return { server, seen };
}

describe("/api/desk", () => {
  it("forwards method, path, query, auth header and body as they are, and the answer as it is", async () => {
    const desk = fakeDesk();
    const deskUrl = await listen(desk.server);
    const base = await listen(createCompanionServer({ provider: null, snapshot: { schema: "d2.docket.snapshot/2", generated_at: "2026-01-01T00:00:00Z", sources: [], items: [ITEM], meetings: [], errors: [] } as never, deskUrl, deskTimeoutMs: 100 }));
    const res = await fetch(`${base}/api/desk/ideas/abc/support?x=1&status=201`, { method: "POST", headers: { authorization: "Resident tok", "content-type": "application/json" }, body: '{"a":1}' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ echo: { method: "POST", url: "/ideas/abc/support?x=1&status=201", auth: "Resident tok", forwarded: "127.0.0.1", body: '{"a":1}' } });
    const get = await fetch(`${base}/api/desk/procedures`);
    expect((await get.json()).echo).toMatchObject({ method: "GET", url: "/procedures", auth: null, body: "" });
    expect((await fetch(`${base}/api/desk/x?status=404`)).status).toBe(404);
    expect((await fetch(`${base}/api/desk/x`, { method: "PUT" })).status).toBe(405);
    expect((await fetch(`${base}/api/desk/x`, { method: "POST", body: "x".repeat(70_000) })).status).toBe(413);
    // Desk down, slow or not JSON: 503, never a half answer.
    expect((await fetch(`${base}/api/desk/slow`)).status).toBe(503);
    expect((await fetch(`${base}/api/desk/text`)).status).toBe(503);
    expect((await (await fetch(`${base}/healthz`)).json()).desk).toBe(true);
    desk.server.close();
    expect((await fetch(`${base}/api/desk/procedures`)).status).toBe(503);
  });

  it("answers 503 when no desk is configured", async () => {
    const base = await listen(createCompanionServer({ provider: null, snapshot: { schema: "d2.docket.snapshot/2", generated_at: "2026-01-01T00:00:00Z", sources: [], items: [ITEM], meetings: [], errors: [] } as never }));
    expect((await fetch(`${base}/api/desk/procedures`)).status).toBe(503);
    expect((await (await fetch(`${base}/healthz`)).json()).desk).toBe(false);
  });
});
