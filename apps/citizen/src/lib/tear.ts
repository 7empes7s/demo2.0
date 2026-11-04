/**
 * Tear (docs/design/03-affichage-identity.html): a sheet the resident dismisses or forgets is torn
 * off sideways, then `done` removes it. The animation is `.tearing` in tokens.css (500 ms). With
 * motion off (lib/motion.svelte.ts) or no element, `done` runs at once. A timeout stands in for an
 * `animationend` that never comes (a hidden tab, an element taken away), so nothing stays stuck.
 */
export const TEAR_MS = 500;
const FALLBACK_MS = TEAR_MS + 250;

export function tear(el: Element | null | undefined, done: () => void): Promise<void> {
  const moving = el?.ownerDocument.documentElement.dataset.motion === "on";
  if (!el || !moving) {
    done();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let over = false;
    const finish = () => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      el.removeEventListener("animationend", onEnd);
      done();
      el.classList.remove("tearing");
      resolve();
    };
    // Only the sheet's own tear counts, not an animation of a child or a pseudo-element.
    const onEnd = (e: Event) => {
      if (e.target === el && (e as AnimationEvent).animationName === "tear") finish();
    };
    const timer = setTimeout(finish, FALLBACK_MS);
    el.addEventListener("animationend", onEnd);
    el.classList.add("tearing");
  });
}
