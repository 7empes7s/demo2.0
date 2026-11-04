// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { peel } from "../src/lib/look.ts";
import { applyMotion, setMotion } from "../src/lib/motion.svelte.ts";
import { tear, TEAR_MS } from "../src/lib/tear.ts";

/** The browser's end of an animation, as it reaches the element. */
const ended = (el: Element, animationName = "tear") => el.dispatchEvent(Object.assign(new Event("animationend", { bubbles: true }), { animationName }));

describe("peel", () => {
  it("runs the change on the spot without the view transition API", () => {
    let ran = 0;
    peel(document.documentElement, () => void ran++);
    expect(ran).toBe(1);
  });

  it("hands the change to the browser's view transition, unless motion is reduced", () => {
    const doc = document as unknown as { startViewTransition?: unknown };
    const calls: unknown[] = [];
    doc.startViewTransition = (update: () => void) => calls.push(update);
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    applyMotion(null);
    let ran = 0;
    peel(document.documentElement, () => void ran++);
    expect(calls).toHaveLength(1);
    expect(ran).toBe(0);
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
    applyMotion(null);
    peel(document.documentElement, () => void ran++);
    expect(calls).toHaveLength(1);
    expect(ran).toBe(1);
    doc.startViewTransition = undefined;
  });
});

describe("motion setting", () => {
  it("follows the device until the resident chooses, and the choice wins either way", () => {
    const root = document.documentElement;
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
    setMotion(null);
    expect(root.dataset.motion).toBe("off");
    // A computer with animations turned off still animates once the resident says On.
    setMotion("on");
    expect(root.dataset.motion).toBe("on");
    expect(localStorage.getItem("d2.motion")).toBe("on");
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    setMotion("off");
    expect(root.dataset.motion).toBe("off");
    setMotion(null);
    expect(root.dataset.motion).toBe("on");
    expect(localStorage.getItem("d2.motion")).toBeNull();
  });
});

describe("tear", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
    delete document.documentElement.dataset.motion;
  });

  it("tears the sheet with motion on, and removes it only once its own tear has ended", async () => {
    document.documentElement.dataset.motion = "on";
    const sheet = document.createElement("div");
    const child = document.createElement("span");
    sheet.append(child);
    document.body.append(sheet);
    let removed = 0;
    const gone = tear(sheet, () => void removed++);
    expect(sheet.classList.contains("tearing")).toBe(true);
    expect(removed).toBe(0);
    // A child's animation, or another animation on the sheet, is not the tear.
    ended(child);
    ended(sheet, "paste");
    expect(removed).toBe(0);
    ended(sheet);
    await gone;
    expect(removed).toBe(1);
    expect(sheet.classList.contains("tearing")).toBe(false);
    // A late second event changes nothing.
    ended(sheet);
    expect(removed).toBe(1);
  });

  it("removes the sheet at once, with no tear, when motion is off or there is no sheet", async () => {
    document.documentElement.dataset.motion = "off";
    const sheet = document.createElement("div");
    let removed = 0;
    await tear(sheet, () => void removed++);
    expect(removed).toBe(1);
    expect(sheet.classList.contains("tearing")).toBe(false);
    document.documentElement.dataset.motion = "on";
    await tear(null, () => void removed++);
    expect(removed).toBe(2);
  });

  it("still removes the sheet when the end of the animation never comes", async () => {
    vi.useFakeTimers();
    document.documentElement.dataset.motion = "on";
    const sheet = document.createElement("div");
    let removed = 0;
    const gone = tear(sheet, () => void removed++);
    vi.advanceTimersByTime(TEAR_MS);
    expect(removed).toBe(0);
    vi.advanceTimersByTime(300);
    await gone;
    expect(removed).toBe(1);
    expect(sheet.classList.contains("tearing")).toBe(false);
  });
});
