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
