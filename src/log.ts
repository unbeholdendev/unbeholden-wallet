let remote = import.meta.env.PROD;

/**
 * Logs to the console and, when the container serves the app, to its stdout.
 * The line leaves the browser, so never pass a txid, an address, a key, an
 * amount, a label or a server URL.
 */
export function log(event: string, detail?: Record<string, string | number | boolean | null>) {
  console.info(event, detail ?? "");
  if (!remote) return;
  fetch("log", { method: "POST", body: JSON.stringify({ event, ...detail }), keepalive: true }).then(
    (response) => void (remote = response.ok),
    () => void (remote = false),
  );
}
