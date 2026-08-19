/*
 * Network-first service worker.
 *
 * The Pi is on the same LAN, so the network is the fast path and freshness
 * matters more than milliseconds: an update must never be masked by a cached
 * shell. The cache exists so that opening the dashboard while the Pi is down
 * still renders the interface (which then shows itself as disconnected)
 * instead of a browser error page.
 */
const CACHE = "mopitor-v1";
const SHELL = [
  "/",
  "/index.html",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // the WebSocket upgrade and anything cross-origin are none of our business
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        void caches
          .open(CACHE)
          .then((cache) => cache.put(request, copy))
          .catch(() => {});
        return response;
      })
      .catch(() =>
        caches
          .match(request)
          .then((cached) => cached ?? caches.match("/index.html"))
          // a navigation with nothing cached: let the browser show its own error
          .then((response) => response ?? Response.error()),
      ),
  );
});
