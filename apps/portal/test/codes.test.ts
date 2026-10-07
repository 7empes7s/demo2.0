// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Codes from "../src/components/Codes.svelte";
import { commune } from "../src/lib/commune.svelte.ts";
import { LETTERS, letterText, siteAddress } from "../src/lib/letters.ts";
import { LANGS } from "../src/lib/types.ts";
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

  it("prints one letter per code, in the language staff pick, and drops them when done", async () => {
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

    // The letters sit straight under <body>, one per code, in the commune's first language.
    const letters = () => [...document.querySelectorAll("body > .letters .letter")];
    expect(letters()).toHaveLength(3);
    expect(letters().map((l) => l.querySelector(".code-value")?.textContent)).toEqual(THREE);
    expect(letters()[0].textContent).toContain("Votre code d'inscription");
    expect(letters()[0].textContent).toContain("Esch-sur-Alzette vous invite");
    expect(letters()[0].textContent).toContain(`Ouvrez ${siteAddress(location.href)}`);
    expect(letters()[0].textContent).not.toContain("Letters, October");

    const pick = root.querySelector("#letter-lang") as HTMLSelectElement;
    expect([...pick.options].map((o) => o.value)).toEqual(["fr", "de", "lb", "en", "pt"]);
    pick.value = "de";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(letters()[0].textContent).toContain("Ihr Anmeldecode"));

    click(button(root, "Print letters"));
    expect(printed).toHaveBeenCalledOnce();

    click(button(root, "Done, I have them"));
    expect(document.querySelector(".letters")).toBeNull();
    expect(document.body.textContent).not.toContain("ab12-cd34-ef56");
  });
});

describe("enrolment letters", () => {
  it("has every line in every language, and fills the commune and the address", () => {
    const keys = Object.keys(LETTERS.en).sort();
    for (const l of LANGS) {
      expect(Object.keys(LETTERS[l]).sort()).toEqual(keys);
      expect(LETTERS[l].intro).toContain("{commune}");
      expect(LETTERS[l].step_open).toContain("{site}");
      const filled = letterText(l, "Esch-sur-Alzette", "cracia.example");
      expect(Object.values(filled).join(" ")).not.toMatch(/\{(commune|site)\}/);
    }
    expect(letterText("en", "  ", "x").intro.startsWith("Your commune invites")).toBe(true);
  });

  it("points residents at the citizen app, the root of the portal's site", () => {
    expect(siteAddress("https://cracia.example/portal/#codes")).toBe("cracia.example");
    expect(siteAddress("https://cracia.example/portal/")).toBe("cracia.example");
    expect(siteAddress("http://localhost:5174/portal/index.html")).toBe("localhost:5174");
  });
});
