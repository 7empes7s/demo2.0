// @vitest-environment jsdom
import type { IdeasPage, PublicIdea } from "@democracy2/companion";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import Ideas from "../src/components/Ideas.svelte";
import { RemoteIdeas, type IdeasReader } from "../src/lib/client.ts";
import { CompanionFailure } from "../src/lib/errors.ts";
import { ageOf, pickText, supportKey } from "../src/lib/ideas.ts";
import { setLang } from "../src/lib/ui.svelte.ts";

const NOW = Date.parse("2026-10-06T12:00:00Z");

/** Synthetic ideas, shaped as GET /api/ideas serves them (no pseudonyms). */
const NATIONAL: PublicIdea = {
  id: "01JQ8Z6Y2V3W4X5Y6Z7A8B9C0D",
  jurisdiction_id: "lu",
  topic_ids: ["transport.cycling"],
  title: { en: "Safe cycle lanes on national roads", fr: "Des pistes cyclables sûres" },
  text: { en: "Separate cycle lanes on every national road\nthat crosses a town." },
  created_at: "2026-10-01T09:00:00.000000Z",
  scope_tier: "national",
  charter_version: "0.1.0",
  upvote_count: 12,
};
const LOCAL: PublicIdea = {
  ...NATIONAL,
  id: "01JQ8Z6Y2V3W4X5Y6Z7A8B9C0E",
  jurisdiction_id: "lu-commune-esch-sur-alzette",
  topic_ids: [],
  title: { lb: "Méi Beem an der Uelzechtstrooss" },
  text: { lb: "Beem planzen." },
  created_at: "2026-10-06T08:00:00.000000Z",
  scope_tier: "local",
  upvote_count: null,
};
const ONE: PublicIdea = { ...NATIONAL, id: "01JQ8Z6Y2V3W4X5Y6Z7A8B9C0F", scope_tier: "regional", created_at: "2026-10-05T08:00:00.000000Z", upvote_count: 1 };
const PAGE: IdeasPage = { charter_version: "0.1.0", ideas: [NATIONAL, ONE, LOCAL] };

class FakeReader implements IdeasReader {
  calls = 0;
  constructor(private readonly answer: () => Promise<IdeasPage>) {}
  list() {
    this.calls++;
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

const settle = async () => {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
};

async function show(reader: IdeasReader, lang: "en" | "fr" | "lb" = "en") {
  setLang(lang);
  const target = document.createElement("div");
  document.body.append(target);
  app = mount(Ideas, { target, props: { reader, now: () => NOW } });
  flushSync();
  const during = target.textContent ?? "";
  await settle();
  return { target, during };
}

describe("Ideas view", () => {
  it("lists ideas in the order given, with reach, title, text, support and age", async () => {
    const { target, during } = await show(new FakeReader(async () => PAGE));
    expect(during).toContain("Loading the ideas");
    expect(target.querySelector("[data-state=loading]")).toBeNull();
    const cards = [...target.querySelectorAll("[data-state=list] > li")];
    expect(cards.map((c) => c.getAttribute("data-tier"))).toEqual(["national", "regional", "local"]);

    const [first, second, third] = cards;
    expect(first.querySelector(".reach")?.textContent).toBe("National reach");
    expect(first.querySelector("h3")?.textContent).toBe("Safe cycle lanes on national roads");
    expect(first.querySelector("h3")?.getAttribute("lang")).toBe("en");
    expect(first.querySelector(".text")?.textContent).toBe("Separate cycle lanes on every national road\nthat crosses a town.");
    expect(first.querySelector(".support")?.textContent?.trim()).toBe("12 supporters");
    expect(first.textContent).toContain("Posted 5 days ago");
    expect(second.querySelector(".support")?.textContent?.trim()).toBe("1 supporter");
    expect(second.textContent).toContain("Posted yesterday");
    expect(second.querySelector(".reach")?.textContent).toBe("Regional reach");

    // Hidden during the first day: never a number, never zero.
    expect(third.querySelector(".support")?.getAttribute("data-support")).toBe("hidden");
    expect(third.querySelector(".support")?.textContent?.trim()).toBe("Support count hidden for the first day");
    expect(third.textContent).toContain("Posted today");
    expect(third.querySelector(".reach")?.textContent).toBe("Local reach");
  });

  it("puts raw ids and the Charter version only under Technical details, and shows no pseudonym", async () => {
    const withNym = { ...PAGE, ideas: PAGE.ideas.map((i) => ({ ...i, proposer_nym: "nym-abcdefghijklmnopqrstuvwxyz" })) };
    const { target } = await show(new FakeReader(async () => withNym));
    expect(target.textContent).not.toContain("nym-");
    const card = target.querySelector("[data-state=list] > li")!;
    const details = card.querySelector("details")!;
    expect(details.querySelector("summary")?.textContent).toBe("Technical details");
    expect(details.textContent).toContain("charter_version0.1.0");
    for (const raw of [NATIONAL.id, "transport.cycling", "0.1.0"]) {
      const outside = [...card.childNodes].filter((n) => n !== details).map((n) => n.textContent).join(" ");
      expect(outside, raw).not.toContain(raw);
      expect(details.textContent).toContain(raw);
    }
    const lu = target.querySelectorAll("[data-state=list] > li")[2];
    expect([...lu.childNodes].filter((n) => n.nodeName !== "DETAILS").map((n) => n.textContent).join(" ")).not.toContain("lu-commune");
  });

  it("always says that posting and supporting are not open yet, and offers no way to do either", async () => {
    for (const reader of [new FakeReader(async () => PAGE), new FakeReader(async () => ({ charter_version: "0.1.0", ideas: [] })), new FakeReader(() => Promise.reject(new CompanionFailure("unavailable")))]) {
      const { target } = await show(reader);
      expect(target.querySelector("[data-state=closed]")?.textContent?.trim()).toBe("Posting and supporting ideas opens once secure sign-in is ready. Until then you can read them here.");
      expect(target.querySelector("form, textarea, input")).toBeNull();
      expect([...target.querySelectorAll("button")].map((b) => b.textContent)).toEqual(target.querySelector("[data-state=unavailable]") ? ["Try again"] : []);
      unmount(app!);
      app = null;
      document.body.innerHTML = "";
    }
  });

  it("shows the empty state when the queue is empty", async () => {
    const { target } = await show(new FakeReader(async () => ({ charter_version: "0.1.0", ideas: [] })));
    expect(target.querySelector("[data-state=empty]")?.textContent?.trim()).toBe("No ideas have been posted yet.");
    expect(target.querySelector("[data-state=list]")).toBeNull();
    expect(target.querySelector("[data-state=unavailable]")).toBeNull();
  });

  it("says the list is unavailable, shows no ideas, and can try again", async () => {
    let fail = true;
    const reader = new FakeReader(() => (fail ? Promise.reject(new CompanionFailure("unavailable")) : Promise.resolve(PAGE)));
    const { target } = await show(reader);
    expect(target.querySelector("[data-state=unavailable]")?.textContent).toContain("The ideas list is unavailable right now. Try again later.");
    expect(target.querySelector("[data-state=list], [data-state=empty]")).toBeNull();
    fail = false;
    target.querySelector<HTMLButtonElement>("[data-state=unavailable] button")!.click();
    flushSync();
    expect(target.querySelector("[data-state=loading]")).not.toBeNull();
    await settle();
    expect(reader.calls).toBe(2);
    expect(target.querySelectorAll("[data-state=list] > li")).toHaveLength(3);
    expect(target.querySelector("[data-state=unavailable]")).toBeNull();
  });

  it("says when it is busy, and treats any other error as unavailable", async () => {
    let { target } = await show(new FakeReader(() => Promise.reject(new CompanionFailure("busy"))));
    expect(target.querySelector("[data-state=unavailable]")?.textContent).toContain("Too many requests");
    unmount(app!);
    app = null;
    ({ target } = await show(new FakeReader(() => Promise.reject(new Error("boom")))));
    expect(target.querySelector("[data-state=unavailable]")?.textContent).toContain("unavailable");
  });

  it("speaks the resident's language and marks text shown in another one", async () => {
    const { target } = await show(new FakeReader(async () => PAGE), "fr");
    const [first, second, third] = target.querySelectorAll("[data-state=list] > li");
    expect(first.querySelector("h3")?.textContent).toBe("Des pistes cyclables sûres");
    expect(first.querySelector("h3")?.getAttribute("lang")).toBe("fr");
    // No French text: the English one is shown and marked as English.
    expect(first.querySelector(".text")?.getAttribute("lang")).toBe("en");
    expect(first.querySelector(".reach")?.textContent).toBe("Portée nationale");
    expect(first.querySelector(".support")?.textContent?.trim()).toBe("12 soutiens");
    expect(second.querySelector(".support")?.textContent?.trim()).toBe("1 soutien");
    expect(third.querySelector(".support")?.textContent?.trim()).toBe("Nombre de soutiens masqué le premier jour");
    expect(third.querySelector("h3")?.getAttribute("lang")).toBe("lb");
    expect(target.querySelector("[data-state=closed]")?.textContent).toContain("connexion sécurisée");
  });
});

describe("idea wording", () => {
  it("picks the reader's language, then a fallback", () => {
    expect(pickText({ en: "a", fr: "b" }, "pt")).toEqual({ lang: "fr", text: "b" });
    expect(pickText({ pt: "c" }, "lb")).toEqual({ lang: "pt", text: "c" });
    expect(pickText({}, "en")).toBeNull();
  });

  it("words the age in days, and as a date after two months", () => {
    expect(ageOf("2026-10-06T11:00:00Z", NOW)).toEqual({ key: "age_today" });
    expect(ageOf("2026-10-06T13:00:00Z", NOW)).toEqual({ key: "age_today" }); // server clock a little ahead
    expect(ageOf("2026-10-05T11:00:00Z", NOW)).toEqual({ key: "age_yesterday" });
    expect(ageOf("2026-09-06T12:00:00Z", NOW)).toEqual({ key: "age_days", n: 30 });
    expect(ageOf("2026-01-01T12:00:00Z", NOW)).toEqual({ key: "age_on" });
  });

  it("uses the singular for one supporter (and zero in French)", () => {
    expect(supportKey("en", 1)).toBe("support_one");
    expect(supportKey("en", 0)).toBe("support_many");
    expect(supportKey("fr", 0)).toBe("support_one");
    expect(supportKey("de", 2)).toBe("support_many");
  });
});

describe("RemoteIdeas", () => {
  const answer = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

  it("reads GET /api/ideas and returns a valid page", async () => {
    const fetchMock = answer(200, PAGE);
    vi.stubGlobal("fetch", fetchMock);
    expect(await new RemoteIdeas().list()).toEqual(PAGE);
    expect(fetchMock).toHaveBeenCalledWith("/api/ideas?limit=50");
  });

  it("fails as unavailable on outages and on anything that is not a valid page", async () => {
    const bad: [number, unknown][] = [
      [503, { error: "the ideas list is unavailable" }],
      [502, { error: "x" }],
      [500, { error: "x" }],
      [404, { error: "not found" }],
      [200, "<html>"],
      [200, { ideas: [] }],
      [200, { ...PAGE, ideas: [{ ...NATIONAL, scope_tier: "galactic" }] }],
      [200, { ...PAGE, ideas: [{ ...NATIONAL, proposer_nym: "nym-x" }] }],
    ];
    for (const [status, body] of bad) {
      vi.stubGlobal("fetch", answer(status, body));
      await expect(new RemoteIdeas().list(), `${status} ${JSON.stringify(body)}`).rejects.toMatchObject({ kind: "unavailable" });
    }
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await expect(new RemoteIdeas().list()).rejects.toMatchObject({ kind: "unavailable" });
    vi.stubGlobal("fetch", answer(429, { error: "too many" }));
    await expect(new RemoteIdeas().list()).rejects.toMatchObject({ kind: "busy" });
  });
});
