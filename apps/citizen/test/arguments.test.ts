// @vitest-environment jsdom
//
// The arguments section on a file page. Fixtures are recorded: what the Companion answers for the
// Esch council point of 2 Oct 2026 (6 council group votes) and for the city's participation
// platform project (8 resident ideas), both from the Esch seed library in Commons.
import type { DocketItem, FileArgument, FileArguments } from "@democracy2/companion";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Arguments from "../src/components/Arguments.svelte";
import { councillorsOf, groupOf, roleOf, viewOf } from "../src/lib/arguments.ts";
import { ArgumentsFailure, type ArgumentsRead, type ArgumentsReader, RemoteArguments } from "../src/lib/client.ts";
import { setLang } from "../src/lib/ui.svelte.ts";
import esch from "./fixtures/companion-arguments-esch-42063.json" with { type: "json" };
import proposals from "./fixtures/companion-arguments-esch-proposals.json" with { type: "json" };

const ESCH = esch as FileArguments;
const PROPOSALS = proposals as FileArguments;
const ITEM = { id: ESCH.file_id } as DocketItem;

/** Synthetic reasons, made up for the test: Commons holds no resident reasons on a council point yet. */
const reason = (id: string, side: "yes" | "no", extra: Partial<FileArgument> = {}): FileArgument => ({
  id,
  stance_option_id: side,
  kind: "argument",
  text: `Synthetic reason ${id}.`,
  attribution: "A resident, on the city's participation platform",
  source_url: `https://example.org/${id}`,
  ...extra,
});
const MIXED: FileArguments = { ...ESCH, arguments: [reason("r1", "yes"), ...ESCH.arguments, reason("r2", "no"), reason("r3", "no")] };
const RANKED: FileArguments = {
  ...MIXED,
  ranker: { id: "bridging-mf@0123456789ab", algorithm: "bridging-mf" },
  arguments: [reason("r2", "no", { status: "scored", strong_both_sides: true }), reason("r1", "yes", { status: "scored" }), reason("r3", "no", { status: "needs more ratings" })],
};

class FakeReader implements ArgumentsReader {
  calls: string[] = [];
  constructor(private readonly answer: () => Promise<ArgumentsRead>) {}
  forFile(id: string) {
    this.calls.push(id);
    return this.answer();
  }
}
const serves = (list: FileArguments, savedAt: string | null = null) => new FakeReader(async () => ({ list, savedAt }));

let app: Record<string, unknown> | null = null;
beforeEach(() => setLang("en"));
afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
};

async function show(reader: ArgumentsReader, item = ITEM) {
  const target = document.createElement("div");
  document.body.append(target);
  app = mount(Arguments, { target, props: { item, reader } });
  await settle();
  return target;
}

const tab = (root: ParentNode, side: string) => root.querySelector<HTMLButtonElement>(`[data-tab=${side}]`)!;
const block = (root: ParentNode, name: string) => root.querySelector(`[data-block=${name}]`);
const sideTags = (root: ParentNode, name: string) => [...(block(root, name)?.querySelectorAll(".tag.side") ?? [])].map((t) => t.textContent);

describe("Arguments on a file", () => {
  it("asks once for the file, and the tabs filter with their counts", async () => {
    const reader = serves(ESCH);
    const target = await show(reader);
    expect(reader.calls).toEqual(["lu.esch.42063"]);
    expect(tab(target, "for").textContent).toBe("For 3");
    expect(tab(target, "against").textContent).toBe("Against 3");
    expect(tab(target, "both").textContent).toBe("Both 6");
    expect(tab(target, "both").getAttribute("aria-pressed")).toBe("true");
    expect(sideTags(target, "positions")).toHaveLength(6);

    tab(target, "for").click();
    flushSync();
    expect(tab(target, "for").getAttribute("aria-pressed")).toBe("true");
    expect(sideTags(target, "positions")).toEqual(["For", "For", "For"]);
    tab(target, "against").click();
    flushSync();
    expect(sideTags(target, "positions")).toEqual(["Against", "Against", "Against"]);
    expect(reader.calls).toHaveLength(1);
  });

  it("shows council votes as votes, apart from reasons, and never why", async () => {
    const target = await show(serves(MIXED));
    expect(sideTags(target, "reasons")).toEqual(["For", "Against", "Against"]);
    expect(sideTags(target, "positions")).toHaveLength(6);
    const votes = block(target, "positions")!;
    expect(votes.textContent).toContain("How the council groups voted");
    expect(votes.textContent).toContain("A council vote shows who took a side, not why.");
    expect(votes.textContent).toContain("CSV");
    expect(votes.textContent).toContain("Voted for · Councillors: 6");
    expect(votes.textContent).toContain("LSAP");
    expect(votes.textContent).toContain("Voted against · Councillors: 6");
    // Commons' own English line, with its raw date, is not printed.
    expect(votes.textContent).not.toContain("municipal council on 2026-10-02");
    expect(block(target, "reasons")!.textContent).not.toContain("CSV");
    // Only reasons are sheets; every vote links to the council's page.
    expect(block(target, "reasons")!.querySelectorAll("li.card.arg")).toHaveLength(3);
    expect([...votes.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(ESCH.arguments.map((a) => a.source_url));

    tab(target, "for").click();
    flushSync();
    expect(sideTags(target, "reasons")).toEqual(["For"]);
    // A side with votes but no reason says so.
    const noReason: FileArguments = { ...MIXED, arguments: [reason("r1", "yes"), ...ESCH.arguments] };
    unmount(app!);
    const other = await show(serves(noReason));
    tab(other, "against").click();
    flushSync();
    expect(block(other, "reasons")!.textContent).toContain("No reason on this side yet.");
  });

  it("says the list is not rated yet when Commons has no ranker", async () => {
    const target = await show(serves(ESCH));
    expect(target.querySelector("[data-ranked]")!.textContent).toBe("Not rated yet, shown in the order they were collected.");
    expect(target.textContent).not.toContain("Rated strong by both sides");
    expect(target.textContent).not.toContain("Needs more ratings");
  });

  it("says 'ranked by bridging', and 'both sides' only where the ranker says so", async () => {
    const target = await show(serves(RANKED));
    expect(target.querySelector("[data-ranked]")!.textContent).toContain("Ranked by bridging");
    const sheets = [...block(target, "reasons")!.querySelectorAll("li.arg")];
    // Commons' order is kept.
    expect(sheets.map((s) => s.querySelector(".text")!.textContent)).toEqual(["Synthetic reason r2.", "Synthetic reason r1.", "Synthetic reason r3."]);
    expect(sheets.map((s) => s.querySelector("[data-rated=both]")?.textContent ?? null)).toEqual(["Rated strong by both sides", null, null]);
    expect(sheets.map((s) => s.querySelector("[data-rated=more]")?.textContent ?? null)).toEqual([null, null, "Needs more ratings"]);
  });

  it("shows the secure sign-in sheet instead of rating or posting", async () => {
    const target = await show(serves(MIXED));
    const buttons = [...target.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
    for (const fake of [/strong/i, /weak/i, /your argument/i, /post/i, /reply/i]) expect(buttons.some((b) => fake.test(b))).toBe(false);
    expect(target.querySelectorAll("textarea, input")).toHaveLength(0);
    const sheet = target.querySelector("[data-state=signin]")!;
    expect(sheet.textContent).toContain("Secure sign-in isn't ready yet");
    expect(sheet.textContent).toContain("Rating an argument strong or weak, and adding your own, open when it is.");
  });

  it("shows an empty state when Commons has nothing for the file", async () => {
    const target = await show(serves({ file_id: ITEM.id, ranker: null, arguments: [] }));
    expect(target.querySelector("[data-state=empty]")!.textContent).toBe("No arguments on this file yet.");
    expect(target.querySelector("[data-tab]")).toBeNull();
    expect(target.querySelector("[data-state=signin]")).toBeTruthy();
  });

  it("shows residents' ideas without sides, each with its role and link", async () => {
    const target = await show(serves(PROPOSALS), { id: PROPOSALS.file_id } as DocketItem);
    expect(target.querySelector("[data-tab]")).toBeNull();
    const sheets = [...block(target, "ideas")!.querySelectorAll("li.arg")];
    expect(sheets).toHaveLength(8);
    for (const s of sheets) {
      expect(s.querySelector(".tag")!.textContent).toBe("Idea");
      expect(s.querySelector(".role")!.textContent).toBe("A resident, on the city's participation platform");
      expect(s.querySelector("a")!.getAttribute("href")).toMatch(/^https:\/\/participation\.esch\.lu\/shout\//);
      expect(s.querySelector("a")!.getAttribute("rel")).toContain("noopener");
    }
  });

  it("names roles in the resident's language and shows no raw ids or pseudonyms", async () => {
    setLang("fr");
    const target = await show(serves(MIXED));
    expect(tab(target, "both").textContent).toBe("Les deux 9");
    expect(block(target, "positions")!.textContent).toContain("A voté contre · Conseillers : 1");
    expect(block(target, "reasons")!.textContent).toContain("Un résident, sur la plateforme de participation de la ville");
    for (const raw of ["lu.esch", "esch-", "source:", "nym", "bridging-mf"]) expect(target.textContent).not.toContain(raw);
  });

  it("says plainly when the arguments are not on this server, failing, or offline", async () => {
    const off = await show(new FakeReader(() => Promise.reject(new ArgumentsFailure("off"))));
    expect(off.querySelector("[data-state=unavailable]")!.textContent).toContain("Arguments aren't available on this server.");
    expect(off.querySelector("button")).toBeNull();
    unmount(app!);

    let fail = true;
    const flaky = new FakeReader(() => (fail ? Promise.reject(new ArgumentsFailure("unavailable")) : Promise.resolve({ list: ESCH, savedAt: null })));
    const down = await show(flaky);
    expect(down.textContent).toContain("The arguments can't be reached right now.");
    fail = false;
    down.querySelector<HTMLButtonElement>("[data-state=unavailable] button")!.click();
    await settle();
    expect(block(down, "positions")).toBeTruthy();
    unmount(app!);

    const away = await show(new FakeReader(() => Promise.reject(new ArgumentsFailure("offline"))));
    expect(away.querySelector("[data-state=offline]")!.textContent).toContain("You're offline");
    unmount(app!);

    const saved = await show(serves(ESCH, "2026-10-06T09:12:00.000Z"));
    expect(saved.querySelector("[data-state=saved]")!.textContent).toContain("Showing the arguments saved on");
    expect(block(saved, "positions")).toBeTruthy();
  });
});

describe("RemoteArguments", () => {
  const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("asks for the file alone and checks the answer", async () => {
    const fetchSpy = answer(200, ESCH);
    vi.stubGlobal("fetch", fetchSpy);
    const read = await new RemoteArguments().forFile("lu.esch.42063");
    expect(fetchSpy).toHaveBeenCalledWith("/api/files/lu.esch.42063/arguments");
    expect(read).toEqual({ list: ESCH, savedAt: null });
  });

  it("turns failures into what the page says", async () => {
    const kind = async (status: number, body: unknown) => {
      vi.stubGlobal("fetch", answer(status, body));
      return new RemoteArguments().forFile(ESCH.file_id).then(
        () => "ok",
        (e: ArgumentsFailure) => e.kind,
      );
    };
    expect(await kind(503, { error: "not configured" })).toBe("off");
    expect(await kind(502, { error: "down" })).toBe("unavailable");
    expect(await kind(429, {})).toBe("busy");
    expect(await kind(200, { ...ESCH, file_id: "lu.esch.1" })).toBe("unavailable");
    expect(await kind(200, { ...ESCH, arguments: [{ ...ESCH.arguments[0], author_nym: "source:esch.lu-council" }] })).toBe("unavailable");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await expect(new RemoteArguments().forFile(ESCH.file_id)).rejects.toBeInstanceOf(ArgumentsFailure);
  });
});

describe("sorting helpers", () => {
  it("reads group, councillors and role from Commons' recorded lines", () => {
    const csv = ESCH.arguments.find((a) => a.attribution?.startsWith("CSV"))!;
    expect(groupOf(csv)).toBe("CSV");
    expect(councillorsOf(csv)).toBe(6);
    expect(roleOf(csv)).toEqual({ key: "args_role_group", vars: { group: "CSV" } });
    expect(roleOf({ ...csv, attribution: "Chambre de Commerce" })).toEqual({ raw: "Chambre de Commerce" });
    expect(roleOf({ ...csv, attribution: undefined })).toBeNull();
  });

  it("counts every side, and keeps ideas under Both when the file has sides", () => {
    const withIdea: FileArguments = { ...MIXED, arguments: [...MIXED.arguments, PROPOSALS.arguments[0]] };
    const both = viewOf(withIdea, "both");
    expect(both.counts).toEqual({ for: 4, against: 5, both: 10 });
    expect(both.ideas).toHaveLength(1);
    expect(viewOf(withIdea, "for").ideas).toHaveLength(0);
  });
});
