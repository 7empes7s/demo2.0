// @vitest-environment jsdom
import type { DocketItem, FactCheckResult, Grade } from "@democracy2/companion";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import FactCheck from "../src/components/FactCheck.svelte";
import { RemoteFactChecker, type FactChecker } from "../src/lib/client.ts";
import { CompanionFailure } from "../src/lib/errors.ts";
import { setLang } from "../src/lib/ui.svelte.ts";

const ITEM = { id: "lu.chd.8752", number: "8752", title: { fr: "Projet de loi 8752" } } as unknown as DocketItem;

const grade = (colour: Grade["grade"], url = "https://www.chd.lu/fr/dossier/8752"): Grade => ({
  claim_id: "claim-0123456789abcdef",
  checker_id: "provenance-match",
  grade: colour,
  evidence: [{ url, source_document_id: null, excerpt: "Dépôt le 15 mai 2026", locator: "history row 1" }],
  model_version: "match/2+docket:0123456789ab",
});

class FakeChecker implements FactChecker {
  calls: { text: string; item?: DocketItem }[] = [];
  constructor(private readonly answer: () => Promise<FactCheckResult>) {}
  check(text: string, item?: DocketItem) {
    this.calls.push({ text, item });
    return this.answer();
  }
}

let app: Record<string, unknown> | null = null;
afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** Mounts the component, types a claim and submits it; resolves once the answer is on screen. */
async function submit(checker: FactChecker, props: Record<string, unknown> = {}, text = "  Déposé le 15 mai 2026 ") {
  setLang("en");
  const target = document.createElement("div");
  document.body.append(target);
  app = mount(FactCheck, { target, props: { checker, ...props } });
  const box = target.querySelector("textarea")!;
  box.value = text;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
  target.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  flushSync();
  const during = target.textContent ?? "";
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
  return { target, during };
}

describe("FactCheck component", () => {
  it.each([
    ["green", "Supported by the documents", "An official document says this."],
    ["yellow", "Unclear, or not in the documents", "The documents neither confirm nor contradict it"],
    ["red", "Contradicted by the documents", "An official document says something different."],
  ] as const)("shows a %s grade with its reason and evidence link", async (colour, label, reason) => {
    const checker = new FakeChecker(async () => ({ result: "graded", grade: grade(colour) }));
    const { target, during } = await submit(checker, { item: ITEM });
    expect(during).toContain("Checking against the documents");
    expect(checker.calls).toEqual([{ text: "Déposé le 15 mai 2026", item: ITEM }]);
    const verdict = target.querySelector("[data-state=graded]")!;
    expect(verdict.getAttribute("data-grade")).toBe(colour);
    expect(verdict.textContent).toContain(label);
    expect(verdict.textContent).toContain(reason);
    expect(verdict.querySelector("q")?.textContent).toBe("Dépôt le 15 mai 2026");
    const link = verdict.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://www.chd.lu/fr/dossier/8752");
    expect(link.getAttribute("rel")).toBe("noopener");
    // Raw ids only under Technical details.
    expect(verdict.querySelector("details")?.textContent).toContain("claim-0123456789abcdef");
    expect(target.querySelector("[data-state=busy]")).toBeNull();
  });

  it("never links evidence that is not a web address", async () => {
    const checker = new FakeChecker(async () => ({ result: "graded", grade: grade("green", "javascript:alert(1)") }));
    const { target } = await submit(checker);
    expect(target.querySelector("[data-state=graded] a")).toBeNull();
  });

  it("says when no document mentions the claim, with no grade", async () => {
    const { target } = await submit(new FakeChecker(async () => ({ result: "no_record" })));
    expect(target.querySelector("[data-state=none]")?.textContent).toBe("No official document mentions this, so it gets no grade.");
    expect(target.querySelector("[data-state=graded]")).toBeNull();
  });

  it("says the checker is unavailable and shows no grade", async () => {
    const { target } = await submit(new FakeChecker(() => Promise.reject(new CompanionFailure("unavailable"))));
    expect(target.querySelector("[data-state=failure]")?.textContent).toMatch(/claim checker is unavailable/);
    expect(target.querySelector("[data-state=graded]")).toBeNull();
    expect(target.textContent).not.toMatch(/Supported|Contradicted|Unclear/);
  });

  it("says when it is busy, and on any other error", async () => {
    let { target } = await submit(new FakeChecker(() => Promise.reject(new CompanionFailure("busy"))));
    expect(target.querySelector("[data-state=failure]")?.textContent).toMatch(/busy/);
    unmount(app!);
    app = null;
    ({ target } = await submit(new FakeChecker(() => Promise.reject(new Error("boom")))));
    expect(target.querySelector("[data-state=failure]")?.textContent).toBe("That didn't work. Try again in a moment.");
  });

  it("does not send an empty claim", async () => {
    const checker = new FakeChecker(async () => ({ result: "no_record" }));
    const { target } = await submit(checker, {}, "   ");
    expect(checker.calls).toHaveLength(0);
    expect(target.querySelector("button")?.disabled).toBe(true);
  });

  it("standalone: has an intro instead of the file heading, caps the claim length, and sends no file", async () => {
    const checker = new FakeChecker(async () => ({ result: "graded", grade: grade("yellow") }));
    const { target } = await submit(checker, { standalone: true });
    expect(target.querySelector("h3")).toBeNull();
    expect(target.textContent).toContain("Paste something you heard");
    expect(target.querySelector("textarea")?.maxLength).toBe(500);
    expect(checker.calls[0].item).toBeUndefined();
  });

  it("speaks the user's language", async () => {
    const checker = new FakeChecker(async () => ({ result: "graded", grade: grade("red") }));
    const { target } = await submit(checker);
    setLang("fr");
    flushSync();
    expect(target.querySelector("[data-state=graded]")?.textContent).toContain("Contredit par les documents");
    setLang("en");
  });
});

describe("RemoteFactChecker", () => {
  const respond = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })));

  it("posts the claim and the file id, and returns a valid grade", async () => {
    const answer = { result: "graded", grade: grade("green") };
    respond(200, answer);
    expect(await new RemoteFactChecker().check("x", ITEM)).toEqual(answer);
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("/api/factcheck");
    expect(JSON.parse(init.body as string)).toEqual({ text: "x", item_id: ITEM.id });
  });

  it("passes through no_record", async () => {
    respond(200, { result: "no_record" });
    expect(await new RemoteFactChecker().check("x")).toEqual({ result: "no_record" });
  });

  it("treats an answer that is not a valid grade as unavailable, never as a grade", async () => {
    for (const body of [{ result: "graded", grade: { ...grade("green"), grade: "blue" } }, { result: "graded", grade: { ...grade("red"), evidence: [] } }, "<html>", {}]) {
      respond(200, body);
      await expect(new RemoteFactChecker().check("x")).rejects.toMatchObject({ kind: "unavailable" });
    }
  });

  it("maps server answers to what the resident sees", async () => {
    for (const [status, kind] of [[503, "unavailable"], [502, "unavailable"], [429, "busy"], [413, "too_long"]] as const) {
      respond(status, { error: "x" });
      await expect(new RemoteFactChecker().check("x")).rejects.toMatchObject({ kind });
    }
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await expect(new RemoteFactChecker().check("x")).rejects.toMatchObject({ kind: "unavailable" });
    respond(400, { error: "claim is empty" });
    await expect(new RemoteFactChecker().check("x")).rejects.not.toBeInstanceOf(CompanionFailure);
  });
});
