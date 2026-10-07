// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Codes from "../src/components/Codes.svelte";
import { commune } from "../src/lib/commune.svelte.ts";
import { LETTERS, letterLangs, letterText, siteAddress } from "../src/lib/letters.ts";
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

  it("prints one letter per code, each in Luxembourg's four languages plus the commune's own, and drops them when done", async () => {
    fakeDesk({
      "GET /api/desk/enrol-codes": () => ({ body: { batches: [] } }),
      "POST /api/desk/enrol-codes": () => ({ status: 201, body: { codes: THREE } }),
    });
    const printed = vi.fn();
    vi.stubGlobal("print", printed);
    commune.languages = ["fr", "pt"];
    signedInAs("admin");
    const root = show(Codes, {});
    await vi.waitFor(() => expect(root.textContent).toContain("No batch yet."));
    type(root.querySelector("#batch-name"), "Letters, October");
    type(root.querySelector("#batch-count"), "3");
    (root.querySelector("form") as HTMLFormElement).requestSubmit();
    await vi.waitFor(() => expect(button(root, "Print letters")).toBeTruthy());
    expect(root.textContent).toContain("each in Luxembourgish, French, German, English, Portuguese");

    // The letters sit straight under <body>, one per code, the code once and every language below it.
    const letters = () => [...document.querySelectorAll("body > .letters .letter")];
    expect(letters()).toHaveLength(3);
    expect(letters().map((l) => l.querySelector(".code-value")?.textContent)).toEqual(THREE);
    const first = letters()[0];
    expect([...first.querySelectorAll(".part")].map((p) => p.getAttribute("lang"))).toEqual(["lb", "fr", "de", "en", "pt"]);
    for (const title of ["Ären Umeldecode", "Votre code d'inscription", "Ihr Anmeldecode", "Your enrolment code", "O seu código de inscrição"]) {
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

  it("always carries Luxembourg's four languages, plus the commune's own", () => {
    expect(letterLangs([])).toEqual(["lb", "fr", "de", "en"]);
    expect(letterLangs(["fr"])).toEqual(["lb", "fr", "de", "en"]);
    expect(letterLangs(["lb", "fr", "de", "en", "pt"])).toEqual(["lb", "fr", "de", "en", "pt"]);
  });

  it("points residents at the citizen app, the root of the portal's site", () => {
    expect(siteAddress("https://cracia.example/portal/#codes")).toBe("cracia.example");
    expect(siteAddress("https://cracia.example/portal/")).toBe("cracia.example");
    expect(siteAddress("http://localhost:5174/portal/index.html")).toBe("localhost:5174");
  });
});
