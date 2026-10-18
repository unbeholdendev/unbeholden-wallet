import { ConnectionError } from "./backend";

// Unassigned, and not one of the ports browsers refuse to open:
// https://fetch.spec.whatwg.org/#port-blocking
const PROBE_PORT = "2";
// Pages on these hosts may open ws:// even from https:
// https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy
export const LOOPBACK = /^(localhost|.+\.localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

type Attempt = { socket: WebSocket | null; elapsed: number; timedOut: boolean };

function attempt(url: string, timeout: number): Promise<Attempt> {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = new WebSocket(url);
    const finish = (opened: boolean, timedOut = false) => {
      clearTimeout(timer);
      socket.onopen = socket.onerror = null;
      if (!opened) socket.close();
      const elapsed = performance.now() - started;
      resolve({ socket: opened ? socket : null, elapsed, timedOut });
    };
    const timer = setTimeout(() => finish(false, true), timeout);
    socket.onopen = () => finish(true);
    socket.onerror = () => finish(false);
  });
}

/**
 * A browser reports every failed handshake the same way, so the cause is
 * inferred. A refusal costs one round trip; a TLS or HTTP answer costs at
 * least two. So the failure is timed against a probe to a port that is almost
 * certainly closed on the same host.
 */
export async function handshake(url: string, timeout: number): Promise<WebSocket> {
  const target = new URL(url);
  if (
    target.protocol === "ws:" &&
    globalThis.location?.protocol === "https:" &&
    !LOOPBACK.test(target.hostname)
  ) {
    throw new ConnectionError("mixed-content");
  }
  target.port = PROBE_PORT;
  // Two rounds, because the first connection a runtime makes can pay one-off
  // start-up costs that look like an extra round trip.
  for (let round = 0; ; round++) {
    const main = await attempt(url, timeout);
    if (main.socket) return main.socket;
    if (main.timedOut) throw new ConnectionError("timeout");
    const probe = await attempt(target.href, Math.max(1000, 4 * main.elapsed));
    probe.socket?.close();
    // A host that ignores the closed port but failed this one fast did answer.
    // The 1ms absorbs timer jitter on a loopback connection.
    const answered = probe.timedOut || main.elapsed > 2 * probe.elapsed + 1;
    if (!answered) throw new ConnectionError("refused");
    if (round === 1) {
      throw new ConnectionError(
        target.protocol === "wss:" ? "certificate-rejected" : "not-electrum",
      );
    }
  }
}
