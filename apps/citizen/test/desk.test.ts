// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import DeskIdeas from "../src/components/DeskIdeas.svelte";
import DeskRecord from "../src/components/DeskRecord.svelte";
import Feedback from "../src/components/Feedback.svelte";
import Procedures from "../src/components/Procedures.svelte";
import Votes from "../src/components/Votes.svelte";
import { currentStage, localizedText, RemoteDesk, shares, type DeskClient, type Fingerprints, type FeedbackLookup, type Idea, type Procedure, type ProcedureDetail, type Round, type RoundDetail } from "../src/lib/desk.ts";
import { CompanionFailure } from "../src/lib/errors.ts";
import { prefs } from "../src/lib/prefs.ts";
import { setLang } from "../src/lib/ui.svelte.ts";

const NOW = Date.parse("2026-10-06T12:00:00Z");

/* Seed-like data, with ids shaped as the desk makes them (16 letters and digits). */
const PROC_ID = "01j9x3k7m2p4q6r8";
const PROC2_ID = "01j9x3k7m2p4q6r9";
const IDEA_ID = "7q8r9s0t1v2w3x4y";
const IDEA2_ID = "7q8r9s0t1v2w3x4z";
const ROUND_ID = "b2c3d4e5f6g7h8j9";
const ROUND2_ID = "b2c3d4e5f6g7h8k0";
const ANSWER_ID = "m1n2p3q4r5s6t7v8";
const UPDATE_ID = "w9x0y1z2a3b4c5d6";
const ALL_IDS = [PROC_ID, PROC2_ID, IDEA_ID, IDEA2_ID, ROUND_ID, ROUND2_ID, ANSWER_ID, UPDATE_ID];
const ID_LIKE = /\b[0-9a-hj-kmnp-tv-z]{16}\b/;

const RUE: Procedure = {
  id: PROC_ID,
  kind: "project",
  status: "done",
  title: { fr: "Réfection de la rue de l'Exemple", en: "Resurfacing of rue de l'Exemple" },
  body: { fr: "Exemple fictif.", en: "Made-up example. New surface and pavements." },
  owner: "Service Voirie (exemple)",
  stages: [
    { name: { fr: "Travaux", en: "Works" }, planned: "2026-05-04", done: "2026-09-12" },
    { name: { fr: "Réception", en: "Handover" }, planned: "2026-09-30", done: "2026-09-25" },
  ],
  links: [{ label: "esch.lu", url: "https://esch.lu" }],
  started_on: "2026-05-04",
  due_on: "2026-09-30",
  created_at: "2026-05-01T08:00:00.000Z",
  updated_at: "2026-09-25T08:00:00.000Z",
  verdicts: { done: 4, needs_work: 1, not_done: 0 },
};
const BUDGET: Procedure = {
  ...RUE,
  id: PROC2_ID,
  kind: "budget",
  status: "in_progress",
  title: { fr: "Budget participatif 2026 (exemple)", en: "Participatory budget 2026 (example)" },
  stages: [
    { name: { en: "Call for projects" }, planned: "2026-03-01", done: "2026-04-30" },
    { name: { en: "Shortlist" }, planned: "2026-06-15", done: "2026-06-20" },
    { name: { en: "Residents' vote" }, planned: "2026-10-20" },
    { name: { en: "Delivery" }, planned: "2026-12-15" },
  ],
  verdicts: { done: 0, needs_work: 0, not_done: 0 },
};
const RUE_DETAIL: ProcedureDetail = {
  ...RUE,
  updates: [{ id: UPDATE_ID, at: "2026-09-25T09:00:00.000Z", text: { en: "Works finished and signed off on 25 September." }, status_after: "done" }],
  my_verdict: null,
  answers: [{ id: ANSWER_ID, category: "roads", lang: "fr", summary: "Plaque d'égout qui bouge", answer: "Merci. L'entreprise repasse la semaine prochaine.", answered_at: "2026-09-28T09:00:00.000Z" }],
  ideas: [{ id: IDEA2_ID, title: "Des bancs le long de l'Alzette", lang: "fr", status: "taken_up" }],
};
const BENCHES: Idea = {
  id: IDEA_ID,
  lang: "fr",
  title: "Des bancs le long de l'Alzette (exemple)",
  text: "Entre le pont et le parc il n'y a aucun endroit pour s'asseoir.",
  status: "taken_up",
  procedure_id: PROC2_ID,
  answer: { fr: "Idée reprise: six bancs sont commandés.", en: "Taken up: six benches are ordered." },
  answered_at: "2026-09-20T09:00:00.000Z",
  created_at: "2026-10-01T09:00:00.000Z",
  supporters: 14,
  supported: false,
  mine: false,
  answers: [],
};
const BIKES: Idea = { ...BENCHES, id: IDEA2_ID, lang: "lb", title: "Méi Vëlosbéigel bei der Gare", text: "Moies sinn all Béigel voll.", status: "open", procedure_id: null, answer: null, answered_at: null, supporters: 9, created_at: "2026-10-05T09:00:00.000Z" };
const PARK: Round = {
  id: ROUND_ID,
  question: { fr: "Que faire de l'ancien kiosque ?", en: "What should become of the old bandstand?" },
  detail: { en: "Three options fit the current budget." },
  options: [{ en: "Restore it as a stage" }, { en: "Turn it into a shelter" }, { en: "Take it down and plant trees" }],
  status: "open",
  about_kind: "procedure",
  about_id: PROC2_ID,
  opens_at: "2026-10-01T00:00:00.000Z",
  closes_at: "2026-11-30T23:00:00.000Z",
  result: null,
  ballots_so_far: 7,
};
const MARKET: Round = {
  ...PARK,
  id: ROUND2_ID,
  question: { en: "The Saturday market: place de l'Exemple or the station?" },
  detail: {},
  options: [{ en: "Place de l'Exemple" }, { en: "In front of the station" }],
  status: "published",
  closes_at: "2026-09-30T23:00:00.000Z",
  result: { counts: [6, 3], ballots: 9, voters: 9, tallied_at: "2026-10-01T00:00:00.000Z" },
  ballots_so_far: null,
};
const LOOKUP: FeedbackLookup = {
  code: "k7m2p4q6",
  status: "answered",
  category: "roads",
  lang: "fr",
  text: "La plaque d'égout devant le n° 12 bouge.",
  about_kind: "procedure",
  about_id: PROC_ID,
  answer: "Merci. L'entreprise repasse la semaine prochaine.",
  answered_at: "2026-09-28T09:00:00.000Z",
  created_at: "2026-09-26T09:00:00.000Z",
};

const DESK_KEY = "cracia.example/desk+0359480b+AcmnaIVEUPKKWoLQTSirbvfV4h6hZdgFTrjS6g40yKjN";
const RECORD: Fingerprints = {
  enabled: true,
  key: DESK_KEY,
  days: [
    { day: "2026-10-07", size: 73, root: "c3ElVZbx2fJQx8i1n9mxYcdxB0Y3W0tG8b2xS1JmNjk=", signed_at: "2026-10-07T00:00:12.000Z", note: "n1", ots: "AE9w" },
    { day: "2026-10-08", size: 1280, root: "VcDqouuhF6x6xEe2JEKlx0vBHLDwEVMHSQOiOMk2wVE=", signed_at: "2026-10-08T00:00:12.000Z", note: "n2", ots: null },
  ],
};

/** A desk that answers from the fixtures and records every write. */
class FakeDesk implements DeskClient {
  signed: boolean;
  record: Fingerprints = RECORD;
  calls: { what: string; args: unknown[] }[] = [];
  myBallot: number | null = null;
  constructor(signed = false) {
    this.signed = signed;
  }
  private note(what: string, ...args: unknown[]) {
    this.calls.push({ what, args });
  }
  signedIn() {
    return this.signed;
  }
  async enrol(code: string) {
    this.note("enrol", code);
    if (code !== "abcd-efgh-jkmn") throw new Error("unknown code");
    this.signed = true;
  }
  signOut() {
    this.signed = false;
  }
  async procedures() {
    return [BUDGET, RUE];
  }
  async procedure(id: string) {
    if (id !== PROC_ID) throw new CompanionFailure("not_found");
    return RUE_DETAIL;
  }
  async verdict(id: string, verdict: "done" | "needs_work" | "not_done") {
    this.note("verdict", id, verdict);
    return { verdicts: { ...RUE.verdicts, [verdict]: RUE.verdicts[verdict] + 1 }, my_verdict: verdict };
  }
  async ideas() {
    return [BENCHES, BIKES];
  }
  async postIdea(input: { lang: "lb" | "fr" | "de" | "en" | "pt"; title: string; text: string }) {
    this.note("postIdea", input);
    return { ...BIKES, id: "n3w1d3a4b5c6d7e8", lang: input.lang, title: input.title, text: input.text, supporters: 0, mine: true, status: "open" as const };
  }
  async support(id: string, on: boolean) {
    this.note("support", id, on);
    const idea = id === IDEA_ID ? BENCHES : BIKES;
    return { ...idea, supported: on, supporters: idea.supporters + (on ? 1 : -1) };
  }
  async feedback(input: unknown) {
    this.note("feedback", input);
    return { code: "k7m2p4q6", status: "new" as const, created_at: "2026-10-06T12:00:00.000Z" };
  }
  async lookup(code: string) {
    this.note("lookup", code);
    if (code !== LOOKUP.code) throw new CompanionFailure("not_found");
    return LOOKUP;
  }
  async rounds() {
    return [PARK, MARKET];
  }
  async round(id: string): Promise<RoundDetail> {
    this.note("round", id);
    return { ...PARK, my_ballot: this.myBallot === null ? null : { option: this.myBallot, at: "2026-10-05T09:00:00.000Z" } };
  }
  async ballot(id: string, option: number) {
    this.note("ballot", id, option);
    this.myBallot = option;
    return { option };
  }
  async fingerprints() {
    return this.record;
  }
}

let app: Record<string, unknown> | null = null;
afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  prefs.setDeskToken(null);
});

const settle = async () => {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
};

async function show<P extends Record<string, unknown>>(Component: unknown, props: P, lang: "en" | "fr" | "lb" | "de" | "pt" = "en") {
  setLang(lang);
  const target = document.createElement("div");
  document.body.append(target);
  app = mount(Component as never, { target, props: { now: () => NOW, ...props } as never });
  flushSync();
  await settle();
  return target;
}

const click = (el: Element | null | undefined) => {
  (el as HTMLButtonElement).click();
  flushSync();
};

describe("Procedures page", () => {
  it("lists procedures by status with their own stage track, and opens the detail with updates, answers, linked ideas", async () => {
    const desk = new FakeDesk();
    const target = await show(Procedures, { client: desk });
    const groups = [...target.querySelectorAll(".group")].map((g) => g.getAttribute("data-status"));
    expect(groups).toEqual(["in_progress", "done"]);
    const budget = target.querySelector("[data-status=in_progress] .proc")!;
    expect(budget.textContent).toContain("Participatory budget 2026 (example)");
    expect(budget.textContent).toContain("Budget");
    const pips = [...budget.querySelectorAll(".track li")];
    expect(pips).toHaveLength(4);
    expect(pips.map((p) => [...p.classList].filter((c) => !c.startsWith("svelte-")).join(" "))).toEqual(["done", "done", "now", ""]);
    expect(pips[2].textContent).toContain("Residents' vote");
    const rue = target.querySelector("[data-status=done] .proc")!;
    expect(rue.textContent).toContain("Done 4 · Needs work 1 · Not done 0");

    click(rue);
    await settle();
    const detail = target.querySelector("[data-state=detail]")!;
    expect(detail.querySelector(".title")?.textContent).toBe("Resurfacing of rue de l'Exemple");
    expect(detail.textContent).toContain("Service Voirie (exemple)");
    expect(detail.querySelector("[data-state=updates]")?.textContent).toContain("Works finished and signed off on 25 September.");
    expect(detail.querySelector("[data-state=updates]")?.textContent).toContain("25 September 2026");
    expect(detail.querySelector("[data-state=answers]")?.textContent).toContain("L'entreprise repasse la semaine prochaine.");
    expect(detail.querySelector("[data-state=linked-ideas]")?.textContent).toContain("Des bancs le long de l'Alzette");
    expect(detail.querySelector("[data-state=linked-ideas]")?.textContent).toContain("Taken up");
    expect([...detail.querySelectorAll(".track.dated li")].map((l) => l.textContent?.replace(/\s+/g, " ").trim())).toEqual(["Works Done 12 September 2026", "Handover Done 25 September 2026"]);
    expect(detail.querySelector("a")?.getAttribute("href")).toBe("https://esch.lu");
  });

  it("shows the verdict buttons with counts on a finished procedure, asks for the code first, then sends the verdict", async () => {
    const desk = new FakeDesk();
    const target = await show(Procedures, { client: desk });
    click(target.querySelector("[data-status=done] .proc"));
    await settle();
    const buttons = [...target.querySelectorAll("[data-state=verdict] button[data-verdict]")];
    expect(buttons.map((b) => b.textContent?.replace(/\s+/g, " ").trim())).toEqual(["Done 4", "Needs work 1", "Not done 0"]);

    click(buttons[1]);
    await settle();
    expect(desk.calls).toEqual([]);
    const sheet = target.querySelector("[data-state=signin]")!;
    expect(sheet.textContent).toContain("Enter the code the commune gave you");
    const input = sheet.querySelector("input")!;
    input.value = "abcd-efgh-jkmn";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    sheet.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    await settle();
    expect(desk.calls.map((c) => [c.what, ...c.args])).toEqual([
      ["enrol", "abcd-efgh-jkmn"],
      ["verdict", PROC_ID, "needs_work"],
    ]);
    expect(target.querySelector("[data-state=signin]")).toBeNull();
    const pressed = target.querySelector("[data-state=verdict] button[aria-pressed=true]")!;
    expect(pressed.getAttribute("data-verdict")).toBe("needs_work");
    expect(pressed.textContent?.replace(/\s+/g, " ").trim()).toBe("Needs work 2");
    expect(target.textContent).toContain("That is your answer. You can change it.");
  });

  it("shows no verdict buttons on a procedure still in progress, and says when the desk is unavailable", async () => {
    const desk = new FakeDesk(true);
    desk.procedure = async () => ({ ...RUE_DETAIL, status: "in_progress" });
    let target = await show(Procedures, { client: desk });
    click(target.querySelector("[data-status=in_progress] .proc"));
    await settle();
    expect(target.querySelector("[data-state=verdict]")).toBeNull();
    unmount(app!);
    app = null;

    desk.procedures = () => Promise.reject(new CompanionFailure("unavailable"));
    target = await show(Procedures, { client: desk });
    expect(target.querySelector("[data-state=unavailable]")?.textContent).toContain("The commune's desk is unavailable right now.");
    expect(target.querySelector("[data-state=list]")).toBeNull();
  });
});

describe("Ideas on the desk", () => {
  it("lists ideas with status, support counts and the commune's answer, in the reader's language", async () => {
    const target = await show(DeskIdeas, { client: new FakeDesk() }, "fr");
    const cards = [...target.querySelectorAll("[data-state=list] > li")];
    expect(cards.map((c) => c.getAttribute("data-status"))).toEqual(["taken_up", "open"]);
    expect(cards[0].querySelector("h3")?.textContent).toBe("Des bancs le long de l'Alzette (exemple)");
    expect(cards[0].querySelector(".tag")?.textContent).toBe("Reprise");
    expect(cards[0].querySelector(".support")?.textContent).toBe("14 soutiens");
    expect(cards[0].querySelector("[data-state=answer]")?.textContent).toContain("Idée reprise: six bancs sont commandés.");
    expect(cards[1].querySelector("h3")?.getAttribute("lang")).toBe("lb");
    expect(cards[1].querySelector("[data-action=support]")?.textContent?.trim()).toBe("Soutenir");
  });

  it("asks for the enrolment code before posting, then posts the idea with language, title and text", async () => {
    const desk = new FakeDesk();
    const target = await show(DeskIdeas, { client: desk });
    expect(target.querySelector("[data-state=signin]")).toBeNull();
    click(target.querySelector("[data-state=compose] button"));
    const form = target.querySelector("[data-state=compose] form")!;
    const set = (el: Element | null, value: string) => {
      (el as HTMLInputElement).value = value;
      el!.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set(form.querySelector("input"), "Later opening of the library");
    set(form.querySelector("textarea"), "Opening until 20:00 one evening a week would help.");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(desk.calls).toEqual([]);
    const sheet = target.querySelector("[data-state=signin]")!;
    expect(sheet.textContent).toContain("Enter the code the commune gave you");
    expect(sheet.textContent).toContain("Posting and supporting ideas need the enrolment code the commune gave you.");

    set(sheet.querySelector("input"), "abcd-efgh-jkmn");
    sheet.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    await settle();
    expect(desk.calls.map((c) => c.what)).toEqual(["enrol", "postIdea"]);
    expect(desk.calls[1].args[0]).toEqual({ lang: "en", title: "Later opening of the library", text: "Opening until 20:00 one evening a week would help." });
    expect(target.querySelector("[data-state=posted]")?.textContent).toBe("Your idea is posted.");
    const first = target.querySelector("[data-state=list] > li")!;
    expect(first.querySelector("h3")?.textContent).toBe("Later opening of the library");
    expect(first.textContent).toContain("Your idea");
    expect(first.querySelector("[data-action=support]")).toBeNull(); // never your own
  });

  it("supports and withdraws with one call each when signed in, and refuses a wrong code", async () => {
    const desk = new FakeDesk(true);
    const target = await show(DeskIdeas, { client: desk });
    const button = target.querySelectorAll("[data-state=list] > li")[1].querySelector("[data-action=support]")!;
    click(button);
    await settle();
    expect(desk.calls.map((c) => [c.what, ...c.args])).toEqual([["support", IDEA2_ID, true]]);
    const pressed = target.querySelectorAll("[data-state=list] > li")[1].querySelector("[data-action=support]")!;
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    expect(pressed.textContent?.trim()).toBe("Supported");
    expect(target.querySelectorAll("[data-state=list] > li")[1].querySelector(".support")?.textContent).toBe("10 supporters");
    click(pressed);
    await settle();
    expect(desk.calls.at(-1)).toEqual({ what: "support", args: [IDEA2_ID, false] });
    unmount(app!);
    app = null;

    const anon = new FakeDesk();
    const again = await show(DeskIdeas, { client: anon });
    click(again.querySelectorAll("[data-state=list] > li")[1].querySelector("[data-action=support]"));
    const sheet = again.querySelector("[data-state=signin]")!;
    const input = sheet.querySelector("input")!;
    input.value = "wrong";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    sheet.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(sheet.textContent).toContain("That code is not valid or was already used.");
    expect(anon.calls.map((c) => c.what)).toEqual(["enrol"]);
  });
});

describe("Feedback page", () => {
  it("files a message with no sign-in and shows the lookup code big in mono", async () => {
    const desk = new FakeDesk();
    const target = await show(Feedback, { client: desk, about: { about: { kind: "procedure", id: PROC_ID }, title: "Resurfacing of rue de l'Exemple" } });
    expect(target.querySelector("[data-state=about]")?.textContent).toContain("Resurfacing of rue de l'Exemple");
    const form = target.querySelector("[data-state=form]")!;
    const textarea = form.querySelector("textarea")!;
    textarea.value = "The manhole cover in front of number 12 moves.";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const select = form.querySelector("select")!;
    select.value = "roads";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(desk.calls).toEqual([{ what: "feedback", args: [{ lang: "en", text: "The manhole cover in front of number 12 moves.", category: "roads", about: { kind: "procedure", id: PROC_ID } }] }]);
    const code = target.querySelector("[data-state=sent] .code")!;
    expect(code.textContent).toBe("k7m2p4q6");
    expect(code.classList.contains("mono")).toBe(true);
    expect(target.querySelector("[data-state=form]")).toBeNull();
  });

  it("looks a message up by its code and shows its status and answer, or says there is none", async () => {
    const desk = new FakeDesk();
    const target = await show(Feedback, { client: desk });
    const lookup = target.querySelector("[data-state=lookup]")!;
    const input = lookup.querySelector("input")!;
    input.value = " k7m2p4q6 ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    lookup.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(desk.calls).toEqual([{ what: "lookup", args: ["k7m2p4q6"] }]);
    const found = target.querySelector("[data-state=found]")!;
    expect(found.querySelector(".tag")?.textContent).toBe("Answered");
    expect(found.textContent).toContain("La plaque d'égout devant le n° 12 bouge.");
    expect(found.textContent).toContain("Merci. L'entreprise repasse la semaine prochaine.");
    expect(found.textContent).toContain("Sent on 26 September 2026");

    input.value = "nothere1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    lookup.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(target.querySelector("[data-state=found]")).toBeNull();
    expect(target.querySelector("[data-state=lookup-failed]")?.textContent).toBe("No message with that code.");
  });
});

describe("Votes page", () => {
  it("shows open questions without counts and published ones with a tally per option", async () => {
    const target = await show(Votes, { client: new FakeDesk() });
    const open = target.querySelector("[data-state=open] > li")!;
    expect(open.querySelector(".q")?.textContent).toBe("What should become of the old bandstand?");
    expect([...open.querySelectorAll("[data-option]")].map((b) => b.textContent?.trim())).toEqual(["Restore it as a stage", "Turn it into a shelter", "Take it down and plant trees"]);
    expect(open.textContent).toContain("Open until 1 December 2026");
    expect(open.textContent).toContain("7 residents have voted so far.");
    expect(open.querySelector("[data-state=tally]")).toBeNull();
    expect(open.querySelector("[aria-pressed=true]")).toBeNull();

    const published = target.querySelector("[data-state=closed] > li")!;
    expect(published.getAttribute("data-status")).toBe("published");
    const rows = [...published.querySelectorAll("[data-state=tally] > li")];
    expect(rows.map((r) => r.querySelector(".n")?.textContent)).toEqual(["6", "3"]);
    expect(rows.map((r) => r.querySelector(".pct")?.textContent)).toEqual(["67 %", "33 %"]);
    expect(rows.map((r) => (r.querySelector(".fill") as HTMLElement).style.width)).toEqual(["67%", "33%"]);
    expect(published.textContent).toContain("9 residents voted.");
  });

  it("asks for the code before a ballot, then sends the option, and lets a signed-in resident change it", async () => {
    const desk = new FakeDesk();
    const target = await show(Votes, { client: desk });
    click(target.querySelector("[data-option='1']"));
    expect(target.querySelector("[data-state=signin]")?.textContent).toContain("Voting on a question needs the enrolment code the commune gave you.");
    const sheet = target.querySelector("[data-state=signin]")!;
    const input = sheet.querySelector("input")!;
    input.value = "abcd-efgh-jkmn";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    sheet.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    await settle();
    expect(desk.calls.map((c) => [c.what, ...c.args])).toEqual([
      ["enrol", "abcd-efgh-jkmn"],
      ["ballot", ROUND_ID, 1],
    ]);
    expect(target.querySelector("[data-option='1']")?.getAttribute("aria-pressed")).toBe("true");
    expect(target.querySelector("[data-state=cast]")?.textContent).toContain("Your ballot is in.");

    click(target.querySelector("[data-option='2']"));
    await settle();
    expect(desk.calls.at(-1)).toEqual({ what: "ballot", args: [ROUND_ID, 2] });
    expect(target.querySelector("[data-option='1']")?.getAttribute("aria-pressed")).toBe("false");
    expect(target.querySelector("[data-option='2']")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a signed-in resident's existing ballot as pressed", async () => {
    const desk = new FakeDesk(true);
    desk.myBallot = 0;
    const target = await show(Votes, { client: desk });
    expect(desk.calls).toEqual([{ what: "round", args: [ROUND_ID] }]);
    expect(target.querySelector("[data-option='0']")?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Checking the record page", () => {
  it("shows the latest fingerprint, every day, a copy to keep and the outside check", async () => {
    const target = await show(DeskRecord, { client: new FakeDesk(), origin: "https://cracia.example" });
    const latest = target.querySelector("[data-state=latest]")!;
    expect(latest.querySelector("[data-testid=print]")!.textContent).toBe("VcDq ouuh F6x6 xEe2");
    expect(latest.textContent).toContain("entries on record");
    expect(latest.textContent).toContain("Waiting for its public timestamp.");
    expect(target.querySelectorAll("[data-state=days] li")).toHaveLength(2);
    expect(target.querySelector("[data-state=days] li")!.textContent).toContain("VcDq");
    const command = target.querySelector("[data-testid=command]")!.textContent!;
    expect(command).toContain("--url https://cracia.example/api/desk");
    expect(command).toContain(`--vkey '${DESK_KEY}'`);
    expect(target.textContent).toContain("no names, no messages and no ballots");

    const saved: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => (saved.push(b), "blob:x"), revokeObjectURL: () => {} }));
    click(target.querySelector("[data-testid=save]"));
    const copy = JSON.parse(await saved[0].text());
    expect(copy).toEqual({ enabled: true, key: DESK_KEY, days: RECORD.days.map(({ day, size, note, ots }) => ({ day, size, note, ots })) });
  });

  it("says so when the desk publishes no fingerprint, in the resident's language", async () => {
    const desk = new FakeDesk();
    desk.record = { enabled: false, key: null, days: [] };
    const target = await show(DeskRecord, { client: desk }, "fr");
    expect(target.querySelector("[data-state=off]")!.textContent).toContain("ne publie pas encore");
    expect(target.querySelector("[data-state=latest]")).toBeNull();
  });
});

describe("no raw ids", () => {
  it("shows no desk id on any page, list or detail, in any state", async () => {
    const desk = new FakeDesk(true);
    desk.myBallot = 1;
    const pages: [unknown, Record<string, unknown>][] = [
      [Procedures, { client: desk }],
      [DeskIdeas, { client: desk }],
      [Votes, { client: desk }],
      [Feedback, { client: desk, about: { about: { kind: "idea", id: IDEA_ID }, title: "Des bancs" } }],
    ];
    for (const [page, props] of pages) {
      const target = await show(page, props);
      if (page === Procedures) {
        click(target.querySelector("[data-status=done] .proc"));
        await settle();
        expect(target.querySelector("[data-state=detail]")).not.toBeNull();
      }
      if (page === Feedback) {
        const input = target.querySelector<HTMLInputElement>("[data-state=lookup] input")!;
        input.value = "k7m2p4q6";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        target.querySelector("[data-state=lookup]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await settle();
        expect(target.querySelector("[data-state=found]")).not.toBeNull();
      }
      const text = document.body.textContent ?? "";
      for (const id of ALL_IDS) expect(text, id).not.toContain(id);
      expect(text).not.toMatch(ID_LIKE);
      unmount(app!);
      app = null;
      document.body.innerHTML = "";
    }
  });
});

describe("RemoteDesk", () => {
  const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("reads the fingerprints without the resident's token and refuses a malformed answer", async () => {
    prefs.setDeskToken("tok-123");
    const ok = answer(200, { ...RECORD, origin: "cracia.example/desk", days: RECORD.days.map((d) => ({ ...d, note_sha256: "ab" })) });
    vi.stubGlobal("fetch", ok);
    const got = await new RemoteDesk().fingerprints();
    expect(got.days.map((d) => d.size)).toEqual([73, 1280]);
    expect(ok).toHaveBeenCalledWith("/api/desk/fingerprints", expect.objectContaining({ method: "GET", headers: {} }));
    vi.stubGlobal("fetch", answer(200, { enabled: true, days: [{ day: "2026-10-08" }] }));
    await expect(new RemoteDesk().fingerprints()).rejects.toBeInstanceOf(CompanionFailure);
  });

  it("sends the resident token, and the right bodies for a verdict, a ballot, an idea and feedback", async () => {
    prefs.setDeskToken("tok-123");
    const fetchMock = answer(200, { verdicts: { done: 1, needs_work: 0, not_done: 0 }, my_verdict: "done" });
    vi.stubGlobal("fetch", fetchMock);
    const desk = new RemoteDesk();
    await desk.verdict(PROC_ID, "done");
    expect(fetchMock).toHaveBeenCalledWith(`/api/desk/procedures/${PROC_ID}/verdict`, expect.objectContaining({ method: "POST", headers: { authorization: "Resident tok-123", "content-type": "application/json" }, body: JSON.stringify({ verdict: "done" }) }));

    const ballot = answer(201, { option: 2, seq: 8 });
    vi.stubGlobal("fetch", ballot);
    expect(await desk.ballot(ROUND_ID, 2)).toEqual({ option: 2, seq: 8 });
    expect(ballot).toHaveBeenCalledWith(`/api/desk/rounds/${ROUND_ID}/ballots`, expect.objectContaining({ method: "POST", body: JSON.stringify({ option: 2 }) }));

    const support = answer(200, BIKES);
    vi.stubGlobal("fetch", support);
    await desk.support(IDEA2_ID, false);
    expect(support).toHaveBeenCalledWith(`/api/desk/ideas/${IDEA2_ID}/support`, expect.objectContaining({ method: "DELETE" }));

    const filed = answer(201, { code: "k7m2p4q6", status: "new", created_at: "x" });
    vi.stubGlobal("fetch", filed);
    expect((await desk.feedback({ lang: "fr", text: "Bonjour, un problème.", category: null, about: null })).code).toBe("k7m2p4q6");
    expect(filed).toHaveBeenCalledWith("/api/desk/feedback", expect.objectContaining({ body: JSON.stringify({ lang: "fr", text: "Bonjour, un problème." }) }));
  });

  it("enrols with the code, keeps the token on the device, and sends no token before that", async () => {
    const fetchMock = answer(200, { token: "tok-abc", resident_id: "r1" });
    vi.stubGlobal("fetch", fetchMock);
    const desk = new RemoteDesk();
    expect(desk.signedIn()).toBe(false);
    await desk.enrol("abcd-efgh-jkmn");
    expect(fetchMock).toHaveBeenCalledWith("/api/desk/enrol", expect.objectContaining({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "abcd-efgh-jkmn" }) }));
    expect(prefs.deskToken()).toBe("tok-abc");
    expect(desk.signedIn()).toBe(true);
    desk.signOut();
    expect(desk.signedIn()).toBe(false);
  });

  it("maps 429 to busy, 401 and 403 to signin (dropping the token), 404 to not found, 5xx and outages and bad shapes to unavailable", async () => {
    const desk = new RemoteDesk();
    vi.stubGlobal("fetch", answer(429, { error: "slow down" }));
    await expect(desk.procedures()).rejects.toMatchObject({ kind: "busy" });
    prefs.setDeskToken("stale");
    vi.stubGlobal("fetch", answer(401, { error: "an enrolment code is needed for this" }));
    await expect(desk.ideas()).rejects.toMatchObject({ kind: "signin" });
    expect(prefs.deskToken()).toBeNull();
    vi.stubGlobal("fetch", answer(403, { error: "no" }));
    await expect(desk.ballot(ROUND_ID, 0)).rejects.toMatchObject({ kind: "signin" });
    vi.stubGlobal("fetch", answer(404, { error: "no message with that code" }));
    await expect(desk.lookup("zzzzzzzz")).rejects.toMatchObject({ kind: "not_found" });
    for (const [status, body] of [
      [503, { error: "the desk is unavailable" }],
      [500, { error: "x" }],
      [200, { procedures: [{ id: "x" }] }],
      [200, { nope: [] }],
    ] as [number, unknown][]) {
      vi.stubGlobal("fetch", answer(status, body));
      await expect(desk.procedures(), String(status)).rejects.toMatchObject({ kind: "unavailable" });
    }
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await expect(desk.rounds()).rejects.toMatchObject({ kind: "unavailable" });
    // A plain 4xx with the desk's sentence is an ordinary error, not a failure kind.
    vi.stubGlobal("fetch", answer(409, { error: "this vote is not open" }));
    await expect(desk.ballot(ROUND_ID, 0)).rejects.toThrow("this vote is not open");
  });

  it("accepts the seed-shaped lists", async () => {
    const desk = new RemoteDesk();
    vi.stubGlobal("fetch", answer(200, { procedures: [BUDGET, RUE] }));
    expect(await desk.procedures()).toHaveLength(2);
    vi.stubGlobal("fetch", answer(200, { ideas: [BENCHES, BIKES] }));
    expect(await desk.ideas()).toHaveLength(2);
    vi.stubGlobal("fetch", answer(200, { rounds: [PARK, MARKET] }));
    expect(await desk.rounds()).toHaveLength(2);
    vi.stubGlobal("fetch", answer(200, { ...PARK, my_ballot: null }));
    expect((await desk.round(ROUND_ID)).my_ballot).toBeNull();
    vi.stubGlobal("fetch", answer(200, RUE_DETAIL));
    expect((await desk.procedure(PROC_ID)).updates).toHaveLength(1);
  });
});

describe("desk helpers", () => {
  it("picks the reader's language, then a fallback", () => {
    expect(localizedText({ en: "a", fr: "b" }, "pt")).toEqual({ lang: "fr", text: "b" });
    expect(localizedText({ pt: "c" }, "lb")).toEqual({ lang: "pt", text: "c" });
    expect(localizedText({}, "en")).toBeNull();
    expect(localizedText(null, "en")).toBeNull();
  });

  it("finds the current stage and the shares of a tally", () => {
    expect(currentStage(BUDGET.stages)).toBe(2);
    expect(currentStage(RUE.stages)).toBe(1);
    expect(currentStage([])).toBe(-1);
    expect(shares([6, 3])).toEqual([67, 33]);
    expect(shares([0, 0])).toEqual([0, 0]);
  });
});
