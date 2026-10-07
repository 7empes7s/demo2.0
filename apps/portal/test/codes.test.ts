// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Codes from "../src/components/Codes.svelte";
import { setLang } from "../src/lib/ui.svelte.ts";
import { button, cleanup, click, fakeDesk, show, signedInAs, signedOut, type } from "./helpers.ts";

beforeEach(() => {
  signedOut();
  setLang("en");
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
});
