// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AuditLog from "../src/components/AuditLog.svelte";
import AuditVotes from "../src/components/AuditVotes.svelte";
import { setLang } from "../src/lib/ui.svelte.ts";
import { button, cleanup, click, fakeDesk, show, signedInAs, signedOut } from "./helpers.ts";

const EVENT = { seq: 1, at: "2026-10-01T09:00:00.000Z", kind: "staff.created", actor: "system", subject: "staff:s1", payload: { login: "admin", role: "admin" }, prev_hash: "0".repeat(64), hash: "abcdef0123456789".repeat(4) };

beforeEach(() => {
  signedOut();
  setLang("en");
});
afterEach(cleanup);

describe("audit", () => {
  it("lists entries with a hash prefix and the verify button shows that the chain holds", async () => {
    const { calls } = fakeDesk({
      "GET /api/desk/audit/events": { body: { events: [EVENT] } },
      "GET /api/desk/audit/verify": { body: { ok: true, entries: 1, head: EVENT.hash, broken_at: null } },
    });
    signedInAs("auditor");
    const root = show(AuditLog, {});
    await vi.waitFor(() => expect(root.querySelector("tbody tr")).toBeTruthy());
    expect(calls[0].path).toBe("/api/desk/audit/events?from=1&limit=100");
    const cells = [...root.querySelectorAll("tbody tr td")].map((td) => td.textContent?.trim());
    expect(cells[2]).toBe("staff.created");
    expect(cells[3]).toBe("system");
    expect(cells[6]).toBe("abcdef0123");
    expect(root.querySelector("pre.payload")?.textContent).toContain('"login": "admin"');

    click(button(root, "Verify the chain"));
    await vi.waitFor(() => expect(root.querySelector(".notice.ok")?.textContent).toContain("The chain holds: 1 entries, head abcdef012345."));
    expect(calls.some((c) => c.path === "/api/desk/audit/verify")).toBe(true);
  });

  it("names the first bad entry when the chain is broken", async () => {
    fakeDesk({
      "GET /api/desk/audit/events": { body: { events: [] } },
      "GET /api/desk/audit/verify": { body: { ok: false, entries: 12, head: "ff".repeat(32), broken_at: 7 } },
    });
    signedInAs("admin");
    const root = show(AuditLog, {});
    click(button(root, "Verify the chain"));
    await vi.waitFor(() => expect(root.querySelector(".notice.error")?.textContent).toContain("The chain is broken at entry 7."));
  });

  it("says whether the published daily fingerprints still match the log", async () => {
    fakeDesk({
      "GET /api/desk/audit/events": { body: { events: [] } },
      "GET /api/desk/audit/verify": { body: { ok: true, entries: 80, head: "ab".repeat(32), broken_at: null, fingerprints: { checked: 3, ok: false, mismatch_day: "2026-10-07" } } },
    });
    signedInAs("auditor");
    const root = show(AuditLog, {});
    click(button(root, "Verify the chain"));
    await vi.waitFor(() => expect(root.querySelector("[data-testid=prints]")?.textContent).toContain("The published fingerprint of 2026-10-07 no longer matches the log."));
  });

  it("flags a mismatch between the recount and the published tally", async () => {
    const round = { id: "r1", question: { en: "Close the street on Sundays?" }, detail: {}, options: [{ en: "Yes" }, { en: "No" }], status: "published", about_kind: "none", about_id: null, opens_at: null, closes_at: null, result: null, created_at: "", updated_at: "" };
    fakeDesk({
      "GET /api/desk/rounds": { body: { rounds: [round] } },
      "GET /api/desk/rounds/r1": { body: round },
      "GET /api/desk/rounds/r1/ballots": {
        body: {
          ballots: [{ voter: 1, option: 0, seq: 1, at: "2026-10-01T09:00:00.000Z" }, { voter: 2, option: 1, seq: 2, at: "2026-10-01T09:01:00.000Z" }],
          recount: { counts: [1, 1], ballots: 2, voters: 2, tallied_at: "2026-10-02T00:00:00.000Z", ballots_sha256: "aa" },
          published: { counts: [2, 0], ballots: 2, voters: 2, tallied_at: "2026-10-02T00:00:00.000Z", ballots_sha256: "bb" },
        },
      },
    });
    signedInAs("auditor");
    const root = show(AuditVotes, { arg: "r1" });
    await vi.waitFor(() => expect(root.querySelector(".notice.error")?.textContent).toContain("does not match"));
    expect(root.querySelectorAll("tbody")[1].querySelectorAll("tr")).toHaveLength(2);
    // Voter numbers, never ids.
    expect(root.textContent).not.toContain("resident");
  });
});
