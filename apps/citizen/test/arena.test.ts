// @vitest-environment jsdom
import { buildQuiz, textIn } from "@democracy2/arena";
import type { DocketItem } from "@democracy2/companion";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FileList from "../src/components/FileList.svelte";
import Understand from "../src/components/Understand.svelte";
import { arena, progressOf, recordAttempt, reloadArena, resetArena, understoodCount } from "../src/lib/arena.svelte.ts";
import { setLang } from "../src/lib/ui.svelte.ts";
// The recorded Docket snapshot Arena's seed set is checked against (real chd.lu and esch.lu records).
import recorded from "../../../modules/arena/test/fixtures/docket-recorded.json" with { type: "json" };

const SNAPSHOT = recorded as unknown as { items: DocketItem[] };
const ITEMS = SNAPSHOT.items;
const ESCH = ITEMS.find((i) => i.id === "lu.esch.42063")!;
const BILL = ITEMS.find((i) => i.id === "lu.chd.8752")!;

let app: Record<string, unknown> | null = null;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetArena();
  fetchSpy = vi.fn(async () => {
    throw new Error("Arena must not use the network");
  });
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("XMLHttpRequest", class {
    constructor() {
      throw new Error("Arena must not use the network");
    }
  });
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function show(item: DocketItem, lang: "en" | "fr" | "lb" | "pt" = "en", items = ITEMS) {
  setLang(lang);
  const target = document.createElement("div");
  document.body.append(target);
  app = mount(Understand, { target, props: { item, items } });
  flushSync();
  return target;
}

const click = (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  (el as HTMLElement).click();
  flushSync();
};
const button = (target: HTMLElement, text: string) => [...target.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
const options = (target: HTMLElement) => [...target.querySelectorAll<HTMLButtonElement>("button.option")];

/** Answer the first `match.length` questions: `match[i]` picks the option the text supports, otherwise another one. */
function play(target: HTMLElement, item: DocketItem, match: boolean[]) {
  const quiz = buildQuiz(item, ITEMS)!;
  quiz.questions.slice(0, match.length).forEach((q, i) => {
    const right = textIn(q.options.find((o) => o.id === q.answer)!.text, "en").text;
    const opts = options(target);
    const pick = opts.find((b) => (b.textContent ?? "").includes(right) === match[i])!;
    click(pick);
    const verdict = target.querySelector(".verdict")?.textContent;
    expect(verdict).toBe(match[i] ? "That's what the text says." : "The text says something else.");
    // The option the text supports is always shown, with its passage and a link.
    expect(target.querySelector('.option[data-state="text"]')?.textContent).toContain(right);
    expect(target.querySelector("blockquote")?.textContent).toContain(q.evidence[0].quote);
    const link = target.querySelector<HTMLAnchorElement>(".quote a")!;
    expect(q.evidence.map((e) => e.url)).toContain(link.href);
    click(target.querySelector("button.next"));
  });
}

describe("Understand (Arena comprehension questions)", () => {
  it("introduces the questions with the privacy and neutrality notes", () => {
    const target = show(ESCH);
    expect(target.textContent).toContain("5 quick questions");
    expect(target.textContent).toContain("never about what you think of it");
    expect(target.textContent).toContain("Your answers stay on this device. Nothing is sent.");
    expect(button(target, "Start")).toBeTruthy();
    expect(target.querySelector("[data-badge]")).toBeNull();
  });

  it("gives instant feedback with the source passage, then a score; nothing leaves the device", () => {
    const target = show(ESCH);
    click(button(target, "Start"));
    expect(target.querySelector(".count")?.textContent).toBe("Question 1 of 5");
    expect(target.querySelector("h3.prompt")?.textContent).toBe("What did the council decide on in this point?");
    expect(target.querySelector(".origin")).toBeNull();
    play(target, ESCH, [true, false, true, true, true]);
    expect(target.querySelector(".done")?.getAttribute("data-result")).toBe("some");
    expect(target.textContent).toContain("4 of 5 answers match the text");
    expect(target.querySelector("[data-badge]")).toBeNull();
    expect(progressOf(ESCH.id)).toEqual({ attempts: 1, best: 4, total: 5, understood: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks the file understood when every answer matches, and keeps it on this device", () => {
    const target = show(ESCH);
    click(button(target, "Start"));
    play(target, ESCH, [true, true, true, true, true]);
    expect(target.querySelector(".done")?.getAttribute("data-result")).toBe("all");
    expect(target.querySelector('[data-badge="understood"]')?.textContent).toBe("Understood");
    expect(target.querySelector("[data-count]")?.textContent).toBe("Files you've understood: 1");
    const saved = JSON.parse(localStorage.getItem("d2.arena.v1")!);
    expect(saved).toEqual({ [ESCH.id]: { attempts: 1, best: 5, total: 5, understood: true } });
    // What is stored is only per-file counts: no answers, no times, no identifiers of the person.
    expect(Object.keys(saved[ESCH.id]).sort()).toEqual(["attempts", "best", "total", "understood"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lets the resident retake as often as they like, with the answers in a new order", () => {
    const target = show(BILL);
    click(button(target, "Start"));
    const first = options(target).map((b) => b.textContent);
    play(target, BILL, [false, false, false, false, false]);
    expect(target.textContent).toContain("Read the passages again");
    click(button(target, "Try again"));
    expect(target.querySelector(".count")?.textContent).toBe("Question 1 of 5");
    const orders = new Set([first.join("|")]);
    for (let i = 0; i < 4; i++) {
      orders.add(options(target).map((b) => b.textContent).join("|"));
      play(target, BILL, [true, true, true, true, true]);
      click(button(target, "Try again"));
    }
    expect(orders.size).toBeGreaterThan(1);
    expect(progressOf(BILL.id)).toMatchObject({ attempts: 5, best: 5, understood: true });
  });

  it("ignores a second tap once a question is answered", () => {
    const target = show(ESCH);
    click(button(target, "Start"));
    const [a, b] = options(target);
    click(a);
    const state = options(target).map((o) => o.dataset.state);
    click(b);
    expect(options(target).map((o) => o.dataset.state)).toEqual(state);
  });

  it("labels generated questions and says when the answers quote French", () => {
    const target = show(ESCH);
    click(button(target, "Start"));
    play(target, ESCH, [true, true]);
    // Question 3 comes from the rules: options are the official page's own French words.
    expect(target.querySelector("h3.prompt")?.textContent).toBe("How does the official page classify this file?");
    expect(target.textContent).toContain("The answers quote the official text in French.");
    click(options(target)[0]);
    expect(target.querySelector(".origin")?.textContent).toBe("Made automatically from the official page");
  });

  it("shows a hand-written question in the nearest language, and says so", () => {
    const target = show(ESCH, "lb");
    click(button(target, "Lass"));
    expect(target.querySelector("h3.prompt")?.getAttribute("lang")).toBe("de");
    expect(target.textContent).toContain("Nach net an Är Sprooch iwwersat, op Däitsch gewisen.");
    const pt = show(ESCH, "pt");
    click(button(pt, "Começar"));
    expect(pt.querySelector("h3.prompt")?.getAttribute("lang")).toBe("fr");
    expect(pt.textContent).toContain("mostrada em francês");
  });

  it("shows nothing for a file it cannot ask about", () => {
    const target = show({ ...BILL, urls: {} });
    expect(target.innerHTML.trim()).toBe("<!---->");
    expect(target.querySelector("section")).toBeNull();
  });
});

describe("progress on this device", () => {
  it("keeps understood after a weaker retake, and keeps the best score", () => {
    recordAttempt("x", 3, 3);
    expect(recordAttempt("x", 1, 3)).toEqual({ attempts: 2, best: 3, total: 3, understood: true });
    expect(understoodCount()).toBe(1);
  });

  it("starts the best score over when the number of questions changes", () => {
    recordAttempt("x", 3, 3);
    expect(recordAttempt("x", 2, 5)).toEqual({ attempts: 2, best: 2, total: 5, understood: true });
  });

  it("ignores corrupt or tampered storage", () => {
    localStorage.setItem("d2.arena.v1", "{not json");
    reloadArena();
    expect(arena.items).toEqual({});
    localStorage.setItem("d2.arena.v1", JSON.stringify({ a: { attempts: 1, best: 9, total: 3, understood: true }, b: { attempts: 1, best: 1, total: 3, understood: false }, c: "x" }));
    reloadArena();
    expect(Object.keys(arena.items)).toEqual(["b"]);
  });

  it("works when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    reloadArena();
    expect(recordAttempt("y", 2, 2).understood).toBe(true);
    expect(progressOf("y")?.understood).toBe(true);
  });
});

describe("file list", () => {
  it("shows an Understood mark on files understood on this device, and only those", () => {
    setLang("en");
    recordAttempt(ESCH.id, 5, 5);
    recordAttempt(BILL.id, 2, 5);
    const target = document.createElement("div");
    document.body.append(target);
    app = mount(FileList, { target, props: { items: ITEMS, today: "2026-10-06", selected: null, onopen: () => {} } });
    flushSync();
    const marked = [...target.querySelectorAll('[data-badge="understood"]')].map((b) => b.closest("a")?.getAttribute("href"));
    expect(marked).toEqual(["#esch.42063"]);
  });
});
