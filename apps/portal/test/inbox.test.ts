// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Inbox from "../src/components/Inbox.svelte";
import { commune } from "../src/lib/commune.svelte.ts";
import type { Feedback } from "../src/lib/types.ts";
import { setLang } from "../src/lib/ui.svelte.ts";
import { button, cleanup, click, fakeDesk, show, signedInAs, signedOut } from "./helpers.ts";

const MESSAGE: Feedback = {
  id: "fb1",
  code: "abcd1234",
  enrolled: true,
  about_kind: "procedure",
  about_id: "p1",
  category: "other",
  lang: "fr",
  text: "Le trottoir rue de l'Exemple est cassé depuis trois semaines.",
  status: "new",
  summary: null,
  answer: null,
  answer_public: false,
  answered_at: null,
  created_at: "2026-10-01T09:00:00.000Z",
};

beforeEach(() => {
  signedOut();
  setLang("en");
  commune.model = true;
});
afterEach(cleanup);

describe("inbox", () => {
  it("lists new messages, opens one, and the triage button sends the right request", async () => {
    const { calls } = fakeDesk({
      "GET /api/desk/feedback": { body: { feedback: [MESSAGE] } },
      "GET /api/desk/feedback/fb1": { body: MESSAGE },
      "GET /api/desk/procedures/p1": { body: { id: "p1", title: { fr: "Réfection de la rue de l'Exemple", en: "Resurfacing of rue de l'Exemple" } } },
      "POST /api/desk/feedback/fb1/triage": { body: { suggestion: { category: "roads", summary: "A broken pavement on rue de l'Exemple.", lang: "fr" }, labelled: "A model wrote this suggestion; an operator decides." } },
    });
    signedInAs("operator");
    const root = show(Inbox, { arg: null });
    await vi.waitFor(() => expect(root.querySelector(".entry .title")?.textContent).toContain("Le trottoir rue de l'Exemple"));
    expect(calls[0].path).toBe("/api/desk/feedback?status=new");
    expect(calls[0].headers.authorization).toMatch(/^Staff tok-operator/);

    click(root.querySelector(".entry"));
    expect(location.hash).toBe("#inbox/fb1");
    const opened = show(Inbox, { arg: "fb1" });
    await vi.waitFor(() => expect(opened.querySelector("blockquote")?.textContent).toContain("trottoir"));
    expect(opened.textContent).toContain("About a procedure: Resurfacing of rue de l'Exemple");
    expect(opened.textContent).toContain("from an enrolled resident");
    // The raw id lives only under the technical details.
    expect(opened.querySelector("details.tech")?.textContent).toContain("fb1");
    expect(opened.textContent?.replace(opened.querySelector("details.tech")?.textContent ?? "", "")).not.toContain("fb1");

    click(button(opened, "Suggest a sort"));
    await vi.waitFor(() => expect(opened.querySelector(".model")).toBeTruthy());
    const triage = calls.find((c) => c.path === "/api/desk/feedback/fb1/triage");
    expect(triage).toMatchObject({ method: "POST", headers: { authorization: "Staff tok-operator-xxxxxxxxxxxxxxxxxxxxxxxx" } });
    expect(opened.querySelector(".model")?.textContent).toContain("Suggested by the model, edit before sending.");
    expect(opened.querySelector(".model")?.textContent).toContain("roads");

    click(button(opened, "Use this suggestion"));
    expect((opened.querySelector("#fb-cat") as HTMLSelectElement).value).toBe("roads");
    expect((opened.querySelector("#fb-summary") as HTMLInputElement).value).toBe("A broken pavement on rue de l'Exemple.");
    expect((opened.querySelector("#fb-status") as HTMLSelectElement).value).toBe("in_review");
  });

  it("the draft button fills the answer, labelled, and publishing sends publish: true", async () => {
    const { calls } = fakeDesk({
      "GET /api/desk/feedback": { body: { feedback: [MESSAGE] } },
      "GET /api/desk/feedback/fb1": { body: MESSAGE },
      "GET /api/desk/procedures/p1": { body: { id: "p1", title: { fr: "Rue" } } },
      "POST /api/desk/feedback/fb1/draft": { body: { draft: "Merci, les travaux sont prévus la semaine prochaine.", labelled: "A model wrote this draft; an operator edits and signs it." } },
      "POST /api/desk/feedback/fb1/answer": (init) => ({ body: { ...MESSAGE, status: "answered", answer: JSON.parse(String(init?.body)).answer, answer_public: true, answered_at: "2026-10-02T10:00:00.000Z" } }),
    });
    signedInAs("operator");
    const root = show(Inbox, { arg: "fb1" });
    await vi.waitFor(() => expect(root.querySelector("blockquote")).toBeTruthy());
    click(button(root, "Draft an answer"));
    await vi.waitFor(() => expect((root.querySelector("#fb-answer") as HTMLTextAreaElement).value).toContain("Merci"));
    expect(root.textContent).toContain("Suggested by the model, edit before sending.");

    click(button(root, "Answer and publish on the procedure"));
    await vi.waitFor(() => expect(root.textContent).toContain("Published on the procedure"));
    const sent = calls.find((c) => c.path === "/api/desk/feedback/fb1/answer");
    expect(sent?.body).toEqual({ answer: "Merci, les travaux sont prévus la semaine prochaine.", publish: true });
  });

  it("shows the desk's error sentence when the model is not configured", async () => {
    fakeDesk({
      "GET /api/desk/feedback": { body: { feedback: [] } },
      "GET /api/desk/feedback/fb1": { body: { ...MESSAGE, about_kind: "none", about_id: null } },
      "POST /api/desk/feedback/fb1/triage": { status: 503, body: { error: "no model is configured" } },
    });
    signedInAs("admin");
    const root = show(Inbox, { arg: "fb1" });
    await vi.waitFor(() => expect(root.querySelector("blockquote")).toBeTruthy());
    click(button(root, "Suggest a sort"));
    await vi.waitFor(() => expect(root.querySelector("[role=alert]")?.textContent).toBe("no model is configured"));
    // Not about anything: no publish button, only the private answer.
    expect(button(root, "Answer and publish")).toBeNull();
    expect(button(root, "Answer privately")).toBeTruthy();
  });
});
