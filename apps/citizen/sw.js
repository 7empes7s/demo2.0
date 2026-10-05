// Service worker for the served citizen app. vite.config.ts fills in VERSION and SHELL at build
// time and emits the result as dist/sw.js; the single-file build has none.
//   - App shell (index, hashed assets, manifest, icons): cached on install, served from cache.
//   - Pages: network first, the cached page when offline.
//   - The Docket snapshot: network first, the last copy when offline, so the list still works.
//   - /api/* and anything not from this origin: never touched, never cached.
const VERSION = "__VERSION__";
const SHELL = __SHELL__;
const SHELL_CACHE = `citizen-shell-${VERSION}`;
// The snapshot outlives app updates: a new version must not throw away the only offline copy.
const DATA_CACHE = "citizen-data-1";
const SNAPSHOT = "data/snapshot.json";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
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

async function networkFirst(request, cacheName, key) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw error;
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  return hit ?? fetch(request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const scope = new URL(self.registration.scope);
  if (url.href === new URL(SNAPSHOT, scope).href) {
    event.respondWith(networkFirst(request, DATA_CACHE, SNAPSHOT));
  } else if (request.mode === "navigate") {
    // Routes live in the hash, so every page is the one index.html.
    event.respondWith(networkFirst(request, SHELL_CACHE, "./"));
  } else if (SHELL.some((path) => new URL(path, scope).href === url.href)) {
    event.respondWith(cacheFirst(request));
  }
});
