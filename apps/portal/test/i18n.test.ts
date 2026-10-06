import { describe, expect, it } from "vitest";

import { DICTS, translate } from "../src/lib/i18n.ts";
import { parseHash } from "../src/lib/route.svelte.ts";
import { compact, formatDate, pick, short } from "../src/lib/text.ts";

describe("dictionaries", () => {
  it("French has every English key, no empty strings, and the same placeholders", () => {
    const en = DICTS.en;
    const fr = DICTS.fr;
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(fr[key], key).toBeTruthy();
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(vars(fr[key]), key).toEqual(vars(en[key]));
    }
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    expect(translate("en", "signed_in_as", { name: "Ada", role: "admin" })).toBe("Ada, admin");
    expect(translate("fr", "feedback_received", {})).toBe("Reçu le {date}");
  });
});

describe("text helpers", () => {
  it("picks the reader's language, then the commune's working language", () => {
    expect(pick({ fr: "Bonjour", en: "Hello" }, "en")).toEqual({ text: "Hello", lang: "en" });
    expect(pick({ fr: "Bonjour", de: "Hallo" }, "en")).toEqual({ text: "Bonjour", lang: "fr" });
    expect(pick({ de: "Hallo" }, "en")).toEqual({ text: "Hallo", lang: "de" });
    expect(pick(null, "en")).toEqual({ text: "", lang: null });
  });

  it("drops empty languages, formats dates in Luxembourg time, shortens hashes", () => {
    expect(compact({ fr: " Oui ", en: "", de: "   " })).toEqual({ fr: "Oui" });
    expect(formatDate("en", "2026-10-06")).toBe("6 October 2026");
    expect(formatDate("fr", "2026-10-06T23:30:00.000Z")).toBe("7 octobre 2026");
    expect(short("abcdef0123456789")).toBe("abcdef0123");
  });
});

describe("routes", () => {
  it("reads the section and its argument from the hash, and ignores unknown sections", () => {
    expect(parseHash("#inbox")).toEqual({ section: "inbox", arg: null });
    expect(parseHash("#procedures/new")).toEqual({ section: "procedures", arg: "new" });
    expect(parseHash("#audit-votes/r%201")).toEqual({ section: "audit-votes", arg: "r 1" });
    expect(parseHash("#nowhere/x")).toEqual({ section: null, arg: "x" });
    expect(parseHash("")).toEqual({ section: null, arg: null });
  });
});
