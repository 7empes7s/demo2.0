/**
 * The welcome steps on a first visit, the settings page after that, and the plain-language topic
 * groups both of them offer instead of the published committee names.
 */
// @vitest-environment jsdom

import type { DocketItem } from "@democracy2/companion";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../src/App.svelte";
import { pulse, reloadPulse } from "../src/lib/pulse.svelte.ts";
import { expandGroups, groupsIn, groupsOf } from "../src/lib/topics.ts";
import { setLang } from "../src/lib/ui.svelte.ts";

import recorded from "../../../modules/pulse/test/fixtures/docket-recorded.json" with { type: "json" };

const SNAPSHOT = recorded as unknown as { items: DocketItem[] };
const ESCH = "lu-commune-esch-sur-alzette";
let app: Record<string, unknown> | null = null;

const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
};
const click = (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  (el as HTMLElement).click();
  flushSync();
};
const buttonText = (root: ParentNode, text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(text));

async function openApp() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("data/snapshot.json")) return new Response(JSON.stringify(recorded), { status: 200 });
      return new Response("{}", { status: 404 });
    }),
  );
  const target = document.createElement("div");
  document.body.append(target);
  app = mount(App, { target });
  await settle();
  return target;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
  localStorage.clear();
  reloadPulse();
  setLang("en");
  delete document.documentElement.dataset.theme;
  history.replaceState(null, "", "/");
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Topic groups", () => {
  it("sorts every published name into a plain group, in the resident's language", () => {
    expect(groupsOf("Budget et Finances")).toEqual(["money"]);
    expect(groupsOf("Commission de l'Exécution budgétaire")).toEqual(["money"]);
    expect(groupsOf("Commission de la Mobilité et des Travaux publics")).toEqual(["transport"]);
    expect(groupsOf("Logement")).toEqual(["housing"]);
    expect(groupsOf("Développement urbain")).toEqual(["housing"]);
    expect(groupsOf("Commission de la Santé et de la Sécurité sociale")).toEqual(["health"]);
    expect(groupsOf("Office social")).toEqual(["health"]);
    expect(groupsOf("Commission de la Famille, des Solidarités, du Vivre ensemble, de l'Accueil, de l'Égalité du Genre et de la Diversité")).toEqual(["family"]);
    expect(groupsOf("Enseignement / Structures d'accueil")).toEqual(["family"]);
    expect(groupsOf("Commission de l'Agriculture, de l'Alimentation et de la Viticulture")).toEqual(["environment"]);
    expect(groupsOf("Commission de la Justice")).toEqual(["safety"]);
    expect(groupsOf("Sécurité publique")).toEqual(["safety"]);
    expect(groupsOf("Commission des Affaires intérieures")).toEqual(["safety"]);
    expect(groupsOf("Personnel")).toEqual(["work"]);
    expect(groupsOf("Culture")).toEqual(["culture"]);
    expect(groupsOf("Commission du Règlement")).toEqual(["state"]);
    expect(groupsOf("Organisation communale")).toEqual(["state"]);
    expect(groupsOf("Démocratie participative")).toEqual(["state"]);
    expect(groupsOf('Commission spéciale "Tripartite"')).toEqual(["money"]);
    // A name with words from two groups is reachable from both.
    expect(groupsOf("Tourisme, relations internationales et jumelages, coopération transfrontalière")).toEqual(["culture", "state"]);
    // Nothing is left out: an unknown name goes under "Other".
    expect(groupsOf("Commission des Pétitions et des Lapins")).toEqual(["state"]);
    expect(groupsOf("Zzz")).toEqual(["other"]);
  });

  it("offers only the groups the list has, and stands for every published name under them", () => {
    const names = ["Budget et Finances", "Commission des Finances", "Développement urbain", "Zzz"];
    expect(groupsIn(names)).toEqual(["money", "housing", "other"]);
    expect(expandGroups(["money"], names)).toEqual(["Budget et Finances", "Commission des Finances"]);
    expect(expandGroups(["other"], names)).toEqual(["Zzz"]);
    expect(expandGroups([], names)).toEqual([]);
  });
});

describe("Welcome steps", () => {
  it("walks a first visit through language, place and topics, then opens the week", async () => {
    const target = await openApp();
    const welcome = target.querySelector("[data-testid=welcome]")!;
    expect(welcome).toBeTruthy();
    expect(target.querySelector("#week-title")).toBeNull();
    expect(target.textContent).toContain("Step 1 of 3");
    expect(target.textContent).toContain("Which language do you read best?");
    // The header offers nothing to get lost in while the steps are open.
    expect(buttonText(target, "Settings")).toBeUndefined();

    // Picking a language changes the screen at once.
    click(buttonText(target, "Français"));
    expect(target.textContent).toContain("Étape 1 sur 3");
    expect(document.documentElement.lang).toBe("fr");
    click(buttonText(target, "English"));

    click(buttonText(target, "Next"));
    expect(target.textContent).toContain("Step 2 of 3");
    expect(target.textContent).toContain("Where do you live?");
    expect(target.querySelector("[data-testid=week-private]")?.textContent).toContain("Your choices stay on this device.");
    const select = target.querySelector<HTMLSelectElement>("select#home")!;
    select.value = ESCH;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();

    click(buttonText(target, "Next"));
    expect(target.textContent).toContain("Step 3 of 3");
    expect(target.textContent).toContain("What do you care about?");
    expect(target.textContent).not.toContain("Commission");
    click(buttonText(target, "Money and budget"));
    click(buttonText(target, "Getting around"));
    expect(pulse.prefs.groups).toEqual(["money", "transport"]);

    click(buttonText(target, "Back"));
    expect(target.textContent).toContain("Step 2 of 3");
    click(buttonText(target, "Next"));
    click(buttonText(target, "Show my week"));
    await settle();

    expect(target.querySelector("[data-testid=welcome]")).toBeNull();
    expect(target.querySelector("#week-title")).toBeTruthy();
    expect(target.querySelector("[data-testid=week-summary]")?.textContent).toContain("Esch-sur-Alzette");
    expect(target.querySelector("[data-testid=week-summary] dd:last-of-type")?.textContent).toBe("2");
    expect(JSON.parse(localStorage.getItem("d2.pulse.v1")!)).toEqual({ home: ESCH, groups: ["money", "transport"], done: true });
  });

  it("can be skipped, and is not shown again", async () => {
    let target = await openApp();
    click(buttonText(target, "Skip for now"));
    await settle();
    expect(target.querySelector("[data-testid=welcome]")).toBeNull();
    expect(target.querySelector("#week-title")).toBeTruthy();
    expect(target.querySelector("[data-testid=week-summary]")?.textContent).toContain("Choose where you live to see your files first.");
    expect(JSON.parse(localStorage.getItem("d2.pulse.v1")!)).toEqual({ home: null, groups: [], done: true });

    unmount(app!);
    app = null;
    document.body.innerHTML = "";
    reloadPulse();
    target = await openApp();
    expect(target.querySelector("[data-testid=welcome]")).toBeNull();
    expect(target.querySelector("#week-title")).toBeTruthy();

    // "Set up" on the week leads to the settings page, where the same choices are made.
    click(buttonText(target, "Set up"));
    await settle();
    expect(location.hash).toBe("#settings");
    expect(target.querySelector("[data-testid=settings]")).toBeTruthy();
  });
});

describe("Settings page", () => {
  it("holds language, appearance, place and topics, reached from the header", async () => {
    localStorage.setItem("d2.pulse.v1", JSON.stringify({ home: ESCH, groups: ["money"], done: true }));
    reloadPulse();
    const target = await openApp();
    click(buttonText(target, "Settings"));
    await settle();
    const page = target.querySelector("[data-testid=settings]")!;
    expect(page).toBeTruthy();
    expect(page.textContent).toContain("Your choices stay on this device.");

    click(buttonText(page, "Dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("d2.theme")).toBe("dark");
    click(buttonText(page, "Like my phone"));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("d2.theme")).toBeNull();

    expect(page.querySelector<HTMLSelectElement>("select#home")!.value).toBe(ESCH);
    expect(buttonText(page, "Money and budget")?.getAttribute("aria-pressed")).toBe("true");
    click(buttonText(page, "Money and budget"));
    expect(pulse.prefs.groups).toEqual([]);

    click(buttonText(page, "Deutsch"));
    expect(target.textContent).toContain("Einstellungen");
    expect(localStorage.getItem("d2.lang")).toBe("de");
  });
});
