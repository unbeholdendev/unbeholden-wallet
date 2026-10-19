const CACHE = `app-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const request = event.request.mode === "navigate" ? "./" : event.request;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request, { ignoreVary: true }).then((hit) => hit ?? fetch(event.request)),
    ),
  );
});

// The only way a new version takes over an open tab: the user asked for it.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((windows) => windows[0]?.focus()));
});
