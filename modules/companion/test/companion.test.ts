import { describe, expect, it } from "vitest";

import { challenge, checkClaim, explain, extractArguments } from "../src/companion.ts";
import { buildSources, normalise, parseJson, quoteIsIn } from "../src/sources.ts";
import { FakeProvider, ITEM } from "./fixtures.ts";

const json = (v: unknown) => "```json\n" + JSON.stringify(v) + "\n```";

describe("sources", () => {
  it("puts the dossier facts first, then the bill as filed, then opinions", () => {
    const s = buildSources(ITEM, "de");
    expect(s.map((x) => x.n)).toEqual([1, 2, 3]);
    expect(s[0].url).toBe("https://example.org/de/dossier/0001");
    expect(s[0].text).toContain("Status: En commission");
    expect(s[1].label).toBe("Document de dépôt");
    expect(s[2].label).toBe("Avis de la Chambre d'exemple");
  });

  it("falls back to the French dossier page when the language has none", () => {
    expect(buildSources(ITEM, "pt")[0].url).toBe("https://example.org/fr/dossier/0001");
  });

  it("respects the character budget", () => {
    const big = { ...ITEM, documents: [{ ...ITEM.documents[1], text: "x".repeat(100_000) }] };
    const total = buildSources(big, "fr", 20_000).reduce((n, s) => n + s.text.length, 0);
    expect(total).toBeLessThanOrEqual(20_000);
  });

  it("matches quotes across PDF hyphenation, line breaks, quote styles and case", () => {
    expect(normalise("com-\nmunes  «rurales»")).toBe('communes "rurales"');
    const s = buildSources(ITEM, "fr");
    expect(quoteIsIn("trop élevé pour les communes rurales", [3], s)).toBe(true);
    expect(quoteIsIn("trop élevé pour les communes rurales", [2], s)).toBe(false);
    expect(quoteIsIn("short", [3], s)).toBe(false);
  });

  it("parses JSON wrapped in prose or fences", () => {
    expect(parseJson<{ a: number }>('Sure! ```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJson<{ a: number }>('Here: {"a": 2} done')).toEqual({ a: 2 });
    expect(() => parseJson("no json here")).toThrow();
  });
});

describe("explain", () => {
  it("marks sentences verified only when the quote is really in the cited source", async () => {
    const provider = new FakeProvider([
      json({
        headline: "Communes would have to build cycle networks.",
        sections: [
          {
            heading: "What it is",
            sentences: [
              { text: "Towns over 5,000 people must build a cycle network by 2030.", sources: [2], quote: "créer un réseau cyclable continu d'ici 2030" },
              { text: "It costs 50 million.", sources: [3], quote: "le coût de 50 millions d'euros" },
              { text: "Cites a source that doesn't exist.", sources: [9], quote: "anything at all here" },
              { text: "Here is why this matters." },
            ],
          },
          { heading: "Empty section", sentences: [] },
        ],
      }),
    ]);
    const out = await explain(provider, ITEM, { lang: "en", depth: "short" });
    expect(out.sections).toHaveLength(1);
    const [real, invented, ghost, link] = out.sections[0].sentences;
    expect(real.verified).toBe(true);
    expect(invented.verified).toBe(false);
    expect(ghost.sources).toEqual([]);
    expect(link.verified).toBe(false);
    expect(out.verified_share).toBeCloseTo(1 / 2);
    expect(out.provenance).toMatchObject({ model: "fake-1", item_id: ITEM.id, prompt_version: "companion-prompts/1" });
    expect(provider.requests[0].system).toContain("in English");
    expect(provider.requests[0].system).toContain("never recommend how to vote");
  });
});

describe("arguments and devil's advocate", () => {
  it("keeps only arguments whose quote is in the cited source", async () => {
    const provider = new FakeProvider([
      json({
        arguments: [
          { stance: "opposes", by: "Chambre d'exemple", summary_en: "Too costly for rural communes.", source: 3, quote: "le coût de 12 millions d'euros est trop élevé pour les communes rurales" },
          { stance: "opposes", by: "Nobody", summary_en: "Invented.", source: 3, quote: "une position que personne n'a jamais prise ici" },
          { stance: "loves", by: "x", summary_en: "bad stance", source: 2, quote: "obliger chaque commune de plus de 5.000 habitants" },
        ],
      }),
    ]);
    const out = await extractArguments(provider, ITEM);
    expect(out.arguments.map((a) => a.by)).toEqual(["Chambre d'exemple"]);
    expect(out.arguments[0].id).toBe("a1");
    expect(out.dropped).toBe(2);
  });

  it("reports whether a reply builds on listed arguments and drops unknown ids", async () => {
    const provider = new FakeProvider([
      json({ reply: "Rural communes say the cost is too high. What would you cut?", argument_ids: ["a1", "a7"], sources: [3, 42] }),
      json({ reply: "I have nothing from the documents.", argument_ids: [], sources: [] }),
    ]);
    const base = await extractArguments(
      new FakeProvider([json({ arguments: [{ stance: "opposes", by: "Chambre d'exemple", summary_en: "Cost.", source: 3, quote: "le coût de 12 millions d'euros est trop élevé" }] })]),
      ITEM,
    );
    const opts = { lang: "fr" as const, position: "for" as const, arguments: base.arguments, sources: base.sources, history: [] };
    const turn = await challenge(provider, ITEM, opts);
    expect(turn).toMatchObject({ argument_ids: ["a1"], sources: [3], grounded: true });
    expect(provider.requests[0].system).toContain("in favour of");
    const second = await challenge(provider, ITEM, { ...opts, history: [{ role: "user", content: "ok" }] });
    expect(second.grounded).toBe(false);
  });

  it("asks for both sides with equal strength when the user is unsure", async () => {
    const provider = new FakeProvider([json({ reply: "x", argument_ids: [], sources: [] })]);
    await challenge(provider, ITEM, { lang: "lb", position: "unsure", arguments: [], sources: buildSources(ITEM, "lb"), history: [] });
    expect(provider.requests[0].system).toContain("strongest case on each side");
    expect(provider.requests[0].system).toContain("in Luxembourgish");
  });
});

describe("claim check", () => {
  it("keeps a red grade only when a verified quote backs it", async () => {
    const provider = new FakeProvider([
      json({ grade: "red", explanation: "The cost is 12 million, not 50.", evidence: [{ source: 3, quote: "le coût de 12 millions d'euros" }] }),
      json({ grade: "red", explanation: "Made up.", evidence: [{ source: 3, quote: "texte qui n'existe pas du tout" }] }),
    ]);
    const ok = await checkClaim(provider, ITEM, { lang: "en", claim: "It costs 50 million euros." });
    expect(ok).toMatchObject({ grade: "red", downgraded: false });
    expect(ok.evidence[0].url).toBe("https://example.org/avis.pdf");
    const bad = await checkClaim(provider, ITEM, { lang: "en", claim: "Something." });
    expect(bad).toMatchObject({ grade: "yellow", downgraded: true, evidence: [] });
  });
});
