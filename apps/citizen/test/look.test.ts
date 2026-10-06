// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { applyLook, resolveLook } from "../src/lib/look.ts";

describe("look flag", () => {
  it("turns on from the address and remembers nothing else", () => {
    expect(resolveLook("?look=affichage", null)).toBe("affichage");
    expect(resolveLook("?lang=fr&look=affichage", null)).toBe("affichage");
  });

  it("turns off from the address, whatever the device remembered", () => {
    expect(resolveLook("?look=default", "affichage")).toBeNull();
    expect(resolveLook("?look=", "affichage")).toBeNull();
    expect(resolveLook("?look=nonsense", "affichage")).toBeNull();
  });

  it("keeps what the device remembered when the address says nothing", () => {
    expect(resolveLook("", "affichage")).toBe("affichage");
    expect(resolveLook("?lang=fr", "affichage")).toBe("affichage");
    expect(resolveLook("", null)).toBeNull();
    expect(resolveLook("", "something-old")).toBeNull();
  });

  it("writes data-look on the root and removes it again", () => {
    const root = document.createElement("html");
    applyLook(root, "affichage");
    expect(root.dataset.look).toBe("affichage");
    applyLook(root, null);
    expect(root.dataset.look).toBeUndefined();
  });
});

describe("peel", () => {
  // The helper is imported here so a missing export fails loudly rather than silently.
  it("runs the change on the spot without the look, the API or with reduced motion", async () => {
    const { peel } = await import("../src/lib/look.ts");
    const root = document.documentElement;
    let ran = 0;
    peel(root, () => void ran++);
    expect(ran).toBe(1);
    applyLook(root, "affichage");
    peel(root, () => void ran++);
    expect(ran).toBe(2);
    applyLook(root, null);
  });

  it("hands the change to the browser's view transition when the look is on", async () => {
    const { peel } = await import("../src/lib/look.ts");
    const root = document.documentElement;
    const doc = document as unknown as { startViewTransition?: unknown };
    const calls: unknown[] = [];
    doc.startViewTransition = (update: () => void) => calls.push(update);
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    let ran = 0;
    peel(root, () => void ran++);
    expect(ran).toBe(1);
    expect(calls).toHaveLength(0);
    applyLook(root, "affichage");
    peel(root, () => void ran++);
    expect(calls).toHaveLength(1);
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
    peel(root, () => void ran++);
    expect(calls).toHaveLength(1);
    expect(ran).toBe(2);
    applyLook(root, null);
    doc.startViewTransition = undefined;
  });
});
