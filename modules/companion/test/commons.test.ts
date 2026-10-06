/**
 * The devil's advocate draws the other side from Commons first, over HTTP.
 *
 * Fixtures are recorded: `docket-esch-42063.json` is the Esch council point of 2026-10-02 from a
 * Docket snapshot, and `commons-esch.json` is the Commons library built from Docket's recorded
 * Esch pages (`d2-commons ingest`, copied from modules/commons/seed/esch.json).
 */

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { HttpCommons, MIN_COMMONS, type CommonsArgument } from "../src/commons.ts";
import { type ChallengeTurn, challenge, commonsShare, MODEL_LABEL } from "../src/companion.ts";
import type { CompletionRequest, Provider } from "../src/provider.ts";
import { createCompanionServer } from "../src/server.ts";
import { buildSources } from "../src/sources.ts";
import type { DocketItem, Position } from "../src/types.ts";
import { ESCH_POINT, ITEM } from "./fixtures.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const ESCH_42063 = { ...read("docket-esch-42063.json"), documents: [] } as DocketItem;
const LIBRARY = read("commons-esch.json").arguments as CommonsArgument[];
const json = (v: unknown) => "```json\n" + JSON.stringify(v) + "\n```";

const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((c) => c()));

async function listen(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Commons' read API (GET /matters/{id}/arguments) over the recorded library. */
async function fakeCommons(library: CommonsArgument[] = LIBRARY) {
  const calls: string[] = [];
  const base = await listen(
    createServer((req, res) => {
      calls.push(req.url ?? "");
      const m = /^\/matters\/([^/]+)\/arguments$/.exec(req.url ?? "");
      if (!m) return res.writeHead(404).end("{}");
      const id = decodeURIComponent(m[1]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ matter_id: id, ranker: null, arguments: library.filter((a) => a.matter_id === id) }));
    }),
  );
  return { base, calls };
}

/**
 * Answers argument extraction with one real-looking institutional argument and every
 * devil's-advocate turn with the next of a set of adversarial answers: invented points,
 * no citations, unknown ids.
 */
class ScriptedProvider implements Provider {
  readonly model = "fake-1";
  readonly requests: CompletionRequest[] = [];
  private turn = 0;
  async complete(req: CompletionRequest): Promise<string> {
    this.requests.push(req);
    if (req.system.includes("list the distinct arguments")) {
      return json({ arguments: [{ stance: "opposes", by: "Chambre d'exemple", summary_en: "Cost.", source: 3, quote: "le coût de 12 millions d'euros est trop élevé" }] });
    }
    const answers = [
      { reply: "r", argument_ids: ["c1", "c2"], sources: [1], new_arguments: ["An invented point.", "Another invented point."] },
      { reply: "r", argument_ids: [], sources: [], new_arguments: ["A third invented point."] },
      { reply: "r", argument_ids: ["c1", "a1", "c99"], sources: [], new_arguments: [] },
    ];
    return json(answers[this.turn++ % answers.length]);
  }
}

describe("Commons over HTTP", () => {
  it("reads one item's arguments and keeps only those with a source link", async () => {
    const broken = { ...LIBRARY[0], id: "no-link", source_url: undefined };
    const elsewhere = { ...LIBRARY[1], id: "other", matter_id: ESCH_42063.id, source_url: "javascript:x" };
    const { base, calls } = await fakeCommons([...LIBRARY, broken, elsewhere]);
    const got = await new HttpCommons(base + "/").argumentsFor(ESCH_42063.id);
    expect(got).toHaveLength(6);
    expect(got.every((a) => a.source_url?.startsWith("https://administration.esch.lu/"))).toBe(true);
    expect(calls).toEqual(["/matters/lu.esch.42063/arguments"]);
  });
});

describe("devil's advocate draws from Commons first", () => {
  it("cites Commons arguments with their links and drops invented points when Commons has enough", async () => {
    const commons = LIBRARY.filter((a) => a.matter_id === ESCH_42063.id);
    const provider = new ScriptedProvider();
    const turn = await challenge(provider, ESCH_42063, {
      lang: "en",
      position: "for",
      arguments: [],
      sources: buildSources(ESCH_42063, "fr"),
      history: [],
      commons,
    });
    const system = provider.requests[0].system;
    expect(system).toContain("c1 [opposes, position only, no reasons given] by ADR group");
    expect(system).not.toContain("CSV"); // the resident's own side is not "the other side"
    expect(system).toContain('leave "new_arguments" empty');
    expect(turn.shown).toEqual([
      expect.objectContaining({ origin: "commons", attribution: "ADR group, Esch-sur-Alzette municipal council" }),
      expect.objectContaining({ origin: "commons", attribution: "LSAP group, Esch-sur-Alzette municipal council" }),
    ]);
    expect(turn.shown.every((a) => a.origin === "commons" && a.source_url.startsWith("https://"))).toBe(true);
    expect(turn).toMatchObject({ grounded: true, commons_available: 3, dropped_model_arguments: 2 });
  });

  it("labels model-written points when Commons has too little", async () => {
    const provider = new ScriptedProvider();
    await provider.complete({ system: "warm-up", messages: [] }); // move to the "no citations" answer
    const turn = await challenge(provider, ITEM, { lang: "en", position: "for", arguments: [], sources: buildSources(ITEM, "fr"), history: [], commons: [] });
    expect(turn.shown).toEqual([{ origin: "model", text: "A third invented point.", label: MODEL_LABEL }]);
    expect(turn.dropped_model_arguments).toBe(0);
    expect(provider.requests[1].system).toContain("labelled as written by you");
  });

  it("meets the Phase 1 bar on the fixture set: >= 80% of shown arguments come from Commons", async () => {
    const { base } = await fakeCommons();
    const provider = new ScriptedProvider();
    const server = createCompanionServer({
      provider,
      snapshot: { schema: "d2.docket.snapshot/2", generated_at: "2026-10-05T00:00:00Z", items: [ESCH_42063, ESCH_POINT, ITEM] },
      commons: new HttpCommons(base),
      ratePerMinute: 1_000,
    });
    const url = await listen(server);
    const turns: (ChallengeTurn & { item: string })[] = [];
    for (const item of [ESCH_42063, ESCH_POINT, ITEM]) {
      for (const position of ["for", "against", "unsure"] as Position[]) {
        for (let i = 0; i < 3; i++) {
          const res = await fetch(url + "/api/challenge", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ item_id: item.id, position, lang: "en" }),
          });
          expect(res.status).toBe(200);
          turns.push({ ...((await res.json()) as ChallengeTurn), item: item.id });
        }
      }
    }
    const covered = turns.filter((t) => t.commons_available >= MIN_COMMONS);
    const share = commonsShare(covered);
    console.log(`commons share: ${(share * 100).toFixed(0)}% of ${covered.flatMap((t) => t.shown).length} arguments shown over ${covered.length} of ${turns.length} turns`);
    expect(covered).toHaveLength(9);
    expect(covered.every((t) => t.item === ESCH_42063.id)).toBe(true);
    expect(share).toBeGreaterThanOrEqual(0.8);
    // Every Commons argument shown links to its public source.
    for (const a of covered.flatMap((t) => t.shown)) if (a.origin === "commons") expect(a.source_url).toMatch(/^https:\/\//);
    // Where Commons has nothing, every model-written point carries the label.
    const rest = turns.filter((t) => t.commons_available < MIN_COMMONS).flatMap((t) => t.shown);
    expect(rest.some((a) => a.origin === "model")).toBe(true);
    for (const a of rest) if (a.origin === "model") expect(a.label).toBe(MODEL_LABEL);
    // With enough in Commons, no extra model call extracts arguments from the documents.
    const extractions = provider.requests.filter((r) => r.system.includes("list the distinct arguments"));
    expect(extractions).toHaveLength(2); // one per item without Commons arguments, then cached
  });

  it("falls back to the documents when Commons is unreachable", async () => {
    const dead = await listen(createServer((_req, res) => res.writeHead(500).end()));
    const provider = new ScriptedProvider();
    const url = await listen(
      createCompanionServer({ provider, snapshot: { schema: "d2.docket.snapshot/2", generated_at: "x", items: [ESCH_42063] }, commons: new HttpCommons(dead) }),
    );
    const res = await fetch(url + "/api/challenge", { method: "POST", body: JSON.stringify({ item_id: ESCH_42063.id, position: "against" }) });
    expect(res.status).toBe(200);
    const turn = (await res.json()) as ChallengeTurn;
    expect(turn.commons_available).toBe(0);
    expect(turn.shown.filter((a) => a.origin === "model")).toHaveLength(2);
  });
});
