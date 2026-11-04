/**
 * GET /api/files/{id}/arguments: a file's arguments from Commons, read only.
 *
 * Fixtures are recorded: `commons-answer-esch-42063.json` is what `d2-commons serve` answers for
 * the Esch council point of 2026-10-02 with the Esch seed library (6 council group positions), and
 * `commons-answer-esch-proposals.json` its answer for the participation platform's project
 * (8 resident proposals). `docket-esch-42063.json` is that point from a Docket snapshot.
 */

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { commonsAnswerProblems, fileArgumentsProblems, readFileArguments } from "../src/file-arguments.ts";
import { createCompanionServer } from "../src/server.ts";
import type { DocketItem } from "../src/types.ts";
import { ITEM } from "./fixtures.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const ESCH = { ...read("docket-esch-42063.json"), documents: [] } as DocketItem;
const ANSWER = read("commons-answer-esch-42063.json");
const PROPOSALS = read("commons-answer-esch-proposals.json");
const PROPOSALS_ITEM = { ...ESCH, id: PROPOSALS.matter_id } as DocketItem;
const snapshot = { schema: "d2.docket.snapshot/1", generated_at: "2026-10-03T00:00:00Z", items: [ESCH, PROPOSALS_ITEM, ITEM] };

/** A ranked answer: the ranker version and what it found, made up for the test (Commons has no ratings yet). */
const RANKER = { id: "bridging-mf@0123456789ab", algorithm: "bridging-mf", params: { factor_dim: 1 }, code_hash: "a".repeat(64) };
const RANKED = {
  ...ANSWER,
  ranker: RANKER,
  ranking: [
    { argument_id: ANSWER.arguments[1].id, status: "scored", n_ratings: 40, score: 0.31, strong_both_sides: true },
    { argument_id: ANSWER.arguments[0].id, status: "scored", n_ratings: 12, score: 0.02, strong_both_sides: false },
    { argument_id: ANSWER.arguments[2].id, status: "needs more ratings", n_ratings: 2 },
  ],
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

/** A stand-in for Commons that records every request it gets. */
async function fakeCommons(answer: (req: IncomingMessage, res: ServerResponse) => void) {
  const seen: string[] = [];
  const url = await listen(
    createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      answer(req, res);
    }),
  );
  return { url, seen };
}
const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(typeof body === "string" ? body : JSON.stringify(body));
/** Answers what `d2-commons serve` answered for each recorded file, and an empty list otherwise. */
const recorded = (req: IncomingMessage, res: ServerResponse) => {
  for (const a of [ANSWER, PROPOSALS]) if (req.url === `/matters/${encodeURIComponent(a.matter_id)}/arguments`) return json(res, 200, a);
  json(res, 200, { matter_id: decodeURIComponent(req.url!.split("/")[2]), stance: null, ranker: null, arguments: [] });
};

async function deadUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((r) => server.close(() => r()));
  return `http://127.0.0.1:${port}`;
}

async function companion(commonsUrl: string | undefined, extra: Record<string, unknown> = {}) {
  const base = await listen(createCompanionServer({ provider: null, snapshot, commonsUrl, ...extra }));
  return (path = `/api/files/${ESCH.id}/arguments`, init?: RequestInit) => fetch(base + path, init);
}

const quiet = () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => log.mockRestore());
  return log;
};

describe("Commons answer check", () => {
  it("accepts the recorded answers and a ranked one", () => {
    expect(commonsAnswerProblems(ANSWER, ESCH.id)).toEqual([]);
    expect(commonsAnswerProblems(PROPOSALS, PROPOSALS.matter_id)).toEqual([]);
    expect(commonsAnswerProblems(RANKED, ESCH.id)).toEqual([]);
    expect(commonsAnswerProblems({ matter_id: ESCH.id, stance: null, ranker: null, arguments: [] }, ESCH.id)).toEqual([]);
  });

  it("refuses anything the shared schemas do not allow", () => {
    const arg = ANSWER.arguments[0];
    const bad = [
      null,
      [],
      { ...ANSWER, arguments: "none" },
      { ...ANSWER, matter_id: "lu.esch.1" },
      { ...ANSWER, extra: 1 },
      { ...ANSWER, arguments: [{ ...arg, matter_id: "lu.esch.1" }] },
      { ...ANSWER, arguments: [arg, arg] },
      { ...ANSWER, arguments: [{ ...arg, text: "" }] },
      { ...ANSWER, arguments: [{ ...arg, kind: "opinion" }] },
      { ...ANSWER, arguments: [{ ...arg, source_url: "javascript:alert(1)" }] },
      { ...ANSWER, arguments: [{ ...arg, author_nym: undefined }] },
      { ...ANSWER, arguments: [{ ...arg, extra: 1 }] },
      { ...ANSWER, ranker: "bridging-mf" },
      { ...ANSWER, ranker: { ...RANKER, code_hash: "short" } },
      { ...RANKED, ranking: [{ argument_id: arg.id, status: "loud" }] },
      { ...RANKED, ranking: [{ argument_id: arg.id, status: "scored", strong_both_sides: "yes" }] },
    ];
    for (const value of bad) expect(commonsAnswerProblems(JSON.parse(JSON.stringify(value)), ESCH.id), JSON.stringify(value)).not.toEqual([]);
  });
});

describe("readFileArguments", () => {
  it("passes the arguments on in Commons' order, without pseudonyms or clusters", async () => {
    const commons = await fakeCommons(recorded);
    const list = await readFileArguments(commons.url, ESCH.id);
    expect(commons.seen).toEqual([`GET /matters/${ESCH.id}/arguments`]);
    expect(list.file_id).toBe(ESCH.id);
    expect(list.ranker).toBeNull();
    expect(list.arguments.map((a) => a.id)).toEqual(ANSWER.arguments.map((a: { id: string }) => a.id));
    expect(list.arguments.every((a) => a.kind === "position")).toBe(true);
    expect(list.arguments.filter((a) => a.stance_option_id === "yes")).toHaveLength(3);
    expect(list.arguments.filter((a) => a.stance_option_id === "no")).toHaveLength(3);
    expect(JSON.stringify(list)).not.toMatch(/author_nym|cluster_id|source:esch/);
    expect(fileArgumentsProblems(list, ESCH.id)).toEqual([]);
  });

  it("carries what the ranker found, and 'both sides' only when the ranker says so", async () => {
    const commons = await fakeCommons((_req, res) => json(res, 200, RANKED));
    const list = await readFileArguments(commons.url, ESCH.id);
    expect(list.ranker).toEqual({ id: RANKER.id, algorithm: "bridging-mf" });
    const [first, second, third, fourth] = list.arguments;
    expect(first).toMatchObject({ status: "scored" });
    expect(first.strong_both_sides).toBeUndefined();
    expect(second).toMatchObject({ status: "scored", strong_both_sides: true });
    expect(third).toMatchObject({ status: "needs more ratings" });
    expect(fourth.status).toBeUndefined();
    expect(fileArgumentsProblems(list, ESCH.id)).toEqual([]);
  });

  it("ignores a ranking without a ranker", async () => {
    const commons = await fakeCommons((_req, res) => json(res, 200, { ...RANKED, ranker: null }));
    const list = await readFileArguments(commons.url, ESCH.id);
    expect(list.arguments.some((a) => a.status || a.strong_both_sides)).toBe(false);
  });
});

describe("GET /api/files/{id}/arguments", () => {
  it("forwards to Commons for one file and answers the checked list", async () => {
    const commons = await fakeCommons(recorded);
    const get = await companion(commons.url);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(fileArgumentsProblems(body, ESCH.id)).toEqual([]);
    expect(body.arguments).toHaveLength(6);
    expect(commons.seen).toEqual([`GET /matters/${ESCH.id}/arguments`]);
    // Proposals come through as proposals, with their link.
    const proposals = await (await get(`/api/files/${encodeURIComponent(PROPOSALS.matter_id)}/arguments`)).json();
    expect(proposals.arguments).toHaveLength(8);
    expect(proposals.arguments.every((a: { kind: string; source_url: string }) => a.kind === "proposal" && a.source_url.startsWith("https://participation.esch.lu/"))).toBe(true);
    // A file Commons knows nothing about: an empty list, not an error.
    const none = await (await get(`/api/files/${ITEM.id}/arguments`)).json();
    expect(none).toEqual({ file_id: ITEM.id, ranker: null, arguments: [] });
  });

  it("reuses one Commons answer for the same file for a while", async () => {
    const commons = await fakeCommons(recorded);
    const get = await companion(commons.url);
    await Promise.all([get(), get(), get()]);
    expect(commons.seen).toHaveLength(1);
  });

  it("refuses files that are not in the snapshot, other methods and parameters", async () => {
    const commons = await fakeCommons(recorded);
    const get = await companion(commons.url);
    expect((await get("/api/files/lu.nowhere.1/arguments")).status).toBe(404);
    expect((await get(`/api/files/${ESCH.id}/arguments?stance=yes`)).status).toBe(400);
    expect((await get("/api/files/%E0%A4%A/arguments")).status).toBe(400);
    const post = await get(undefined, { method: "POST", body: "{}" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
    expect(commons.seen).toEqual([]);
  });

  it("says 503 when Commons is not configured", async () => {
    const res = await (await companion(undefined))();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not configured/);
  });

  it("says 502, never 500, when Commons is down or failing", async () => {
    const log = quiet();
    const dead = await (await companion(await deadUrl()))();
    expect(dead.status).toBe(502);
    expect((await dead.json()).error).toBe("the arguments are unavailable");
    const failing = await fakeCommons((_req, res) => json(res, 500, { error: "boom" }));
    expect((await (await companion(failing.url))()).status).toBe(502);
    const slow = await fakeCommons(() => {});
    expect((await (await companion(slow.url, { commonsTimeoutMs: 100 }))()).status).toBe(502);
    expect(log).toHaveBeenCalled();
  });

  it("says 502 when Commons answers something that does not match the schema", async () => {
    quiet();
    for (const body of [
      "not json",
      { ...ANSWER, arguments: [{ ...ANSWER.arguments[0], text: "" }] },
      { ...ANSWER, arguments: [{ ...ANSWER.arguments[0], matter_id: "lu.esch.1" }] },
      { ...ANSWER, matter_id: "lu.esch.1" },
    ]) {
      const commons = await fakeCommons((_req, res) => json(res, 200, body));
      const res = await (await companion(commons.url))();
      expect(res.status, JSON.stringify(body)).toBe(502);
      expect((await res.json()).error).toBe("the arguments gave an answer that could not be read");
    }
  });

  it("does not keep a failed answer", async () => {
    quiet();
    let fail = true;
    const commons = await fakeCommons((req, res) => (fail ? json(res, 500, {}) : recorded(req, res)));
    const get = await companion(commons.url);
    expect((await get()).status).toBe(502);
    fail = false;
    expect((await get()).status).toBe(200);
  });

  it("is rate limited per client in its own bucket", async () => {
    const commons = await fakeCommons(recorded);
    const get = await companion(commons.url, { argumentsPerMinute: 2 });
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(429);
  });
});

describe("the app's check of the Companion's answer", () => {
  it("refuses pseudonyms, unknown fields and a list for another file", async () => {
    const commons = await fakeCommons(recorded);
    const list = await readFileArguments(commons.url, ESCH.id);
    const arg = list.arguments[0];
    for (const value of [
      { ...list, arguments: [{ ...arg, author_nym: "source:esch.lu-council" }] },
      { ...list, arguments: [{ ...arg, strong_both_sides: false }] },
      { ...list, arguments: [{ ...arg, kind: undefined }] },
      { ...list, ranker: { id: "x" } },
      { ...list, extra: 1 },
    ]) {
      expect(fileArgumentsProblems(JSON.parse(JSON.stringify(value)), ESCH.id), JSON.stringify(value)).not.toEqual([]);
    }
    expect(fileArgumentsProblems(list, "lu.esch.1")).toContain("arguments.file_id: another file");
  });
});
