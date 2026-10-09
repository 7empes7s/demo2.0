// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Codes from "../src/components/Codes.svelte";
import { commune } from "../src/lib/commune.svelte.ts";
import { LETTER_LANGS, LETTERS, letterText, siteAddress } from "../src/lib/letters.ts";
import { setLang } from "../src/lib/ui.svelte.ts";
import { button, cleanup, click, fakeDesk, show, signedInAs, signedOut, type } from "./helpers.ts";

const THREE = ["ab12-cd34-ef56", "gh78-ij90-kl12", "mn34-op56-qr78"];

beforeEach(() => {
  signedOut();
  setLang("en");
  commune.name = "Esch-sur-Alzette";
  commune.languages = ["fr", "de", "lb", "en", "pt"];
});
afterEach(cleanup);

describe("enrolment codes", () => {
  it("shows a new batch's codes once, then only the batch's counts", async () => {
    let issued = false;
    const { calls } = fakeDesk({
      "GET /api/desk/enrol-codes": () => ({ body: { batches: issued ? [{ batch: "Counter, October", created_at: "2026-10-06T08:00:00.000Z", issued: 3, used: 0 }] : [] } }),
      "POST /api/desk/enrol-codes": () => {
        issued = true;
        return { status: 201, body: { codes: ["ab12-cd34-ef56", "gh78-ij90-kl12", "mn34-op56-qr78"] } };
      },
    });
    signedInAs("admin");
    const root = show(Codes, {});
    await vi.waitFor(() => expect(root.textContent).toContain("No batch yet."));

    type(root.querySelector("#batch-name"), "Counter, October");
    type(root.querySelector("#batch-count"), "3");
    (root.querySelector("form") as HTMLFormElement).requestSubmit();
    await vi.waitFor(() => expect(root.querySelector("textarea.codes")).toBeTruthy());
    const made = calls.find((c) => c.method === "POST");
    expect(made?.body).toEqual({ batch: "Counter, October", count: 3 });
    expect((root.querySelector("textarea.codes") as HTMLTextAreaElement).value).toBe("ab12-cd34-ef56\ngh78-ij90-kl12\nmn34-op56-qr78\n");
    expect(root.textContent).toContain("These codes are shown once.");
    expect(button(root, "Copy")).toBeTruthy();
    expect(button(root, "Download as text")).toBeTruthy();

    // The list refreshed with counts only.
    await vi.waitFor(() => expect(root.querySelector("tbody tr")?.textContent).toContain("Counter, October"));
    expect(root.querySelector("tbody tr")?.textContent).toContain("3");

    // Once dismissed, the codes are gone from the page and never fetched again.
    click(button(root, "Done, I have them"));
    expect(root.querySelector("textarea.codes")).toBeNull();
    expect(root.textContent).not.toContain("ab12-cd34-ef56");
    expect(calls.filter((c) => c.method === "GET").every((c) => !c.path.includes("codes/"))).toBe(true);
  });

  it("prints one letter per code, each in six languages, and drops them when done", async () => {
    fakeDesk({
      "GET /api/desk/enrol-codes": () => ({ body: { batches: [] } }),
      "POST /api/desk/enrol-codes": () => ({ status: 201, body: { codes: THREE } }),
    });
    const printed = vi.fn();
    vi.stubGlobal("print", printed);
    signedInAs("admin");
    const root = show(Codes, {});
    await vi.waitFor(() => expect(root.textContent).toContain("No batch yet."));
    type(root.querySelector("#batch-name"), "Letters, October");
    type(root.querySelector("#batch-count"), "3");
    (root.querySelector("form") as HTMLFormElement).requestSubmit();
    await vi.waitFor(() => expect(button(root, "Print letters")).toBeTruthy());
    expect(root.textContent).toContain("each in Luxembourgish, French, German, English, Portuguese, Arabic");

    // The letters sit straight under <body>, one per code, the code once and every language below it.
    const letters = () => [...document.querySelectorAll("body > .letters .letter")];
    expect(letters()).toHaveLength(3);
    expect(letters().map((l) => l.querySelector(".code-value")?.textContent)).toEqual(THREE);
    const first = letters()[0];
    expect([...first.querySelectorAll(".part")].map((p) => p.getAttribute("lang"))).toEqual(["lb", "fr", "de", "en", "pt", "ar"]);
    expect(first.querySelector('.part[lang="ar"]')?.getAttribute("dir")).toBe("rtl");
    expect(first.querySelector('.part[lang="fr"]')?.getAttribute("dir")).toBe("ltr");
    for (const title of ["Ären Umeldecode", "Votre code d'inscription", "Ihr Anmeldecode", "Your enrolment code", "O seu código de inscrição", "رمز التسجيل الخاص بك"]) {
      expect(first.textContent).toContain(title);
    }
    expect(first.textContent).toContain("Esch-sur-Alzette vous invite");
    expect(first.querySelector(".site")?.textContent).toBe(siteAddress(location.href));
    expect(first.textContent).not.toContain("Letters, October");

    click(button(root, "Print letters"));
    expect(printed).toHaveBeenCalledOnce();

    click(button(root, "Done, I have them"));
    expect(document.querySelector(".letters")).toBeNull();
    expect(document.body.textContent).not.toContain("ab12-cd34-ef56");
  });
});

describe("codes asked for by post", () => {
  const REQUESTS = [
    { id: "r1", name: "Maria Lopes", street: "12 rue de l'Alzette", extra: "2e étage", postcode: "4011", created_at: "2026-10-08T09:00:00.000Z", sent_before: false, duplicate: false },
    { id: "r2", name: "Jean Weber", street: "3 boulevard Kennedy", extra: "", postcode: "4170", created_at: "2026-10-08T10:00:00.000Z", sent_before: true, duplicate: false },
  ];

  it("lists waiting requests, prints addressed letters for the ticked ones, and declines another", async () => {
    let waiting = REQUESTS;
    const { calls } = fakeDesk({
      "GET /api/desk/enrol-codes": () => ({ body: { batches: [] } }),
      "GET /api/desk/enrol-requests": () => ({ body: { requests: waiting } }),
      "POST /api/desk/enrol-requests/print": () => {
        waiting = waiting.filter((r) => r.id !== "r1");
        return { body: { letters: [{ name: "Maria Lopes", street: "12 rue de l'Alzette", extra: "2e étage", postcode: "4011", code: "ab12-cd34-ef56" }] } };
      },
      "POST /api/desk/enrol-requests/r2/decline": () => {
        waiting = [];
        return { body: { ok: true } };
      },
    });
    const printed = vi.fn();
    vi.stubGlobal("print", printed);
    signedInAs("admin");
    const root = show(Codes, {});
    await vi.waitFor(() => expect(root.querySelectorAll("[data-request]")).toHaveLength(2));
    const rows = [...root.querySelectorAll("[data-request]")];
    expect(rows[0].textContent).toContain("12 rue de l'Alzette, 2e étage, L-4011");
    // A request for someone who already got a letter is flagged and left unticked.
    expect(rows[1].textContent).toContain("A letter already went to this name and address.");
    expect((rows[0].querySelector("input[type=checkbox]") as HTMLInputElement).checked).toBe(true);
    expect((rows[1].querySelector("input[type=checkbox]") as HTMLInputElement).checked).toBe(false);

    click(button(root, "Print letters (1)"));
    await vi.waitFor(() => expect(root.querySelector("[data-state=posted]")).toBeTruthy());
    expect(calls.find((c) => c.path === "/api/desk/enrol-requests/print")?.body).toEqual({ ids: ["r1"] });
    expect(root.querySelector("[data-state=posted]")?.textContent).toContain("Letters ready: 1.");
    // The letter carries the window address and the code; no code list to copy for posted letters.
    const letter = document.querySelector("body > .letters .letter")!;
    expect([...letter.querySelectorAll(".to span")].map((l) => l.textContent)).toEqual(["Maria Lopes", "12 rue de l'Alzette", "2e étage", "L-4011 Esch-sur-Alzette"]);
    expect(letter.querySelector(".code-value")?.textContent).toBe("ab12-cd34-ef56");
    expect(root.querySelector("textarea.codes")).toBeNull();
    click(button(root, "Print letters"));
    expect(printed).toHaveBeenCalledOnce();
    click(button(root, "Done, I have them"));
    expect(document.querySelector(".letters")).toBeNull();
    expect(document.body.textContent).not.toContain("Maria Lopes");

    await vi.waitFor(() => expect(root.querySelectorAll("[data-request]")).toHaveLength(1));
    vi.stubGlobal("confirm", () => true);
    click(button(root, "Decline"));
    await vi.waitFor(() => expect(root.textContent).toContain("No request is waiting."));
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/desk/enrol-requests/r2/decline")).toBe(true);
  });
});

describe("enrolment letters", () => {
  it("has every line in every language, and fills the commune and the address", () => {
    const keys = Object.keys(LETTERS.en).sort();
    for (const l of LETTER_LANGS) {
      expect(Object.keys(LETTERS[l]).sort()).toEqual(keys);
      expect(LETTERS[l].intro).toContain("{commune}");
      expect(LETTERS[l].step_open).toContain("{site}");
      const filled = letterText(l, "Esch-sur-Alzette", "cracia.example");
      expect(Object.values(filled).join(" ")).not.toMatch(/\{(commune|site)\}/);
    }
    expect(letterText("en", "  ", "x").intro.startsWith("Your commune invites")).toBe(true);
  });

  it("keeps a Latin name and address in their own direction inside the Arabic text", () => {
    const ar = letterText("ar", "Esch-sur-Alzette", "cracia.example");
    expect(ar.intro).toContain("\u2068Esch-sur-Alzette\u2069");
    expect(ar.step_open).toContain("\u2068cracia.example\u2069");
    expect(letterText("fr", "Esch-sur-Alzette", "cracia.example").intro).not.toContain("\u2068");
  });

  it("points residents at the citizen app, the root of the portal's site", () => {
    expect(siteAddress("https://cracia.example/portal/#codes")).toBe("cracia.example");
    expect(siteAddress("https://cracia.example/portal/")).toBe("cracia.example");
    expect(siteAddress("http://localhost:5174/portal/index.html")).toBe("localhost:5174");
  });
});
