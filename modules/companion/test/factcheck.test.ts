import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { gradeClaim, gradeProblems, isGrade, MAX_CLAIM } from "../src/factcheck.ts";
import { createCompanionServer } from "../src/server.ts";
import { FakeProvider, ITEM } from "./fixtures.ts";

/** A grade as Provenance's `match` checker returns it. */
const GRADE = {
  claim_id: "claim-0123456789abcdef",
  checker_id: "provenance-match",
  grade: "green",
  evidence: [
    {
      url: "https://www.chd.lu/fr/dossier/8752",
      source_document_id: null,
      excerpt: "Dépôt le 15 mai 2026",
      locator: "history row 1",
    },
  ],
  model_version: "match/2+docket:0123456789ab",
};

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

/** A stand-in for the Provenance service that records what it was sent. */
async function fakeProvenance(answer: (body: Record<string, unknown>, res: ServerResponse) => void) {
  const seen: Record<string, unknown>[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as Record<string, unknown>;
    seen.push({ path: req.url, ...body });
    answer(body, res);
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

async function companion(provenanceUrl: string | undefined, extra: Record<string, unknown> = {}) {
  const snapshot = { schema: "d2.docket.snapshot/1", generated_at: "2026-02-01T00:00:00Z", items: [ITEM] };
  const server = createCompanionServer({ provider: null, snapshot, provenanceUrl, ...extra });
  const base = await listen(server);
  return (body: unknown) =>
    fetch(base + "/api/factcheck", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

describe("grade schema check", () => {
  it("accepts a grade that matches spec/schemas/grade.schema.json", () => {
    expect(gradeProblems(GRADE)).toEqual([]);
    expect(isGrade(GRADE)).toBe(true);
  });

  it("rejects anything the schema does not allow", () => {
    const bad = [
      null,
      "green",
      { ...GRADE, grade: "blue" },
      { ...GRADE, evidence: [] },
      { ...GRADE, evidence: [{ ...GRADE.evidence[0], url: "javascript:alert(1)" }] },
      { ...GRADE, evidence: [{ ...GRADE.evidence[0], excerpt: "" }] },
      { ...GRADE, evidence: [{ url: "https://x.lu/" }] },
      { ...GRADE, extra: 1 },
      { ...GRADE, model_version: undefined },
      { ...GRADE, claim_id: 7 },
    ];
    for (const value of bad) expect(gradeProblems(JSON.parse(JSON.stringify(value) ?? "null")), JSON.stringify(value)).not.toEqual([]);
  });

  it("does not let keys named like Object built-ins past additionalProperties", () => {
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      // JSON.parse makes "__proto__" an own key, as an upstream answer would.
      const top = JSON.parse(JSON.stringify(GRADE).replace(/^\{/, `{"${key}":{"x":1},`));
      expect(gradeProblems(top), key).toContain(`grade.${key}: not allowed`);
      const inEvidence = JSON.parse(JSON.stringify(GRADE).replace('"url":', `"${key}":"z","url":`));
      expect(gradeProblems(inEvidence), key).toContain(`grade.evidence[0].${key}: not allowed`);
    }
  });

  it("does not count an inherited key as a required one", () => {
    const { model_version: _, ...rest } = GRADE;
    const proto = Object.assign(Object.create({ model_version: "m" }), rest);
    expect(gradeProblems(proto)).toContain("grade.model_version: missing");
  });
});

describe("gradeClaim", () => {
  it("posts the claim and its context and returns the grade", async () => {
    const prov = await fakeProvenance((_, res) => json(res, 200, GRADE));
    expect(await gradeClaim(prov.url + "/", "Déposé le 15 mai 2026", "lu.chd.8752")).toEqual({ result: "graded", grade: GRADE });
    expect(prov.seen).toEqual([{ path: "/claims/grade", text: "Déposé le 15 mai 2026", context: "lu.chd.8752" }]);
  });

  it("reports a body that stalls after the headers as unavailable, not as an invalid answer", async () => {
    const prov = await fakeProvenance((_, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"claim_id":');
    });
    await expect(gradeClaim(prov.url, "x", undefined, { timeoutMs: 100 })).rejects.toThrow(/timed out while sending/);
  });

  it("times out instead of waiting forever", async () => {
    const prov = await fakeProvenance(() => {});
    await expect(gradeClaim(prov.url, "x", undefined, { timeoutMs: 50 })).rejects.toThrow(/unreachable/);
  });
});

describe("POST /api/factcheck", () => {
  it("returns a valid grade, with the file as context, without a model", async () => {
    const prov = await fakeProvenance((_, res) => json(res, 200, GRADE));
    const post = await companion(prov.url);
    const res = await post({ text: "  Déposé le 15 mai 2026 ", item_id: ITEM.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "graded", grade: GRADE });
    expect(prov.seen).toEqual([{ path: "/claims/grade", text: "Déposé le 15 mai 2026", context: ITEM.id }]);
  });

  it("checks a claim on its own, with no file", async () => {
    const prov = await fakeProvenance((_, res) => json(res, 200, GRADE));
    const res = await (await companion(prov.url))({ text: "Le projet de loi 8752 a été déposé le 15 mai 2026" });
    expect(res.status).toBe(200);
    expect(prov.seen[0]).not.toHaveProperty("context");
  });

  it("says when no record mentions the claim, without a grade", async () => {
    const prov = await fakeProvenance((_, res) => json(res, 404, { error: "no record mentions this claim", code: "no_record" }));
    const res = await (await companion(prov.url))({ text: "Les licornes votent à Esch" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "no_record" });
  });

  it("treats any other 404 as unavailable, never as no record, and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const answer of [{ error: "not found" }, { error: "no record mentions this claim" }, "<html>404</html>", { code: "unknown_context" }]) {
        const prov = await fakeProvenance((_, res) => json(res, 404, answer));
        const res = await (await companion(prov.url))({ text: "Le projet de loi 8752" });
        expect(res.status, JSON.stringify(answer)).toBe(503);
        expect(await res.json()).toEqual({ error: "the claim checker is unavailable" });
      }
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^factcheck: provenance answered 404.*\(claim of 21 characters\)$/));
      expect(log.mock.calls.flat().join("\n")).not.toContain("Le projet de loi");
    } finally {
      log.mockRestore();
    }
  });

  it("answers no record when Provenance does not hold the file, and unavailable on other 4xx and 5xx", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const stale = await fakeProvenance((_, res) => json(res, 400, { error: "unknown context 'lu.chd.8752': no such record", code: "unknown_context" }));
      const res = await (await companion(stale.url))({ text: "Déposé le 15 mai 2026", item_id: ITEM.id });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ result: "no_record" });

      const bad = await fakeProvenance((_, res) => json(res, 400, { error: "claim text is empty" }));
      expect((await (await companion(bad.url))({ text: "x" })).status).toBe(503);
      const failing = await fakeProvenance((_, res) => json(res, 502, { error: "x" }));
      expect((await (await companion(failing.url))({ text: "x" })).status).toBe(503);
      expect(log.mock.calls.map((c) => c[0])).toEqual([
        "factcheck: provenance answered 400 (claim of 1 characters)",
        "factcheck: provenance answered 502 (claim of 1 characters)",
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it("answers 503 when the body stalls after the headers", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const prov = await fakeProvenance((_, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.write("{");
      });
      const res = await (await companion(prov.url, { provenanceTimeoutMs: 100 }))({ text: "x" });
      expect(res.status).toBe(503);
      expect(log).toHaveBeenCalledWith("factcheck: provenance timed out while sending its answer (claim of 1 characters)");
    } finally {
      log.mockRestore();
    }
  });

  it("refuses a schema-invalid answer instead of showing it", async () => {
    for (const answer of [{ ...GRADE, grade: "blue" }, { ...GRADE, evidence: [] }, { grade: "green" }, "<html>oops</html>"]) {
      const prov = await fakeProvenance((_, res) => json(res, 200, answer));
      const res = await (await companion(prov.url))({ text: "Déposé le 15 mai 2026" });
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body).not.toHaveProperty("grade");
      expect(body.error).toMatch(/could not be read/);
    }
  });

  it("answers 503 when the checker is unreachable, failing or not configured", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    const dead = await companion(await deadUrl());
    expect((await dead({ text: "Déposé le 15 mai 2026" })).status).toBe(503);

    const failing = await fakeProvenance((_, res) => json(res, 500, { error: "boom" }));
    expect((await (await companion(failing.url))({ text: "x" })).status).toBe(503);

    const slow = await fakeProvenance(() => {});
    expect((await (await companion(slow.url, { provenanceTimeoutMs: 50 }))({ text: "x" })).status).toBe(503);

    const none = await (await companion(undefined))({ text: "x" });
    expect(none.status).toBe(503);
    expect((await none.json()).error).toMatch(/not configured/);
  });

  it("limits the request size and refuses to cut a claim", async () => {
    const prov = await fakeProvenance((_, res) => json(res, 200, GRADE));
    const post = await companion(prov.url);
    expect((await post({ text: "a".repeat(MAX_CLAIM) })).status).toBe(200);
    expect((await post({ text: "a".repeat(MAX_CLAIM + 1) })).status).toBe(413);
    expect((await post({ text: "a", pad: "b".repeat(5_000) })).status).toBe(413);
    expect(prov.seen).toHaveLength(1);
  });

  it("rejects empty claims, bad bodies and unknown files before calling the checker", async () => {
    const prov = await fakeProvenance((_, res) => json(res, 200, GRADE));
    const post = await companion(prov.url);
    expect((await post({ text: "   " })).status).toBe(400);
    expect((await post({ text: 42 })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ text: "x", item_id: "lu.chd.0000" })).status).toBe(404);
    expect(prov.seen).toHaveLength(0);
  });

  it("is rate limited per client", async () => {
    const prov = await fakeProvenance((_, res) => json(res, 200, GRADE));
    const post = await companion(prov.url, { factcheckPerMinute: 2 });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await post({ text: `c${i}` })).status);
    expect(codes).toEqual([200, 200, 429]);
  });

  it("has its own rate-limit bucket, apart from the model routes", async () => {
    const prov = await fakeProvenance((_, res) => json(res, 200, GRADE));
    const answer = JSON.stringify({ grade: "yellow", explanation: "e", evidence: [] });
    const snapshot = { schema: "d2.docket.snapshot/1", generated_at: "2026-02-01T00:00:00Z", items: [ITEM] };
    const server = createCompanionServer({ provider: new FakeProvider([answer, answer]), snapshot, provenanceUrl: prov.url, ratePerMinute: 1, factcheckPerMinute: 1 });
    const base = await listen(server);
    const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const codes = [];
    codes.push((await post("/api/claim", { item_id: ITEM.id, claim: "c0" })).status);
    codes.push((await post("/api/factcheck", { text: "c1" })).status);
    codes.push((await post("/api/claim", { item_id: ITEM.id, claim: "c2" })).status);
    codes.push((await post("/api/factcheck", { text: "c3" })).status);
    expect(codes).toEqual([200, 200, 429, 429]);
  });
});

describe("GET /healthz", () => {
  const health = async (provenanceUrl: string | undefined) => {
    const snapshot = { schema: "d2.docket.snapshot/1", generated_at: "2026-02-01T00:00:00Z", items: [ITEM] };
    const base = await listen(createCompanionServer({ provider: null, snapshot, provenanceUrl }));
    return async () => {
      const res = await fetch(base + "/healthz");
      expect(res.status).toBe(200);
      return ((await res.json()) as { provenance: unknown }).provenance;
    };
  };

  it("reports whether Provenance is up, caches it, and never fails on it", async () => {
    let calls = 0;
    const up = createServer((req, res) => {
      calls++;
      json(res, req.url === "/healthz" ? 200 : 404, { ok: true, items: 1, sentences: 2 });
    });
    const check = await health(await listen(up));
    expect(await check()).toBe(true);
    expect(await check()).toBe(true);
    expect(calls).toBe(1);

    expect(await (await health(await deadUrl()))()).toBe(false);
    expect(await (await health(undefined))()).toBe(false);
    const notOk = createServer((_, res) => json(res, 200, { ok: false }));
    expect(await (await health(await listen(notOk)))()).toBe(false);
    const wrong = createServer((_, res) => json(res, 404, { error: "not found" }));
    expect(await (await health(await listen(wrong)))()).toBe(false);
  });

  it("waits at most about a second for a hung Provenance", async () => {
    const hung = createServer(() => {});
    const check = await health(await listen(hung));
    const started = Date.now();
    expect(await check()).toBe(false);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
