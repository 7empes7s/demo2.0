// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { peel } from "../src/lib/look.ts";

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
    let ran = 0;
    peel(document.documentElement, () => void ran++);
    expect(calls).toHaveLength(1);
    expect(ran).toBe(0);
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
    peel(document.documentElement, () => void ran++);
    expect(calls).toHaveLength(1);
    expect(ran).toBe(1);
    doc.startViewTransition = undefined;
  });
});
