// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../src/App.svelte";
import { canOpen, homeOf } from "../src/lib/session.svelte.ts";
import { setLang } from "../src/lib/ui.svelte.ts";
import { cleanup, fakeDesk, show, signedInAs, signedOut } from "./helpers.ts";

const PUBLIC = { "GET /api/desk/settings/public": { body: { commune: "Esch-sur-Alzette", languages: ["fr", "en"], intro: {}, ai: { configured: false, model: null } } } };

beforeEach(() => {
  signedOut();
  setLang("en");
});
afterEach(cleanup);

const navTexts = (root: HTMLElement) => [...root.querySelectorAll("nav a")].map((a) => a.textContent?.trim());

describe("role gating", () => {
  it("an auditor never sees Inbox, only the audit sections, and lands on the event log", async () => {
    fakeDesk({ ...PUBLIC, "GET /api/desk/audit/events": { body: { events: [] } } });
    signedInAs("auditor");
    const root = show(App, {});
    await vi.waitFor(() => expect(location.hash).toBe("#audit"));
    const nav = navTexts(root);
    expect(nav).not.toContain("Inbox");
    expect(nav).not.toContain("Staff");
    expect(nav).toEqual(["Event log", "Votes", "Model calls", "Summary"]);
    // The hash change reaches the shell on the next tick.
    await vi.waitFor(() => expect(root.querySelector("h1")?.textContent).toBe("Event log"));
    expect(canOpen("auditor", "inbox")).toBe(false);
    expect(homeOf("auditor")).toBe("audit");
  });

  it("an operator sees the four operator sections and nothing of admin or audit", async () => {
    fakeDesk({ ...PUBLIC, "GET /api/desk/feedback": { body: { feedback: [] } } });
    signedInAs("operator");
    const root = show(App, {});
    await vi.waitFor(() => expect(location.hash).toBe("#inbox"));
    expect(navTexts(root)).toEqual(["Inbox", "Ideas", "Procedures", "Votes"]);
  });

  it("an admin sees everything, and the top bar names the commune and the person", async () => {
    fakeDesk({ ...PUBLIC, "GET /api/desk/feedback": { body: { feedback: [] } } });
    signedInAs("admin");
    const root = show(App, {});
    await vi.waitFor(() => expect(root.textContent).toContain("Esch-sur-Alzette"));
    expect(navTexts(root)).toEqual(["Inbox", "Ideas", "Procedures", "Votes", "Staff", "Enrolment codes", "Settings", "Event log", "Votes", "Model calls", "Summary"]);
    expect(root.textContent).toContain("Ada Admin, admin");
  });

  it("an auditor who opens #inbox by hand gets a refusal, not the inbox", async () => {
    fakeDesk({ ...PUBLIC });
    signedInAs("auditor");
    location.hash = "#inbox";
    const root = show(App, {});
    // The shell sends them to their own home instead.
    await vi.waitFor(() => expect(location.hash).toBe("#audit"));
    expect(root.textContent).not.toContain("Pick a message");
  });

  it("signed out, the shell shows only the sign-in sheet", () => {
    fakeDesk({ ...PUBLIC });
    const root = show(App, {});
    expect(root.querySelector("nav")).toBeNull();
    expect(root.querySelector("#login")).toBeTruthy();
  });
});
