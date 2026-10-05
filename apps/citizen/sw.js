// Service worker for the served citizen app. vite.config.ts fills in VERSION and SHELL at build
// time and emits the result as dist/sw.js; the single-file build has none.
//   - App shell (index, hashed assets, manifest, icons): cached on install, served from cache.
//     Other hashed assets are cached the first time they are fetched.
//   - Pages: network first; the saved app page when offline or when the server answers 5xx.
//     Only the app page itself (/ or /index.html, as HTML) is ever saved as the offline app.
//   - The Docket snapshot: network first, the last copy when offline or on 5xx, so the list
//     still works.
//   - /api/* and anything not from this origin: never touched, never cached.
const VERSION = "__VERSION__";
const SHELL = __SHELL__;
const SHELL_CACHE = `citizen-shell-${VERSION}`;
// The snapshot outlives app updates: a new version must not throw away the only offline copy.
const DATA_CACHE = "citizen-data-1";
const SNAPSHOT = "data/snapshot.json";
// How long to wait for the network before using a saved copy (only when one exists).
const NETWORK_TIMEOUT_MS = 4000;

const scope = () => new URL(self.registration.scope);
const at = (path) => new URL(path, scope()).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Bypass the HTTP and edge caches so a new version never stores an old icon or manifest.
      .then((cache) => cache.addAll(SHELL.map((path) => new Request(at(path), { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("citizen-") && k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Saves a copy in the background. A failed write (quota, unsupported response) never fails the request. */
function save(event, cacheName, key, response) {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => cache.put(key, response))
      .catch(() => {}),
  );
}

/** Whole, successful responses only: never an error page and never a partial (206) body. */
const storable = (response) => response.ok && response.status !== 206;

/** The network, but no longer than NETWORK_TIMEOUT_MS when there is a saved copy to fall back on. */
function fetchWithin(request, hasFallback) {
  if (!hasFallback) return fetch(request);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("network timeout")), NETWORK_TIMEOUT_MS);
  });
  return Promise.race([fetch(request), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Network first. Falls back to the saved copy under `key` when the network fails, is too slow, or
 * the server answers 5xx. Saves the response under `key` only when `keep(response)` says so.
 */
async function networkFirst(event, cacheName, key, keep) {
  const cached = await caches
    .open(cacheName)
    .then((cache) => cache.match(key))
    .catch(() => undefined);
  let response;
  try {
    response = await fetchWithin(event.request, !!cached);
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
  if (response.status >= 500 && cached) return cached;
  if (storable(response) && keep(response)) save(event, cacheName, key, response.clone());
  return response;
}

/** Cache first; on a miss, fetch and (when `store` is set) save the response for next time. */
async function cacheFirst(event, store) {
  const hit = await caches.match(event.request);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (store && response.status === 200) save(event, SHELL_CACHE, event.request, response.clone());
  return response;
}

/** True for the app page itself: / or /index.html in scope, served as HTML. */
function isAppPage(url, response) {
  const page = url.pathname === scope().pathname || url.pathname === new URL("index.html", scope()).pathname;
  const html = (response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html");
  return page && html && response.type !== "opaque" && (!response.url || new URL(response.url).origin === self.location.origin);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (url.href === at(SNAPSHOT)) {
    event.respondWith(networkFirst(event, DATA_CACHE, SNAPSHOT, () => true));
  } else if (request.mode === "navigate") {
    // Routes live in the hash, so every page is the one index.html. Offline, any page opens the
    // app; online, only a real app page may replace the saved one (never /healthz, JSON or an icon).
    event.respondWith(networkFirst(event, SHELL_CACHE, "./", (response) => isAppPage(url, response)));
  } else if (SHELL.some((path) => at(path) === url.href)) {
    event.respondWith(cacheFirst(event, false));
  } else if (url.pathname.startsWith(new URL("assets/", scope()).pathname)) {
    // Hashed build files never change, so the first copy fetched is good forever. This keeps a
    // page saved from the network usable offline even if it points at files this version did not install.
    event.respondWith(cacheFirst(event, true));
  }
});
