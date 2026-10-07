// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError, get, post, query } from "../src/lib/api.ts";
import { prefs } from "../src/lib/prefs.ts";
import { session } from "../src/lib/session.svelte.ts";
import { failure, setLang } from "../src/lib/ui.svelte.ts";
import { cleanup, fakeDesk, signedInAs, signedOut } from "./helpers.ts";

beforeEach(() => {
  signedOut();
  setLang("en");
});
afterEach(cleanup);

describe("the desk client", () => {
  it("calls absolute /api/desk paths with the staff token and JSON", async () => {
    const { calls } = fakeDesk({ "POST /api/desk/rounds": { status: 201, body: { id: "r1" } } });
    signedInAs("operator");
    const out = await post<{ id: string }>("/rounds", { question: { fr: "Q" } });
    expect(out.id).toBe("r1");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/desk/rounds", body: { question: { fr: "Q" } } });
    expect(calls[0].headers["content-type"]).toBe("application/json");
    expect(calls[0].headers.authorization).toBe("Staff tok-operator-xxxxxxxxxxxxxxxxxxxxxxxx");
  });

  it("throws the desk's {error} sentence with its status", async () => {
    fakeDesk({ "GET /api/desk/procedures/x": { status: 404, body: { error: "no such procedure" } } });
    signedInAs("operator");
    const err = (await get("/procedures/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(failure(err)).toBe("no such procedure");
  });

  it("a 401 on any call signs the portal out", async () => {
    fakeDesk({ "GET /api/desk/staff/me": { status: 401, body: { error: "staff sign-in needed" } } });
    signedInAs("admin");
    expect(session.staff).not.toBeNull();
    const err = await get("/staff/me").catch((e) => e);
    expect(failure(err)).toBe("Your session ended. Sign in again.");
    expect(session.staff).toBeNull();
    expect(prefs.token()).toBeNull();
  });

  it("a 429 reads 'too many requests, wait a minute' and a dead network says the desk cannot be reached", async () => {
    fakeDesk({ "GET /api/desk/ideas": { status: 429, body: { error: "too many requests, try again in a minute" } } });
    signedInAs("operator");
    expect(failure(await get("/ideas").catch((e) => e))).toBe("Too many requests, wait a minute.");
    setLang("fr");
    expect(failure(await get("/ideas").catch((e) => e))).toBe("Trop de requêtes, patientez une minute.");
    expect(failure(new ApiError(0, "x"))).toBe("Le guichet est injoignable.");
  });

  it("builds query strings without empty filters", () => {
    expect(query({ status: "new", about_kind: "", from: undefined, limit: 100 })).toBe("?status=new&limit=100");
    expect(query({})).toBe("");
  });
});
