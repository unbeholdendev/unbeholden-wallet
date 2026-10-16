export const APP_VERSION = __APP_VERSION__;

/**
 * Registers the service worker that pins the app's code. A new version waits
 * until `onUpdate`'s `apply` is called, so code never changes mid-session.
 */
export function registerServiceWorker(onUpdate: (apply: () => void) => void) {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  sw.register("./sw.js").catch(() => null).then((registration) => {
    if (!registration) return;
    const offer = (worker: ServiceWorker) =>
      onUpdate(() => worker.postMessage("skip-waiting"));
    if (registration.waiting && sw.controller) offer(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && sw.controller) offer(worker);
      });
    });
    sw.addEventListener("controllerchange", () => location.reload());
  });
}
