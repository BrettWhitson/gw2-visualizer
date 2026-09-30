/**
 * Service worker: makes the app installable and usable offline.
 *
 *  - Page navigations: network-first, falling back to the cache when offline, so a deploy shows up at once.
 *  - Built code (assets/): cache-first. Vite puts a content hash in every file name, so a cached copy never goes stale.
 *  - Stable assets (lib/, icons/, data/): stale-while-revalidate — instant loads, refreshed in the background.
 *  - Item icons (render.guildwars2.com): cache-first, capped. Only CORS responses are stored (opaque ones waste quota).
 *  - API calls: not cached here — game data lives in IndexedDB, prices should always be live.
 *
 * The build (vite-plugin-pwa) replaces self.__WB_MANIFEST with the pages and hashed files to precache. The version
 * comes from the registration URL (sw.js?v=<APP_VERSION>), so bumping APP_VERSION in src/config/constants.js rolls
 * out a fresh shell cache and drops the old one.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL_CACHE = `gw2ct-shell-${VERSION}`;
const ICON_CACHE = "gw2ct-icons-v1";
const MAX_CACHED_ICONS = 4000;
const ICON_HOST = "render.guildwars2.com";
const HASHED_ASSET_PATH = /\/assets\//;
const STABLE_ASSET_PATH = /\/(lib|icons|data)\//;

/** @type {{ url: string, revision: string | null }[]} */
const PRECACHE = self.__WB_MANIFEST;
const SHELL_URLS = ["./", ...PRECACHE.map((entry) => entry.url)];
const PAGES = new Set(SHELL_URLS.filter((url) => url.endsWith(".html")));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Bypass the HTTP cache so a page never pairs with files from an older deploy.
      .then((cache) =>
        cache.addAll(
          SHELL_URLS.map((url) => new Request(url, { cache: "reload" })),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) => name.startsWith("gw2ct-shell-") && name !== SHELL_CACHE,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, navigationCacheKey(url)));
  } else if (url.pathname.includes("/data/snapshot/")) {
    // The game-data snapshot is large and the app keeps it in IndexedDB: don't duplicate it in the SW cache.
    return;
  } else if (url.origin === self.location.origin) {
    event.respondWith(
      HASHED_ASSET_PATH.test(url.pathname)
        ? cacheFirst(request)
        : STABLE_ASSET_PATH.test(url.pathname)
          ? staleWhileRevalidate(request, event)
          : networkFirst(request),
    );
  } else if (url.hostname === ICON_HOST) {
    event.respondWith(cacheFirstIcon(request, event));
  }
  // Everything else (GW2 API, wiki links) goes straight to the network.
});

/**
 * Each page is cached under its own file name; the site root and unknown paths fall back to index.html. Hosts that
 * serve pretty URLs (Cloudflare Pages redirects /characters.html to /characters) are matched without the extension.
 */
function navigationCacheKey(url) {
  const name = url.pathname
    .split("/")
    .pop()
    .replace(/\.html$/, "");
  const page = `${name}.html`;
  return name && PAGES.has(page) ? page : "index.html";
}

/** @param {Request} request  @param {string} [cacheKey] store under this key instead (navigations → their page) */
async function networkFirst(request, cacheKey = request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(cacheKey, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(cacheKey, { ignoreSearch: true })) || Response.error()
    );
  }
}

/** Hashed files never change, so any stored copy will do (module scripts send an Origin header; ignore Vary: Origin). */
async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached || Response.error());
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return refresh;
}

async function cacheFirstIcon(request, event) {
  const cache = await caches.open(ICON_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "cors") {
    event.waitUntil(
      cache
        .put(request, response.clone())
        .then(() => trimCache(cache, MAX_CACHED_ICONS)),
    );
  }
  return response;
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(
    keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)),
  );
}
