import type { Argument, ChallengeTurn, DocketItem } from "@democracy2/companion";
import { describe, expect, it } from "vitest";

import { challengeTurn, type CompanionClient } from "../src/lib/client.ts";
import { safeUrl } from "../src/lib/data.ts";

const item = { id: "lu.esch.42063" } as DocketItem;
const ARGS: Argument[] = [{ id: "a1", stance: "opposes", by: "Chambre", summary_en: "Cost.", source: 2, quote: "q" }];

function fakeClient(turn: Partial<ChallengeTurn>) {
  const calls: string[] = [];
  const client = {
    async challenge() {
      calls.push("challenge");
      return { reply: "r", argument_ids: [], sources: [], grounded: false, ...turn } as ChallengeTurn;
    },
    async arguments() {
      calls.push("arguments");
      return { arguments: ARGS, sources: [] };
    },
  } as unknown as CompanionClient;
  return { client, calls };
}

describe("devil's advocate turn in the app", () => {
  it("lets the server decide: no extraction call when the turn says what it shows", async () => {
    const { client, calls } = fakeClient({ shown: [], commons_available: 3 });
    const got = await challengeTurn(client, item, "en", "for", [], null);
    expect(calls).toEqual(["challenge"]);
    expect(got.args).toBeNull();
  });

  it("asks an older server (no `shown`) for the documents' arguments once", async () => {
    const { client, calls } = fakeClient({});
    const first = await challengeTurn(client, item, "en", "for", [], null);
    expect(first.args).toEqual(ARGS);
    await challengeTurn(client, item, "en", "for", [], first.args);
    expect(calls).toEqual(["challenge", "arguments", "challenge"]);
  });

  it("links a shown argument only when its URL is http(s)", () => {
    expect(safeUrl("https://administration.esch.lu/x")).toBe("https://administration.esch.lu/x");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", " https://x", "", undefined]) expect(safeUrl(bad)).toBeUndefined();
  });
});
