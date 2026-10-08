/**
 * A file's details: one labelled tile each, where the file stands first, long values on a row of
 * their own, and a very long value folded behind "Show all".
 */
// @vitest-environment jsdom

import type { DocketItem } from "@democracy2/companion";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import FileView from "../src/components/FileView.svelte";
import { setLang } from "../src/lib/ui.svelte.ts";

import recorded from "../../../modules/pulse/test/fixtures/docket-recorded.json" with { type: "json" };

const ITEMS = (recorded as unknown as { items: DocketItem[] }).items;
const BILL = ITEMS.find((i) => i.id === "lu.chd.8752")!;
const NAMES = "Marc Spautz, Laurent Zeimet, Diane Adehm, Claude Wiseler, Martine Hansen, Paul Galles, Françoise Kemp, Léon Gloden, Viviane Reding, Gilles Roth, Max Hahn";
let app: Record<string, unknown> | null = null;

beforeEach(() => setLang("en"));
afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = "";
});

function show(item: DocketItem) {
  const target = document.createElement("div");
  document.body.append(target);
  app = mount(FileView, { target, props: { item, client: null, today: "2026-10-01", onback: () => {} } });
  flushSync();
  return target;
}

const tiles = (root: HTMLElement) =>
  [...root.querySelectorAll(".facts .fact")].map((el) => ({
    label: el.querySelector("dt")!.textContent,
    value: el.querySelector("dd")!.textContent,
    wide: el.classList.contains("wide"),
  }));

describe("File details", () => {
  it("shows each detail as its own labelled tile, status first", () => {
    const got = tiles(show(BILL));
    expect(got[0]).toEqual({ label: "Status", value: "En commission", wide: false });
    expect(got).toContainEqual({ label: "Proposed by", value: "Gilles Roth", wide: false });
    expect(got).toContainEqual({ label: "Committee", value: "Commission des Finances", wide: false });
    expect(got.map((g) => g.label)).toEqual(["Status", "Proposed by", "Committee", "Filed on"]);
  });

  it("gives a long value its own row and folds a very long one", () => {
    const root = show({ ...BILL, author: NAMES, committee: "Commission de la Mobilité et des Travaux publics" });
    const got = tiles(root);
    expect(got.find((g) => g.label === "Committee")!.wide).toBe(true);
    const author = [...root.querySelectorAll(".facts .fact")].find((el) => el.querySelector("dt")!.textContent === "Proposed by")!;
    expect(author.classList.contains("wide")).toBe(true);
    expect(author.querySelector("dd")!.classList.contains("folded")).toBe(true);
    // The whole text is there for screen readers and search even while folded.
    expect(author.querySelector("dd")!.textContent).toBe(NAMES);
  });
});
