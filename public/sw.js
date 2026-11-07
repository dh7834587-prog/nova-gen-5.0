/* NOVA GEN 5.0 service worker — offline shell only.
 * API traffic is never cached: NOVA must not show stale private data. */

const VERSION = "nova-gen-5.0-v1";
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;
const PRECACHE = ["/", "/offline.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch {
            /* A missing shell file must not block installation. */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

function isAsset(url) {
  return url.pathname.startsWith("/assets/") || /\.(?:css|js|png|svg|webp|woff2?)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return; // Always hit the network: private data must stay fresh.

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(RUNTIME);
          cache.put("/", response.clone());
          return response;
        } catch {
          const cached = await caches.match("/");
          return cached ?? (await caches.match("/offline.html")) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (isAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(RUNTIME);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return cached ?? Response.error();
        }
      })(),
    );
  }
});
