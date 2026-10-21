// The wallet app used to live on this origin. Its service worker still serves the
// cached app to returning visitors, so this replaces it, removes itself and reloads.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((windows) => windows.forEach((w) => w.navigate(w.url))),
  );
});
