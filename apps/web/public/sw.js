const STATIC_CACHE = "owntube-static-v11";
const PAGE_CACHE = "owntube-pages-v11";
const IMAGE_CACHE = "owntube-images-v11";
const STATIC_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/logo-dark.png?v=10",
  "/logo-light.png?v=10",
  "/favicon-dark.ico?v=10",
  "/favicon-light.ico?v=10",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key !== STATIC_CACHE &&
                key !== PAGE_CACHE &&
                key !== IMAGE_CACHE,
            )
            .map((oldKey) => caches.delete(oldKey)),
        ),
      ),
  );
  self.clients.claim();
});

/**
 * Requests the service worker must never touch: API calls, Next.js RSC
 * navigation fetches (a cached or substituted payload there makes the router
 * render the wrong page — a failed `/watch` fetch used to come back as the
 * cached home page, so tapping a video "went home"), and media/manifest
 * routes (Range requests, huge bodies, and hls.js/dash.js need the real
 * network response and its errors).
 */
const PASSTHROUGH_PREFIXES = [
  "/api/",
  "/hls/",
  "/dash/",
  "/stream/",
  "/invidious/",
  "/captions/",
  "/dvr/",
  "/yt-hls",
  "/enclosure/",
];

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) return;
  if (PASSTHROUGH_PREFIXES.some((p) => reqUrl.pathname.startsWith(p))) return;
  if (
    event.request.headers.get("RSC") === "1" ||
    reqUrl.searchParams.has("_rsc")
  ) {
    return;
  }

  const isDocument = event.request.mode === "navigate";
  const isNextStaticAsset = reqUrl.pathname.startsWith("/_next/static/");
  const isScriptOrStyle =
    reqUrl.pathname.endsWith(".js") || reqUrl.pathname.endsWith(".css");
  const isImage =
    reqUrl.pathname.endsWith(".png") ||
    reqUrl.pathname.endsWith(".jpg") ||
    reqUrl.pathname.endsWith(".jpeg") ||
    reqUrl.pathname.endsWith(".webp") ||
    reqUrl.pathname.endsWith(".svg");

  if (isScriptOrStyle) {
    // Network-first avoids serving stale CSS/JS after deploy.
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            void caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put(event.request, copy));
          }
          return resp;
        })
        .catch(() =>
          caches.match(event.request).then((hit) => hit || Response.error()),
        ),
    );
    return;
  }

  if (isNextStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            void caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put(event.request, copy));
          }
          return resp;
        });
      }),
    );
    return;
  }

  if (isImage) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((resp) => {
            if (resp.ok) {
              const copy = resp.clone();
              void caches
                .open(IMAGE_CACHE)
                .then((cache) => cache.put(event.request, copy));
            }
            return resp;
          })
          .catch(() => cached || Response.error());
        return cached || network;
      }),
    );
    return;
  }

  if (isDocument) {
    // Network-first; a redirect (e.g. an auth proxy's login page) passes
    // through untouched. Only a genuine network failure falls back to this
    // page's cached copy — never to a *different* page, which would show the
    // wrong content under the requested URL.
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          if (resp.ok && resp.type === "basic") {
            const copy = resp.clone();
            void caches
              .open(PAGE_CACHE)
              .then((cache) => cache.put(event.request, copy));
          }
          return resp;
        })
        .catch(() =>
          caches.match(event.request).then((hit) => hit || Response.error()),
        ),
    );
    return;
  }

  // Anything else is not intercepted: the browser fetches it normally.
});
