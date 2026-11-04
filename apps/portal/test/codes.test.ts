// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Codes from "../src/components/Codes.svelte";
import Settings from "../src/components/Settings.svelte";
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
    { id: "r1", name: "Maria Lopes", street: "12 rue de l'Alzette", extra: "2e étage", postcode: "4011", created_at: "2026-10-08T09:00:00.000Z", sent_before: false, duplicate: false, outside: false },
    { id: "r2", name: "Jean Weber", street: "3 boulevard Kennedy", extra: "", postcode: "4170", created_at: "2026-10-08T10:00:00.000Z", sent_before: true, duplicate: false, outside: false },
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
    // Declining asks for the reason the resident will see; a letter that already went suggests "asked twice".
    click(button(root, "Decline"));
    const picker = root.querySelector("[data-state=declining]")!;
    const select = picker.querySelector("select") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Not in the residents' register", "Address outside the commune", "Asked twice, or a letter already went", "Address incomplete"]);
    expect(select.value).toBe("asked_twice");
    expect(picker.textContent).toContain("The resident's device shows the reason on its next visit.");
    // Keeping it closes the picker and sends nothing.
    click(button(picker, "Keep it"));
    expect(root.querySelector("[data-state=declining]")).toBeNull();
    expect(calls.some((c) => c.path.endsWith("/decline"))).toBe(false);
    click(button(root, "Decline"));
    const again = root.querySelector("[data-state=declining] select") as HTMLSelectElement;
    again.value = "not_in_register";
    again.dispatchEvent(new Event("change", { bubbles: true }));
    click(button(root.querySelector("[data-state=declining]")!, "Decline"));
    await vi.waitFor(() => expect(root.textContent).toContain("No request is waiting."));
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/desk/enrol-requests/r2/decline")?.body).toEqual({ reason: "not_in_register" });
  });

  it("never lets a request outside the commune's postcodes be printed, and suggests declining it as such", async () => {
    const outside = { id: "r3", name: "Ana Silva", street: "1 Grand-Rue", extra: "", postcode: "9001", created_at: "2026-10-08T11:00:00.000Z", sent_before: false, duplicate: false, outside: true };
    const { calls } = fakeDesk({
      "GET /api/desk/enrol-codes": () => ({ body: { batches: [] } }),
      "GET /api/desk/enrol-requests": () => ({ body: { requests: [REQUESTS[0], outside] } }),
      "POST /api/desk/enrol-requests/print": () => ({ body: { letters: [] } }),
    });
    signedInAs("admin");
    const root = show(Codes, {});
    await vi.waitFor(() => expect(root.querySelectorAll("[data-request]")).toHaveLength(2));
    const row = root.querySelector("[data-request=r3]")!;
    expect(row.querySelector("[data-state=outside]")?.textContent).toBe("Postcode outside the commune: no letter can be printed. Decline it.");
    const box = row.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    click(box);
    expect(button(root, "Print letters (1)")).toBeTruthy();
    click(button(root, "Print letters (1)"));
    await vi.waitFor(() => expect(calls.some((c) => c.path === "/api/desk/enrol-requests/print")).toBe(true));
    expect(calls.find((c) => c.path === "/api/desk/enrol-requests/print")?.body).toEqual({ ids: ["r1"] });
    await vi.waitFor(() => expect(button(root, "Print letters (1)")).toBeTruthy());
    click(button(root.querySelector("[data-request=r3]")!, "Decline"));
    expect((root.querySelector("[data-state=declining] select") as HTMLSelectElement).value).toBe("outside_commune");
  });
});

describe("the commune's postcodes", () => {
  const SETTINGS = { commune: "Esch-sur-Alzette", languages: ["fr", "en"], intro: {}, postcodes: ["4001-4398"], ai: { configured: false, model: null, base_url: "", key_set: false, from_env: false } };

  it("shows the ranges one per line and saves the edited list", async () => {
    const { calls } = fakeDesk({
      "GET /api/desk/settings": () => ({ body: SETTINGS }),
      "PATCH /api/desk/settings": (init) => ({ body: { ...SETTINGS, postcodes: JSON.parse(String(init?.body)).postcodes } }),
    });
    signedInAs("admin");
    const root = show(Settings, {});
    await vi.waitFor(() => expect(root.querySelector("#s-postcodes")).toBeTruthy());
    const field = root.querySelector("#s-postcodes") as HTMLTextAreaElement;
    expect(field.value).toBe("4001-4398");
    expect(root.querySelector('label[for="s-postcodes"]')?.textContent).toBe("Postcodes of the commune");
    expect(root.textContent).toContain("Leave empty to accept every postcode.");
    type(field, "4001-4398\n  4410  \n\n4500-4510");
    (root.querySelector("form") as HTMLFormElement).requestSubmit();
    await vi.waitFor(() => expect(root.textContent).toContain("Settings saved."));
    expect((calls.find((c) => c.method === "PATCH")?.body as { postcodes: string[] }).postcodes).toEqual(["4001-4398", "4410", "4500-4510"]);
    expect((root.querySelector("#s-postcodes") as HTMLTextAreaElement).value).toBe("4001-4398\n4410\n4500-4510");
  });

  it("clears the check with an empty list, and shows the desk's refusal of a bad range", async () => {
    let refuse = true;
    const { calls } = fakeDesk({
      "GET /api/desk/settings": () => ({ body: SETTINGS }),
      "PATCH /api/desk/settings": () => (refuse ? { status: 400, body: { error: "the range 4398-4001 ends before it starts" } } : { body: { ...SETTINGS, postcodes: [] } }),
    });
    signedInAs("admin");
    setLang("fr");
    const root = show(Settings, {});
    await vi.waitFor(() => expect(root.querySelector("#s-postcodes")).toBeTruthy());
    expect(root.querySelector('label[for="s-postcodes"]')?.textContent).toBe("Codes postaux de la commune");
    type(root.querySelector("#s-postcodes"), "4398-4001");
    (root.querySelector("form") as HTMLFormElement).requestSubmit();
    await vi.waitFor(() => expect(root.textContent).toContain("ends before it starts"));
    refuse = false;
    type(root.querySelector("#s-postcodes"), "");
    (root.querySelector("form") as HTMLFormElement).requestSubmit();
    await vi.waitFor(() => expect(root.textContent).toContain("Paramètres enregistrés."));
    expect((calls.filter((c) => c.method === "PATCH").at(-1)?.body as { postcodes: string[] }).postcodes).toEqual([]);
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
