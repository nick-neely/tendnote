const SHELL_VERSION = "v2";
const SHELL_CACHE_PREFIX = "tendnote-shell-";
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}${SHELL_VERSION}`;
const OFFLINE_URL = `/offline-${SHELL_VERSION}.html`;
const SHELL_ASSETS = [
  OFFLINE_URL,
  `/icons/tendnote-192.png?asset=${SHELL_VERSION}`,
  `/icons/tendnote-512.png?asset=${SHELL_VERSION}`,
  `/icons/tendnote-maskable-512.png?asset=${SHELL_VERSION}`,
  `/icons/tendnote-mark-light.png?asset=${SHELL_VERSION}`,
  `/icons/tendnote-mark-dark.png?asset=${SHELL_VERSION}`,
  `/icons/tendnote-badge-96.png?asset=${SHELL_VERSION}`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(SHELL_CACHE_PREFIX) && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }
  const url = typeof payload.data?.url === "string" ? payload.data.url : "/actions";
  event.waitUntil(
    self.registration.showNotification("Tendnote reminder", {
      body: "Open Tendnote to see what needs your attention.",
      icon: `/icons/tendnote-192.png?asset=${SHELL_VERSION}`,
      badge: `/icons/tendnote-badge-96.png?asset=${SHELL_VERSION}`,
      tag: typeof payload.tag === "string" ? payload.tag : "tendnote-reminder",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = new URL(event.notification.data?.url ?? "/actions", self.location.origin);
  if (target.origin !== self.location.origin) target = new URL("/actions", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then(async (clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === target.origin);
      if (existing) {
        await existing.focus();
        return existing.navigate(target.href);
      }
      return self.clients.openWindow(target.href);
    }),
  );
});

function isVersionedShellAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
}

function isAuthoritativeRequest(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/eve/");
}

async function notifyCacheMismatch() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const client of clients) client.postMessage({ type: "CACHE_VERSION_MISMATCH" });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    isAuthoritativeRequest(url)
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const fallback = await caches.match(OFFLINE_URL);
        if (fallback) return fallback;
        await notifyCacheMismatch();
        return new Response("Tendnote needs a connection. Reconnect and refresh.", {
          headers: { "content-type": "text/plain; charset=utf-8" },
          status: 503,
        });
      }),
    );
    return;
  }

  if (isVersionedShellAsset(url) || SHELL_ASSETS.includes(`${url.pathname}${url.search}`)) {
    event.respondWith(
      caches.match(request).then(async (cached) => {
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        } catch (error) {
          await notifyCacheMismatch();
          throw error;
        }
      }),
    );
  }
});
