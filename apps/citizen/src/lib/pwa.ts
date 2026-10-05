/**
 * Installs the service worker that lets the served app open offline. main.ts calls this only in
 * the production build for the Companion server: dev and the single-file build never register one
 * (an artifact page has no sw.js to serve and must not try).
 */

interface Where {
  protocol: string;
  hostname: string;
}

/** Service workers need a secure context: https, or plain http on this machine. */
export function canRegister(where: Where, nav: { serviceWorker?: unknown } | undefined): boolean {
  if (!nav || !("serviceWorker" in nav) || !nav.serviceWorker) return false;
  if (where.protocol === "https:") return true;
  return where.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(where.hostname);
}

/** `url` is absolute so a deep link (which the server answers with index.html) registers the same worker. */
export function registerServiceWorker(url = `${import.meta.env.BASE_URL}sw.js`): void {
  if (!canRegister(location, navigator)) return;
  // The app works without it; offline is a bonus.
  const register = () => void navigator.serviceWorker.register(url).catch(() => {});
  // After load, so the first visit's own requests come first.
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
