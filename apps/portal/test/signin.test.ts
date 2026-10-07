// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SignIn from "../src/components/SignIn.svelte";
import { get } from "../src/lib/api.ts";
import { prefs } from "../src/lib/prefs.ts";
import { session } from "../src/lib/session.svelte.ts";
import { setLang } from "../src/lib/ui.svelte.ts";
import { button, cleanup, fakeDesk, show, signedOut, staffOf, type } from "./helpers.ts";

beforeEach(() => {
  signedOut();
  setLang("en");
});
afterEach(cleanup);

describe("sign-in", () => {
  it("signs in with login and password, keeps the token for the tab and sends it on the next call", async () => {
    const { calls } = fakeDesk({
      "POST /api/desk/staff/login": (init) => {
        const body = JSON.parse(String(init?.body));
        return body.login === "olga" && body.password === "correct-horse-battery" ? { body: { token: "T0KENxxxxxxxxxxxxxxxxxxxxxxxxxx", staff: staffOf("operator", { login: "olga" }) } } : { status: 401, body: { error: "wrong login or password" } };
      },
      "GET /api/desk/staff/me": { body: staffOf("operator") },
    });
    const root = show(SignIn, {});
    type(root.querySelector("#login"), "olga");
    type(root.querySelector("#password"), "correct-horse-battery");
    (root.querySelector("form") as HTMLFormElement).requestSubmit();
    await vi.waitFor(() => expect(session.staff?.login).toBe("olga"));

    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/desk/staff/login", body: { login: "olga", password: "correct-horse-battery" } });
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(prefs.token()).toBe("T0KENxxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(sessionStorage.getItem("d2.portal.token")).toBe("T0KENxxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(localStorage.getItem("d2.portal.token")).toBeNull();

    await get("/staff/me");
    expect(calls[1].headers.authorization).toBe("Staff T0KENxxxxxxxxxxxxxxxxxxxxxxxxxx");
  });

  it("shows the desk's own sentence when the password is wrong and stays signed out", async () => {
    fakeDesk({ "POST /api/desk/staff/login": { status: 401, body: { error: "wrong login or password" } } });
    const root = show(SignIn, {});
    type(root.querySelector("#login"), "olga");
    type(root.querySelector("#password"), "nope-nope-nope");
    (root.querySelector("form") as HTMLFormElement).requestSubmit();
    await vi.waitFor(() => expect(root.querySelector("[role=alert]")?.textContent).toContain("wrong login or password"));
    expect(session.staff).toBeNull();
    expect(prefs.token()).toBeNull();
    expect(button(root, "Sign in")).toBeTruthy();
  });

  it("says to wait a minute on 429", async () => {
    fakeDesk({ "POST /api/desk/staff/login": { status: 429, body: { error: "too many requests, try again in a minute" } } });
    const root = show(SignIn, {});
    type(root.querySelector("#login"), "olga");
    type(root.querySelector("#password"), "whatever-whatever");
    (root.querySelector("form") as HTMLFormElement).requestSubmit();
    await vi.waitFor(() => expect(root.querySelector("[role=alert]")?.textContent).toBe("Too many requests, wait a minute."));
  });
});
