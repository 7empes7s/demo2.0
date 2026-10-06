/**
 * The app's look, behind a flag while Affichage lands (docs/design/README.md).
 *
 * `affichage` is the paper-on-a-wall identity; `null` is the look the app shipped with. The flag is
 * per device: `?look=affichage` in the address turns it on and remembers it, `?look=default` turns it
 * off, and nothing in the address keeps what the device remembered. The choice is applied as
 * `data-look` on `<html>` before the app mounts, so the first paint already has the right tokens.
 */

export type Look = "affichage" | null;

const LOOKS = new Set(["affichage"]);

/** What the look should be, from the address and what the device remembered. */
export function resolveLook(search: string, stored: string | null): Look {
  const asked = new URLSearchParams(search).get("look");
  if (asked !== null) return LOOKS.has(asked) ? (asked as Look) : null;
  return stored !== null && LOOKS.has(stored) ? (stored as Look) : null;
}

/** Sets or clears `data-look` on the document root. */
export function applyLook(root: HTMLElement, look: Look): void {
  if (look) root.dataset.look = look;
  else delete root.dataset.look;
}

type Doc = Document & { startViewTransition?: (update: () => Promise<void> | void) => unknown };

/**
 * Runs a screen change as a view transition when the look wants one (Affichage peels the old
 * sheet off), the browser has the API and the reader has not asked for reduced motion.
 * Otherwise the change runs on the spot.
 */
export function peel(root: HTMLElement, update: () => Promise<void> | void): void {
  const doc = root.ownerDocument as Doc;
  const wanted =
    root.dataset.look === "affichage" &&
    typeof doc.startViewTransition === "function" &&
    !(doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false);
  if (wanted) doc.startViewTransition!(update);
  else void update();
}
