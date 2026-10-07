import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ModelError, type CompletionRequest, type Provider } from "../src/provider.ts";
import { createCompanionServer } from "../src/server.ts";
import { readSnapshot } from "../src/snapshot.ts";
import { batches, textsOf, textsOfItem, translateBatch, Translator } from "../src/translate.ts";
import { ESCH_CONSULTATION, ESCH_POINT, ITEM } from "./fixtures.ts";

const snapshot = readSnapshot({ schema: "d2.docket.snapshot/2", generated_at: "2026-02-01T00:00:00Z", items: [ITEM, ESCH_POINT, ESCH_CONSULTATION] });

/** Answers each request by "translating" every text into `<lang>: <text>`, and records what it was asked. */
class EchoTranslator implements Provider {
  readonly kind = "fake";
  readonly model = "fake-1";
  readonly requests: CompletionRequest[] = [];
  failures = 0;
  async complete(req: CompletionRequest): Promise<string> {
    this.requests.push(req);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new ModelError("down");
    }
    const { items } = JSON.parse(req.messages[0].content) as { items: { i: number; fr: string }[] };
    return "```json\n" + JSON.stringify({ items: items.map(({ i, fr }) => ({ i, en: `en: ${fr}`, de: `de: ${fr}`, lb: `lb: ${fr}`, pt: `pt: ${fr}` })) }) + "\n```";
  }
}

const servers: { close: () => void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

describe("translations of the list's French text", () => {
  it("collects every text a file shows, once each, and nothing that is not text", () => {
    const texts = textsOfItem(ITEM);
    expect(texts[0]).toBe(ITEM.title.fr);
    if (ITEM.status) expect(texts).toContain(ITEM.status);
    for (const a of ITEM.activities) if (a.description.trim()) expect(texts).toContain(a.description.replace(/\s+/g, " ").trim());
    for (const d of ITEM.documents) if (!/\.[a-z0-9]{2,4}$/i.test(d.label)) expect(texts).toContain(d.label);
    expect(texts).not.toContain(ITEM.number);
    expect(texts).not.toContain(ITEM.author);
    expect(textsOfItem({ ...ITEM, documents: [{ ...ITEM.documents[0], label: "30 PAP Quai Neiduerf_PE_approuvé.pdf" }] })).not.toContain("30 PAP Quai Neiduerf_PE_approuvé.pdf");
    const all = textsOf(snapshot);
    expect(new Set(all).size).toBe(all.length);
    if (ESCH_CONSULTATION.summary) expect(all).toContain(ESCH_CONSULTATION.summary);
  });

  it("groups texts into requests by size", () => {
    expect(batches(["aaaa", "bbbb", "cc", "dddddddd"], 9)).toEqual([["aaaa", "bbbb"], ["cc"], ["dddddddd"]]);
    expect(batches([], 9)).toEqual([]);
  });

  it("keeps only complete, sane answers", async () => {
    const provider: Provider = {
      model: "m",
      complete: async () =>
        JSON.stringify({
          items: [
            { i: 0, en: "Bill", de: "Gesetzentwurf", lb: "Gesetzprojet", pt: "Projeto de lei" },
            { i: 1, en: "only English" },
            { i: 2, en: "x".repeat(500), de: "x", lb: "x", pt: "x" },
            { i: 9, en: "a", de: "a", lb: "a", pt: "a" },
          ],
        }),
    };
    const found = await translateBatch(provider, ["Projet de loi", "Déposé", "Avis"]);
    expect([...found.keys()]).toEqual(["Projet de loi"]);
    expect(found.get("Projet de loi")).toEqual({ en: "Bill", de: "Gesetzentwurf", lb: "Gesetzprojet", pt: "Projeto de lei" });
  });

  it("translates in the background, serves the same file to everyone, and keeps it across restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "d2-translations-"));
    const cachePath = join(dir, "translations.json");
    const provider = new EchoTranslator();
    const translator = new Translator(snapshot, { provider, cachePath, intervalMs: 0, batchChars: 200, log: () => {} });
    await translator.load();

    const server = createCompanionServer({ provider, snapshot, translator });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // Before the job runs: an empty file, so the app shows the original French.
    const before = await (await fetch(base + "/data/translations.json")).json();
    expect(before).toEqual({ schema: "d2.translations/1", from: "fr", texts: {} });

    await translator.run();
    expect(provider.requests.length).toBeGreaterThan(1);
    // The model gets the texts as data, never instructions from the list.
    expect(provider.requests[0].system).toContain("Luxembourgish (lb)");
    const res = await fetch(base + "/data/translations.json");
    const tag = res.headers.get("etag")!;
    const after = (await res.json()) as { texts: Record<string, Record<string, string>> };
    expect(Object.keys(after.texts).sort()).toEqual(textsOf(snapshot).sort());
    expect(after.texts[ITEM.title.fr!]).toEqual({ en: `en: ${ITEM.title.fr}`, de: `de: ${ITEM.title.fr}`, lb: `lb: ${ITEM.title.fr}`, pt: `pt: ${ITEM.title.fr}` });
    expect((await fetch(base + "/data/translations.json", { headers: { "if-none-match": tag } })).status).toBe(304);

    // A restart reads the cache and asks the model for nothing.
    const again = new EchoTranslator();
    const restarted = new Translator(snapshot, { provider: again, cachePath, intervalMs: 0, log: () => {} });
    await restarted.load();
    expect(restarted.missing()).toEqual([]);
    await restarted.run();
    expect(again.requests).toHaveLength(0);
    expect(JSON.parse(await readFile(cachePath, "utf8")).schema).toBe("d2.translations/1");
  });

  it("stops after three failed requests, keeps what it has, and survives a broken cache", async () => {
    const dir = await mkdtemp(join(tmpdir(), "d2-translations-"));
    const cachePath = join(dir, "translations.json");
    await writeFile(cachePath, "{not json");
    const provider = new EchoTranslator();
    provider.failures = 99;
    const lines: string[] = [];
    const translator = new Translator(snapshot, { provider, cachePath, intervalMs: 0, batchChars: 50, log: (l) => lines.push(l) });
    await translator.load();
    await translator.run();
    expect(provider.requests).toHaveLength(3);
    expect(lines.join("\n")).toContain("stopping after three failed requests");
    expect(translator.missing().length).toBe(textsOf(snapshot).length);
    // No model: nothing is attempted and nothing breaks.
    await new Translator(snapshot, { provider: null }).run();
  });
});
