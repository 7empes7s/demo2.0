import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { HttpCommons } from "../src/commons.ts";
import { CheckerInvalid, CheckerUnavailable, gradeClaim } from "../src/factcheck.ts";
import { AgoraInvalid, AgoraUnavailable, readQueue } from "../src/ideas.ts";
import { createCompanionServer } from "../src/server.ts";
import { MAX_UPSTREAM_BYTES, readJson, TooLarge } from "../src/upstream.ts";
import { ITEM } from "./fixtures.ts";

const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((c) => c()));

async function listen(handler: Server | ((req: IncomingMessage, res: ServerResponse) => void)): Promise<string> {
  const server: Server = typeof handler === "function" ? createServer(handler) : handler;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const MiB = 1024 * 1024;
const SNAPSHOT = { schema: "d2.docket.snapshot/1", generated_at: "x", items: [ITEM] };

/**
 * A service that answers 200 with an endless JSON array, 1 MiB per chunk, up to 64 MiB, and no
 * content-length. `sent()` is how many bytes it managed to write before the reader hung up.
 */
async function flood() {
  let sent = 0;
  let closed!: () => void;
  const done = new Promise<void>((r) => (closed = r));
  const chunk = Buffer.alloc(MiB, "1,");
  const url = await listen((_, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.on("close", closed);
    const pump = () => {
      while (!res.destroyed && sent < 64 * MiB) {
        sent += chunk.length;
        if (!res.write(chunk)) return void res.once("drain", pump);
      }
      res.end();
    };
    res.write("[");
    pump();
  });
  return { url, sent: () => sent, closed: done };
}

/** A service that redirects every request to `to`. */
const redirecting = (to: string) =>
  listen((req, res) => {
    res.writeHead(302, { location: to + (req.url ?? "/") });
    res.end();
  });

/** A service that records whether it was called and answers `body`. */
async function target(body: unknown) {
  let calls = 0;
  const url = await listen((_, res) => {
    calls++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  return { url, calls: () => calls };
}

describe("readJson", () => {
  const answer = (body: string, headers: Record<string, string> = {}) => new Response(body, { headers });

  it("parses a body up to the cap and refuses one byte more", async () => {
    const body = JSON.stringify({ a: "é".repeat(10) });
    const bytes = new TextEncoder().encode(body).length;
    expect(await readJson(answer(body), bytes)).toEqual({ a: "é".repeat(10) });
    await expect(readJson(answer(body), bytes - 1)).rejects.toBeInstanceOf(TooLarge);
    await expect(readJson(answer("not json"))).rejects.toBeInstanceOf(SyntaxError);
    await expect(readJson(answer(""))).rejects.toBeInstanceOf(SyntaxError);
  });

  it("refuses a declared length past the cap without reading the body", async () => {
    await expect(readJson(answer("{}", { "content-length": String(MAX_UPSTREAM_BYTES + 1) }))).rejects.toBeInstanceOf(TooLarge);
  });
});

describe("answers past the 16 MiB cap", () => {
  it("Agora: refused as invalid (502 at /api/ideas), and the rest of the stream is never read", async () => {
    const agora = await flood();
    const err = await readQueue(agora.url, { limit: 10 }, { timeoutMs: 10_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(AgoraInvalid);
    expect(err.message).toMatch(/larger than 16777216 bytes/);
    await agora.closed;
    expect(agora.sent()).toBeLessThan(40 * MiB);

    const again = await flood();
    const base = await listen(createCompanionServer({ provider: null, snapshot: SNAPSHOT, agoraUrl: again.url, agoraTimeoutMs: 10_000 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    expect((await fetch(base + "/api/ideas")).status).toBe(502);
    expect(log.mock.calls[0][0]).toMatch(/^ideas: agora's answer is larger than/);
  });

  it("Provenance: refused as an invalid grade", async () => {
    const prov = await flood();
    const err = await gradeClaim(prov.url, "x", undefined, { timeoutMs: 10_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(CheckerInvalid);
    await prov.closed;
    expect(prov.sent()).toBeLessThan(40 * MiB);
  });

  it("Commons: refused like an outage", async () => {
    const commons = await flood();
    await expect(new HttpCommons(commons.url, 10_000).argumentsFor("lu.chd.8752")).rejects.toBeInstanceOf(TooLarge);
    await commons.closed;
    expect(commons.sent()).toBeLessThan(40 * MiB);
  });
});

describe("redirects are never followed", () => {
  it("Agora, Provenance, Commons and /healthz probes stop at the first hop", async () => {
    const agoraTarget = await target({ charter_version: "0.1.0", ideas: [] });
    await expect(readQueue(await redirecting(agoraTarget.url), { limit: 10 })).rejects.toBeInstanceOf(AgoraUnavailable);

    const provTarget = await target({});
    await expect(gradeClaim(await redirecting(provTarget.url), "x")).rejects.toBeInstanceOf(CheckerUnavailable);

    const commonsTarget = await target({ arguments: [] });
    await expect(new HttpCommons(await redirecting(commonsTarget.url)).argumentsFor("lu.chd.8752")).rejects.toThrow();

    const healthTarget = await target({ ok: true });
    const via = await redirecting(healthTarget.url);
    const base = await listen(createCompanionServer({ provider: null, snapshot: SNAPSHOT, agoraUrl: via, provenanceUrl: via }));
    const health = (await (await fetch(base + "/healthz")).json()) as { agora: unknown; provenance: unknown };
    expect(health).toMatchObject({ agora: false, provenance: false });

    expect([agoraTarget.calls(), provTarget.calls(), commonsTarget.calls(), healthTarget.calls()]).toEqual([0, 0, 0, 0]);
  });
});
