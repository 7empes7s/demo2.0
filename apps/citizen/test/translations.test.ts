/**
 * The list's French text in the resident's language, from the one translations file every device
 * downloads, with a one-tap way back to the original French.
 */
// @vitest-environment jsdom

import type { DocketItem } from "@democracy2/companion";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import FileView from "../src/components/FileView.svelte";
import { loadTranslations, translations, tx } from "../src/lib/translations.svelte.ts";
import { setLang } from "../src/lib/ui.svelte.ts";

import recorded from "../../../modules/pulse/test/fixtures/docket-recorded.json" with { type: "json" };

const ITEMS = (recorded as unknown as { items: DocketItem[] }).items;
const ITEM = ITEMS.find((i) => i.agenda.some((m) => m.steps.length) && i.activities.length)!;
const STEP = ITEM.agenda.find((m) => m.steps.length)!.steps[0];
const FILE = {
  schema: "d2.translations/1",
  from: "fr",
  texts: {
    [ITEM.title.fr!]: { en: "A bill on market abuse", de: "Ein Gesetzentwurf über Marktmissbrauch", lb: "E Gesetzprojet", pt: "Um projeto de lei" },
    [STEP]: { en: "First step", de: "Erster Schritt", lb: "Éischte Schrëtt", pt: "Primeiro passo" },
    "Déposé  ": { en: "Filed", de: "Eingereicht", lb: "Deposéiert", pt: "Apresentado" },
    broken: "not an object",
  },
};
let app: Record<string, unknown> | null = null;
const json = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

beforeEach(() => {
  translations.texts = {};
  translations.original = false;
  setLang("en");
});
afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = "";
});

function show() {
  const target = document.createElement("div");
  document.body.append(target);
  app = mount(FileView, { target, props: { item: ITEM, client: null, today: "2026-10-01", onback: () => {} } });
  flushSync();
  return target;
}

describe("Translations", () => {
  it("reads the file, keyed by the French text, and ignores what it cannot read", async () => {
    await loadTranslations(json(FILE));
    expect(tx(ITEM.title.fr!)).toBe("A bill on market abuse");
    expect(tx("Déposé")).toBe("Filed");
    expect(tx("broken")).toBe("broken");
    expect(tx("Not in the file")).toBe("Not in the file");
    setLang("fr");
    expect(tx(ITEM.title.fr!)).toBe(ITEM.title.fr);

    for (const bad of [json({ schema: "other", texts: {} }), json({}, 404), (async () => { throw new Error("offline"); }) as unknown as typeof fetch]) {
      translations.texts = {};
      await loadTranslations(bad);
      expect(translations.texts).toEqual({});
    }
  });

  it("shows a file in the resident's language, and the original French in one tap", async () => {
    await loadTranslations(json(FILE));
    const target = show();
    const title = target.querySelector("#file-title")!;
    expect(title.textContent).toBe("A bill on market abuse");
    expect(title.getAttribute("lang")).toBe("en");
    expect(target.textContent).toContain("First step");
    expect(target.textContent).toContain("Translated automatically from French.");
    // A text with no translation yet stays in French and says so to screen readers.
    const untranslated = [...target.querySelectorAll(".steps li")].find((li) => li.textContent !== "First step");
    if (untranslated) expect(untranslated.getAttribute("lang")).toBe("fr");

    const toggle = [...target.querySelectorAll("button")].find((b) => b.textContent === "Show original")!;
    toggle.click();
    flushSync();
    expect(title.textContent).toBe(ITEM.title.fr);
    expect(title.getAttribute("lang")).toBe("fr");
    expect(target.textContent).toContain("The original French text.");
    const back = [...target.querySelectorAll("button")].find((b) => b.textContent === "Show translation")!;
    back.click();
    flushSync();
    expect(title.textContent).toBe("A bill on market abuse");

    // The documents themselves are never translated; the page still says so.
    expect(target.textContent).toContain("Official texts are in French.");
  });

  it("offers no switch in French, or while nothing is translated", async () => {
    let target = show();
    expect(target.querySelector("[data-testid=original-toggle]")).toBeNull();
    unmount(app!);
    await loadTranslations(json(FILE));
    setLang("fr");
    target = show();
    expect(target.querySelector("[data-testid=original-toggle]")).toBeNull();
    expect(target.querySelector("#file-title")!.textContent).toBe(ITEM.title.fr);
  });
});
