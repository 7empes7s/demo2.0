import type { DocketItem } from "@democracy2/companion";
import { describe, expect, it } from "vitest";

import { historyOf, matches, nextMeeting, safeUrl, sortItems, stageOf, statusOf } from "../src/lib/data.ts";
import { CompanionFailure, errorKey } from "../src/lib/errors.ts";
import { DICTS, formatDate, guessLang, translate } from "../src/lib/i18n.ts";
import { SampleProvider } from "../src/lib/sample-provider.ts";

function item(over: Partial<DocketItem> = {}): DocketItem {
  return {
    id: "lu.chd.1",
    source: "chd.lu",
    jurisdiction_id: "lu",
    number: "1",
    type: "bill",
    type_label: "Projet de loi",
    title: { fr: "Projet de loi sur le logement abordable" },
    status: "Déposé(e)",
    author: null,
    committee: null,
    deposited: "2026-01-01",
    updated: "2026-01-02",
    urls: {},
    agenda: [],
    activities: [],
    documents: [],
    ...over,
  };
}

describe("file stages", () => {
  it("moves from filed to committee to opinions to vote", () => {
    expect(stageOf(item())).toBe("filed");
    expect(stageOf(item({ status: "En commission" }))).toBe("committee");
    expect(stageOf(item({ documents: [{ label: "Avis", url: "u", kind: "avis", text: "" }] }))).toBe("opinions");
    const voted = { date: "2026-03-01", kind: "Vote", description: "Vote constitutionnel", actors: [], documents: [] };
    expect(stageOf(item({ activities: [voted] }))).toBe("vote");
    const report = { date: "2026-03-01", kind: "Commission", description: "Présentation et adoption d’un projet de rapport", actors: [], documents: [] };
    expect(stageOf(item({ status: "En commission", activities: [report] }))).toBe("committee");
  });

  it("hides the site's internal status placeholders", () => {
    expect(statusOf(item({ status: "CHD_Introduction" }))).toBeNull();
    expect(statusOf(item({ status: "En commission" }))).toBe("En commission");
  });
});

describe("history", () => {
  it("drops empty rows and the page's button text, newest first", () => {
    const row = (date: string, description: string) => ({ date, kind: "Commission", description, actors: [], documents: [] });
    const rows = historyOf(
      item({
        activities: [
          row("2026-01-01", "Renvoyé en commission Bouton graphique servant à afficher ou cacher tous les éléments de la liste qui précède Voir plus Voir moins"),
          row("2026-02-01", ""),
          row("2026-03-01", "Avis du Conseil d'État"),
        ],
      }),
    );
    expect(rows.map((r) => r.description)).toEqual(["Avis du Conseil d'État", "Renvoyé en commission"]);
  });
});

describe("agenda", () => {
  const meeting = (date: string, time = "10:00") => ({ meeting_id: date, date, time, body: "Commission", steps: [] });

  it("finds the next meeting and lists files with one first", () => {
    const a = item({ id: "a", number: "a", agenda: [meeting("2026-10-01"), meeting("2026-10-09")] });
    const b = item({ id: "b", number: "b", updated: "2026-09-30" });
    const c = item({ id: "c", number: "c", agenda: [meeting("2026-10-06")] });
    expect(nextMeeting(a, "2026-10-05")?.date).toBe("2026-10-09");
    expect(sortItems([b, a, c], "2026-10-05").map((i) => i.number)).toEqual(["c", "a", "b"]);
  });

  it("searches numbers and words without accents", () => {
    expect(matches(item({ title: { fr: "Réforme du logement" } }), "reforme")).toBe(true);
    expect(matches(item({ number: "8739" }), "8739")).toBe(true);
    expect(matches(item(), "pension")).toBe(false);
  });
});

describe("languages", () => {
  it("has every key in every language", () => {
    const keys = Object.keys(DICTS.en).sort();
    for (const dict of Object.values(DICTS)) expect(Object.keys(dict).sort()).toEqual(keys);
  });

  it("fills variables and formats dates for Luxembourg", () => {
    expect(translate("fr", "next_meeting", { body: "Commission", date: "7 octobre", time: "10:00" })).toBe("Commission, 7 octobre à 10:00");
    expect(formatDate("de", "2026-10-05")).toMatch(/5\. Oktober 2026/);
    expect(guessLang(["pt-PT", "en"])).toBe("pt");
    expect(guessLang(["it"])).toBe("fr");
  });
});

describe("sample provider", () => {
  it("puts the instructions into the first user turn and streams text", async () => {
    const seen: unknown[] = [];
    const provider = new SampleProvider(async (turns, opts) => {
      seen.push(turns);
      opts?.onText?.({ text: "{" });
      return { text: '{"ok":true}' };
    });
    let streamed = "";
    const out = await provider.complete({
      system: "Be neutral.",
      messages: [
        { role: "user", content: "<sources>…</sources>" },
        { role: "assistant", content: "Understood." },
      ],
      onText: (t) => (streamed = t),
    });
    expect(out).toBe('{"ok":true}');
    expect(streamed).toBe("{");
    const turns = seen[0] as { role: string; content: string }[];
    expect(turns[0].content.startsWith("<instructions>\nBe neutral.")).toBe(true);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  });
});

describe("failures", () => {
  it("tells a declined or busy model apart from a cut answer and other errors", async () => {
    const fail = (error: unknown) => new SampleProvider(async () => Promise.reject(error));
    const req = { system: "s", messages: [{ role: "user" as const, content: "x" }] };
    await expect(fail({ code: "not_granted" }).complete(req)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(fail({ code: "rate_limited" }).complete(req)).rejects.toMatchObject({ kind: "busy" });
    const cut = new SampleProvider(async () => ({ text: '{"a":', truncated: true }));
    await expect(cut.complete(req)).rejects.toMatchObject({ kind: "too_long" });
    expect(errorKey(new CompanionFailure("unavailable"))).toBe("error_unavailable");
    expect(errorKey(new Error("x"))).toBe("error");
  });

  it("only links web URLs", () => {
    expect(safeUrl("https://www.chd.lu/fr/dossier/8739")).toBe("https://www.chd.lu/fr/dossier/8739");
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("")).toBeUndefined();
  });
});
