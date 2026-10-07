// @vitest-environment jsdom
//
// Pulse "done when": a network trace of the client shows no request that depends on the
// resident's interests. The whole app is mounted under different choices (where they live,
// topics followed, files understood), each choice is also changed through the screen, and every
// request the page makes is recorded: fetch, XHR, sockets, beacons, the service worker it
// registers, and every resource element (img, script, iframe...) it puts in the document. This
// runs twice, without and with the Companion. The traces must be identical.
import type { DocketItem } from "@democracy2/companion";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../src/App.svelte";
import Week from "../src/components/Week.svelte";
import { reloadArena, resetArena } from "../src/lib/arena.svelte.ts";
import { DICTS } from "../src/lib/i18n.ts";
import { registerServiceWorker } from "../src/lib/pwa.ts";
import Settings from "../src/components/Settings.svelte";
import { pulse, reloadPulse } from "../src/lib/pulse.svelte.ts";
import { translations } from "../src/lib/translations.svelte.ts";
import { setLang } from "../src/lib/ui.svelte.ts";
// The recorded Docket snapshot (real chd.lu and esch.lu records).
import recorded from "../../../modules/pulse/test/fixtures/docket-recorded.json" with { type: "json" };

const SNAPSHOT = recorded as unknown as { items: DocketItem[] };
/** What the server serves at data/translations.json: every title, in every language, for everyone. */
const TRANSLATIONS = {
  schema: "d2.translations/1",
  from: "fr",
  texts: Object.fromEntries(SNAPSHOT.items.map((i) => [i.title.fr, { en: `EN ${i.title.fr}`, de: `DE ${i.title.fr}`, lb: `LB ${i.title.fr}`, pt: `PT ${i.title.fr}` }])),
};
const ESCH = "lu-commune-esch-sur-alzette";
const CITY = "lu-commune-luxembourg";
/** Thursday of ISO week 40 of 2026: the Esch council of 2 October is in this week. */
const NOW = new Date("2026-10-01T10:00:00Z");

type Request = { via: string; method: string; url: string; body: string | null; headers: [string, string][] };
let trace: Request[] = [];
let app: Record<string, unknown> | null = null;
let observer: MutationObserver | null = null;

/** Elements that make the browser load something; `a` is not one (only a click follows it). */
const LOADS = "img, link, script, iframe, frame, audio, video, source, track, embed, object, input[type=image]";
const URL_ATTRS = ["src", "href", "srcset", "poster", "data"];

/** Records what an added element loads. `later` are the records after its insertion in the same
 * batch: if one of them changed an attribute, the value at insertion is that change's old value. */
function recordElement(el: Element, later: MutationRecord[] = []) {
  for (const node of [el, ...el.querySelectorAll(LOADS)]) {
    if (!node.matches(LOADS)) continue;
    for (const attr of URL_ATTRS) {
      const next = later.find((n) => n.type === "attributes" && n.target === node && n.attributeName === attr);
      const url = next ? next.oldValue : node.getAttribute(attr);
      if (url) trace.push({ via: `dom ${node.tagName.toLowerCase()}`, method: attr, url, body: null, headers: [] });
    }
  }
}

function recordMutations(records: MutationRecord[]) {
  records.forEach((r, i) => {
    if (r.type === "attributes") {
      if (!(r.target instanceof Element) || !r.target.matches(LOADS)) return;
      // Records arrive in batches: the value this change set is the next change's old value.
      const next = records.slice(i + 1).find((n) => n.type === "attributes" && n.target === r.target && n.attributeName === r.attributeName);
      const url = next ? next.oldValue : r.target.getAttribute(r.attributeName!);
      if (url) trace.push({ via: `dom ${r.target.tagName.toLowerCase()}`, method: r.attributeName!, url, body: null, headers: [] });
      return;
    }
    for (const node of r.addedNodes) if (node instanceof Element) recordElement(node, records.slice(i + 1));
  });
}

/** Ends the DOM watch and records what it saw last. */
function stopWatching() {
  if (!observer) return;
  recordMutations(observer.takeRecords());
  observer.disconnect();
  observer = null;
}

async function bodyOf(body: unknown): Promise<string | null> {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return body;
  return await new Response(body as BodyInit).text();
}

/** Record every way a page can talk to a server; answer the public reads (and, with the Companion, its calls). */
function wireNetwork(companion = false) {
  trace = [];
  stopWatching();
  observer = new MutationObserver(recordMutations);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: URL_ATTRS });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const req = input instanceof Request ? input : null;
    const url = String(req ? req.url : input);
    trace.push({
      via: "fetch",
      method: (init.method ?? req?.method ?? "GET").toUpperCase(),
      url,
      body: await bodyOf(init.body ?? (req ? await req.text() : null)),
      headers: [...new Headers(init.headers ?? req?.headers).entries()].sort(),
    });
    if (url.endsWith("data/snapshot.json")) return new Response(JSON.stringify(recorded), { status: 200 });
    if (url.endsWith("data/translations.json")) return new Response(JSON.stringify(TRANSLATIONS), { status: 200 });
    if (url.endsWith("healthz")) return new Response(JSON.stringify({ companion }), { status: 200 });
    if (companion && url.endsWith("/api/explain")) {
      const explanation = { headline: "Stub explanation", sections: [], sources: [], verified_share: 1, provenance: {} };
      return new Response(JSON.stringify(explanation), { status: 200 });
    }
    if (companion && url.endsWith("/api/factcheck")) return new Response(JSON.stringify({ result: "no_record" }), { status: 200 });
    return new Response("{}", { status: 404 });
  });
  const refuse = (via: string) =>
    class {
      constructor(url?: unknown) {
        trace.push({ via, method: "-", url: String(url ?? ""), body: null, headers: [] });
        throw new Error(`${via} is not used by the app`);
      }
    };
  vi.stubGlobal("XMLHttpRequest", refuse("xhr"));
  vi.stubGlobal("WebSocket", refuse("websocket"));
  vi.stubGlobal("EventSource", refuse("eventsource"));
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: (url: string, data?: unknown) => {
      trace.push({ via: "beacon", method: "POST", url, body: String(data ?? ""), headers: [] });
      return true;
    },
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: async (url: string | URL, options?: RegistrationOptions) => {
        trace.push({ via: "serviceworker", method: "register", url: String(url), body: options ? JSON.stringify(options) : null, headers: [] });
        return {};
      },
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  reloadPulse();
  resetArena();
  setLang("en");
  history.replaceState(null, "", "/");
  wireNetwork();
});

afterEach(() => {
  stopWatching();
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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
const ids = (root: ParentNode, group: string) =>
  [...root.querySelectorAll(`[aria-labelledby="${group}"] a.entry`)].map((a) => a.getAttribute("href"));

/** What a resident may have told this device, in storage, before the app opens. */
type Choices = { home?: string; groups?: string[]; understood?: string[] };

async function openApp(choices: Choices) {
  if (choices.home !== undefined || choices.groups) localStorage.setItem("d2.pulse.v1", JSON.stringify({ home: choices.home ?? null, groups: choices.groups ?? [] }));
  if (choices.understood) {
    const progress = Object.fromEntries(choices.understood.map((id) => [id, { attempts: 1, best: 3, total: 3, understood: true }]));
    localStorage.setItem("d2.arena.v1", JSON.stringify(progress));
  }
  reloadPulse();
  reloadArena();
  const target = document.createElement("div");
  document.body.append(target);
  app = mount(App, { target });
  // What main.ts does in the served build.
  registerServiceWorker();
  await settle();
  // A device with no choices yet opens on the welcome steps; one that chose a place opens on the week.
  expect(target.querySelector(choices.home ? "#week-title" : "[data-testid=welcome]")).toBeTruthy();
  return target;
}

/** Change every choice through the screen, the way a resident would: in the welcome steps on a
 * first visit, on the settings page after that. */
async function changeEverything(target: HTMLElement, companion: boolean) {
  const welcome = !!target.querySelector("[data-testid=welcome]");
  if (welcome) click(buttonText(target, "Next"));
  else {
    click(buttonText(target, "Change"));
    await settle();
  }
  const select = target.querySelector<HTMLSelectElement>("select#home")!;
  for (const value of [CITY, "lu-canton-wiltz", ESCH]) {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
  }
  if (welcome) click(buttonText(target, "Next"));
  const chips = [...target.querySelectorAll<HTMLButtonElement>(".topics button")];
  expect(chips.length).toBeGreaterThan(3);
  for (const chip of chips.slice(0, 4)) click(chip);
  click(buttonText(target, welcome ? "Show my week" : "This week"));
  await settle();
  expect(target.querySelector("#week-title")).toBeTruthy();
  // Open a file from the week and come back, as a resident would.
  click(target.querySelector("a.entry"));
  await settle();
  if (companion) {
    // Use the Companion on the opened file (the same file in every run).
    click(buttonText(target, "Explain it"));
    await settle();
    expect(target.textContent).toContain("Stub explanation");
    const claim = target.querySelector<HTMLTextAreaElement>("form textarea")!;
    claim.value = "Taxes rise next year.";
    claim.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    click(buttonText(target, "Check it"));
    await settle();
  }
  click(buttonText(target, "This week"));
  await settle();
  // Read in another language, then show the original French: neither may reach the network.
  click(buttonText(target, "Settings"));
  await settle();
  click(buttonText(target, "Deutsch"));
  click(buttonText(target, "Diese Woche"));
  await settle();
  expect(target.querySelector("a.entry .title")?.textContent).toMatch(/^DE /);
  click(buttonText(target, "Original zeigen"));
  expect(target.querySelector("a.entry .title")?.textContent).not.toMatch(/^DE /);
}

async function traceFor(choices: Choices, companion = false) {
  // Each run starts as a fresh device: English, nothing translated yet, translations shown.
  setLang("en");
  translations.texts = {};
  translations.original = false;
  wireNetwork(companion);
  const target = await openApp(choices);
  const shown = { concerned: ids(target, "g-concerned"), topics: ids(target, "g-topics") };
  await changeEverything(target, companion);
  stopWatching();
  unmount(app!);
  app = null;
  document.body.innerHTML = "";
  return { requests: trace, shown };
}

describe("Pulse: the network never learns what a resident cares about", () => {
  it.each([
    { companion: false, expected: ["serviceworker register /sw.js", "fetch GET data/snapshot.json", "fetch GET data/translations.json", "fetch GET healthz"] },
    {
      companion: true,
      expected: [
        "serviceworker register /sw.js",
        "fetch GET data/snapshot.json",
        "fetch GET data/translations.json",
        "fetch GET healthz",
        "fetch POST /api/explain",
        "fetch POST /api/factcheck",
      ],
    },
  ])("makes exactly the same requests whatever the resident chose (Companion: $companion)", async ({ companion, expected }) => {
    const none = await traceFor({}, companion);
    const esch = await traceFor({ home: ESCH, groups: ["money"], understood: ["lu.esch.42063"] }, companion);
    const city = await traceFor({ home: CITY, groups: ["housing", "money"], understood: ["lu.chd.8752", "lu.esch.42090"] }, companion);
    const canton = await traceFor({ home: "lu-canton-clervaux", groups: ["culture"] }, companion);

    // The spy works: the public list was fetched, and nothing but public reads (and, with the
    // Companion, the resident's own clicks on the opened file) happened.
    expect(none.requests.map((r) => `${r.via} ${r.method} ${r.url}`)).toEqual(expected);
    for (const r of none.requests) if (r.method !== "POST") expect(r.body).toBeNull();

    // The choices took effect on screen...
    expect(esch.shown.concerned).toContain("#esch.42063");
    expect(city.shown.concerned).toEqual(["#8752"]);
    expect(city.shown.topics).toEqual(["#esch.42060", "#esch.42063", "#esch.42090", "#esch.42093"]);
    expect(esch.shown).not.toEqual(city.shown);

    // ...and the network saw the same thing every time.
    expect(esch.requests).toEqual(none.requests);
    expect(city.requests).toEqual(none.requests);
    expect(canton.requests).toEqual(none.requests);

    // No request carries a place, a topic or a file the resident cares about.
    const sent = JSON.stringify([esch.requests, city.requests, canton.requests]);
    for (const secret of [ESCH, CITY, "lu-canton", "Budget", "urbain", "Commission", "money", "housing", "42063", "d2.pulse"]) expect(sent).not.toContain(secret);
  });
});

describe("This week (Pulse view)", () => {
  function show(lang: "en" | "fr" | "de" | "lb" | "pt" = "en") {
    setLang(lang);
    const target = document.createElement("div");
    document.body.append(target);
    app = mount(Week, { target, props: { items: SNAPSHOT.items, week: { id: "2026-W40", start: "2026-09-28", end: "2026-10-04" }, onopen: () => {}, onall: () => {}, onsettings: () => {} } });
    flushSync();
    return target;
  }

  /** The settings page, where the place and the topics are chosen. */
  function showSettings() {
    const target = document.createElement("div");
    document.body.append(target);
    const settings = mount(Settings, { target, props: { items: SNAPSHOT.items } });
    flushSync();
    return { target, close: () => unmount(settings) };
  }

  it("asks where the resident lives in one line, and says the choices stay on the device", () => {
    const target = show();
    expect(target.querySelector("[data-testid=week-summary]")?.textContent).toContain("Choose where you live to see your files first.");
    expect(buttonText(target, "Set up")).toBeTruthy();
    // The long setup sheet is gone from the page: no place picker, no topic chips.
    expect(target.querySelector("select")).toBeNull();
    expect(target.querySelector("[data-testid=week-private]")?.textContent).toContain("Your choices stay on this device.");
    expect(target.querySelector("#g-concerned")).toBeNull();
    // Without a place, files on followed topics still show; panels are explained, never faked.
    expect(target.querySelector("#g-panels")?.parentElement?.textContent).toContain("Panels have not started yet.");
    expect(target.textContent).toContain("you will decide up to 5 files a week yourself");
  });

  it("saves choices on this device only and shows the week for them", () => {
    const settings = showSettings();
    const select = settings.target.querySelector<HTMLSelectElement>("select#home")!;
    // Communes first, then cantons for communes Charter does not list yet; never a raw id.
    const labels = [...select.options].map((o) => o.textContent ?? "");
    expect(labels.slice(0, 3)).toEqual(["Choose…", "Esch-sur-Alzette", "Luxembourg City"]);
    expect(labels).toContain("Another commune: Wiltz canton");
    expect(labels.join(" ")).not.toMatch(/lu-/);

    select.value = ESCH;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    // Topics are plain groups in the resident's language, never the published committee names.
    expect(settings.target.textContent).not.toContain("Commission");
    click(buttonText(settings.target, "Money and budget"));
    expect(JSON.parse(localStorage.getItem("d2.pulse.v1")!)).toEqual({ home: ESCH, groups: ["money"], done: true });
    settings.close();

    const target = show();
    expect(target.querySelector("select")).toBeNull();
    expect(target.textContent).toContain("Esch-sur-Alzette");
    expect(target.querySelector("[data-testid=week-summary] dd:last-of-type")?.textContent).toBe("1");
    expect(target.textContent).toContain("Files of Esch-sur-Alzette and of the bodies that cover it");
    expect(target.textContent, "no placeholder left unfilled").not.toMatch(/\{\w+\}/);
    expect(ids(target, "g-concerned")).toEqual(["#8752", "#esch.42052", "#esch.42060", "#esch.42063", "#esch.42071", "#esch.42090", "#esch.42093"]);
    // "Money and budget" covers both the Esch theme and the Chamber committee on finances.
    expect(target.querySelectorAll('[aria-labelledby="g-concerned"] [data-tag=topic]')).toHaveLength(4);
    expect(target.querySelector('[aria-labelledby="g-concerned"] a.entry')?.textContent).toContain("Updated on 30 September 2026");

    const again = showSettings();
    click(buttonText(again.target, "Forget my choices"));
    expect(again.target.textContent).toContain("Your choices on this device were forgotten.");
    // The welcome steps are not shown again: the resident chose to forget, not to start over.
    expect(JSON.parse(localStorage.getItem("d2.pulse.v1")!)).toEqual({ home: null, groups: [], done: true });
    expect(pulse.prefs).toEqual({ home: null, groups: [], done: true });
    again.close();
  });

  it("works when storage is blocked, and ignores saved values it does not know", () => {
    localStorage.setItem("d2.pulse.v1", JSON.stringify({ home: "lu-commune-nowhere", groups: ["money", "nope", 3, "money"] }));
    reloadPulse();
    expect(pulse.prefs).toEqual({ home: null, groups: ["money"], done: false });
    // What a device saved before groups existed: the published names fall into their groups.
    localStorage.setItem("d2.pulse.v1", JSON.stringify({ home: ESCH, topics: ["Budget et Finances", "Commission de la Mobilité et des Travaux publics"] }));
    reloadPulse();
    expect(pulse.prefs).toEqual({ home: ESCH, groups: ["money", "transport"], done: true });
    localStorage.setItem("d2.pulse.v1", "{not json");
    reloadPulse();
    expect(pulse.prefs).toEqual({ home: null, groups: [], done: false });

    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    vi.stubGlobal("localStorage", blocked);
    reloadPulse();
    const settings = showSettings();
    const select = settings.target.querySelector<HTMLSelectElement>("select#home")!;
    select.value = CITY;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    settings.close();
    const target = show();
    expect(ids(target, "g-concerned")).toEqual(["#8752"]);
  });

  it("is written in all five languages", () => {
    const keys = Object.keys(DICTS.en).filter((k) => /^(week|welcome|settings|topic|theme)_/.test(k));
    expect(keys.length).toBeGreaterThan(60);
    for (const lang of ["fr", "de", "lb", "pt"] as const) {
      for (const k of keys) {
        const text = DICTS[lang][k as keyof typeof DICTS.en];
        expect(text, `${lang}.${k}`).toBeTruthy();
        // Same placeholders as English.
        expect(text.match(/\{\w+\}/g) ?? [], `${lang}.${k}`).toEqual(DICTS.en[k as keyof typeof DICTS.en].match(/\{\w+\}/g) ?? []);
      }
      const target = show(lang);
      expect(target.querySelector("[data-testid=week-private]")?.textContent).toContain(DICTS[lang].week_private_short);
      unmount(app!);
      app = null;
      document.body.innerHTML = "";
    }
  });
});
