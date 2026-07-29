const SHELL_VERSION = "v2";
const SHELL_CACHE_PREFIX = "tendnote-shell-";
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}${SHELL_VERSION}`;
const OFFLINE_URL = `/offline-${SHELL_VERSION}.html`;
const DESTINATION_CONFIG_URL = "/app-destinations.json";
const SHELL_ASSETS = [
  OFFLINE_URL,
  DESTINATION_CONFIG_URL,
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
  event.waitUntil(
    (async () => {
      const fallback = await notificationFallback();
      const url = typeof payload.data?.url === "string" ? payload.data.url : fallback;
      const title = typeof payload.title === "string" ? payload.title : "Tendnote reminder";
      const body =
        typeof payload.body === "string"
          ? payload.body
          : "Open Tendnote to see what needs your attention.";
      await self.registration.showNotification(title, {
        body,
        icon: `/icons/tendnote-192.png?asset=${SHELL_VERSION}`,
        badge: `/icons/tendnote-badge-96.png?asset=${SHELL_VERSION}`,
        tag: typeof payload.tag === "string" ? payload.tag : "tendnote-reminder",
        data: { url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const fallback = await notificationFallback();
      let target = new URL(event.notification.data?.url ?? fallback, self.location.origin);
      if (target.origin !== self.location.origin) {
        target = new URL(fallback, self.location.origin);
      }
      const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
      const existing = clients.find((client) => new URL(client.url).origin === target.origin);
      if (existing) {
        await existing.focus();
        return existing.navigate(target.href);
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});

async function notificationFallback() {
  try {
    let response;
    try {
      const fresh = await fetch(DESTINATION_CONFIG_URL);
      if (!fresh.ok) throw new Error("Destination configuration unavailable.");
      response = fresh;
      const copy = fresh.clone();
      void caches.open(SHELL_CACHE).then((cache) => cache.put(DESTINATION_CONFIG_URL, copy));
    } catch {
      response = await caches.match(DESTINATION_CONFIG_URL);
    }
    if (!response) throw new Error("Destination configuration unavailable.");
    const config = await response.json();
    if (typeof config.notificationFallback !== "string") {
      throw new Error("Destination configuration invalid.");
    }
    const target = new URL(config.notificationFallback, self.location.origin);
    if (target.origin === self.location.origin) {
      return `${target.pathname}${target.search}${target.hash}`;
    }
  } catch {
    // The minimal root destination remains safe if an old installation cannot
    // refresh the shared destination configuration.
  }
  return "/";
}

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

  if (url.pathname === DESTINATION_CONFIG_URL) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok) throw new Error("Destination configuration unavailable.");
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response("Destination configuration unavailable.", { status: 503 });
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
