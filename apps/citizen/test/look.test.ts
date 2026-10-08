// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { peel } from "../src/lib/look.ts";
import { applyMotion, setMotion } from "../src/lib/motion.svelte.ts";

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
