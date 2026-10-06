/**
 * Screen changes under the Affichage look (see docs/design/): the old sheet peels off and the next
 * one was already underneath. `peel` runs a screen change as a view transition when the browser
 * has the API and the reader has not asked for reduced motion; otherwise the change runs on the
 * spot. The animations themselves are in tokens.css.
 */
export function peel(root: HTMLElement, update: () => Promise<void> | void): void {
  const doc = root.ownerDocument;
  const wanted =
    typeof doc.startViewTransition === "function" &&
    !(doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false);
  if (wanted) doc.startViewTransition(update);
  else void update();
}
