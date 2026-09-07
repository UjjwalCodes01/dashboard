/* EdgeFleet service worker.
 *
 * The whole telemetry engine runs in the browser, so once the app shell and the map assets are
 * cached the dashboard works with no network at all — the same property the fleet it monitors has.
 *
 * Versioning: the page registers `/sw.js?v=<build id>`. A new build ⇒ new URL ⇒ this file is
 * re-installed and, on activate, every cache from an older build is deleted.
 */
const BUILD = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `edgefleet-${BUILD}`;

/** Pre-rendered routes + assets the mock engine needs at boot. */
const PRECACHE = [
  "/",
  "/hub",
  "/resources",
  "/tasks",
  "/network",
  "/offline",
  "/manifest.webmanifest",
  "/maps/warehouse-10-20-10-2-1.map",
  "/maps/map_config.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];

/** Robot pages are server-rendered per id; warm the ten default robots after activation, off the critical path. */
const WARM = Array.from({ length: 10 }, (_, i) => `AMR-${String(i + 1).padStart(2, "0")}`).flatMap((id) => [`/robots/${id}`, `/robots/${id}/health`]);

const NAV_TIMEOUT_MS = 4000;

/** Cache a URL, and for HTML also cache every /_next/static asset it references so the route works offline. */
async function cacheWithAssets(cache, url) {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return;
    await cache.put(url, res.clone());
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html")) return;
    const html = await res.text();
    const assets = new Set();
    for (const m of html.matchAll(/\/_next\/static\/[^"'\s\\)]+/g)) assets.add(m[0]);
    await Promise.all(
      Array.from(assets).map(async (a) => {
        if (await cache.match(a)) return;
        try {
          const r = await fetch(a);
          if (r.ok) await cache.put(a, r);
        } catch {
          /* one missing chunk must not fail the install */
        }
      }),
    );
  } catch {
    /* fail-soft: a route that cannot be fetched is simply not precached */
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(PRECACHE.map((u) => cacheWithAssets(cache, u)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("edgefleet-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      // warm robot pages in the background; never block activation on it
      const cache = await caches.open(CACHE);
      WARM.reduce((p, u) => p.then(() => cacheWithAssets(cache, u)), Promise.resolve());
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isRsc(req) {
  return req.headers.get("RSC") === "1" || new URL(req.url).searchParams.has("_rsc");
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  return cached || (await refresh) || Response.error();
}

async function networkFirst(req, { timeout, fallback } = {}) {
  const cache = await caches.open(CACHE);
  try {
    const controller = new AbortController();
    const timer = timeout ? setTimeout(() => controller.abort(), timeout) : null;
    const res = await fetch(req, { signal: controller.signal });
    if (timer) clearTimeout(timer);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = (await cache.match(req, { ignoreSearch: true })) || (await caches.match(req, { ignoreSearch: true }));
    if (cached) return cached;
    if (fallback) {
      const fb = await cache.match(fallback);
      if (fb) return fb;
    }
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts are self-hosted; nothing cross-origin to cache

  // Next's client-side navigation payloads: let them fail fast offline so the router falls back to a
  // full navigation, which the navigate branch below serves from cache.
  if (isRsc(req)) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, { timeout: NAV_TIMEOUT_MS, fallback: "/offline" }));
    return;
  }
  if (url.pathname.startsWith("/maps/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  event.respondWith(networkFirst(req));
});
