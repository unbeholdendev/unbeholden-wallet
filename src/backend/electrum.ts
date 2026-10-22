import { hex } from "@scure/base";
import {
  BroadcastError,
  ConnectionError,
  type BlockHeader,
  type HistoryEntry,
  type Unsubscribe,
  type WalletBackend,
} from "./backend";
import { handshake } from "./handshake";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "retrying";

export type ServerInfo = {
  /** As `server.version` reports it, e.g. "Fulcrum 2.1.3". */
  software: string;
  implementation: "Fulcrum" | "ElectrumX" | null;
};

export type ElectrumBackend = WalletBackend & {
  /** Calls back on every change of connection status. */
  onStatus(listener: (status: ConnectionStatus) => void): Unsubscribe;
  /** Null until the first connection succeeds. */
  server(): ServerInfo | null;
};

// https://electrum-protocol.readthedocs.io/en/latest/protocol-methods.html#server-version
const PROTOCOL = "1.4";
// Fulcrum refuses a batch over its max_batch, 345 by default:
// https://github.com/cculianu/Fulcrum/blob/v2.1.3/doc/fulcrum-example-config.conf
const BATCH = 100;
const MAX_BACKOFF = 30_000;

class RpcError extends Error {}

function implementation(software: string): ServerInfo["implementation"] {
  if (/^fulcrum/i.test(software)) return "Fulcrum";
  if (/^electrumx/i.test(software)) return "ElectrumX";
  return null;
}

function toHeader(result: unknown): BlockHeader {
  const { height, hex: header } = result as { height: number; hex: string };
  return { height, header: hex.decode(header) };
}

/**
 * A `WalletBackend` over Electrum JSON-RPC on a WebSocket, `wss://` or
 * `ws://`. Once connected it reconnects by itself, with backoff, until
 * `close()`.
 * https://electrum-protocol.readthedocs.io/en/latest/protocol-methods.html
 */
export function electrumBackend(
  url: string,
  { timeout = 10_000 } = {},
): ElectrumBackend {
  let socket: WebSocket | null = null;
  let status: ConnectionStatus = "disconnected";
  let info: ServerInfo | null = null;
  let tip: BlockHeader | null = null;
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  const statuses = new Map<string, unknown>();
  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  const headerListeners = new Set<(tip: BlockHeader) => void>();
  const scriptHashListeners = new Set<{
    scriptHashes: Set<string>;
    notify: (scriptHash: string) => void;
  }>();

  function setStatus(next: ConnectionStatus): void {
    status = next;
    for (const listener of statusListeners) listener(next);
  }

  function send(calls: [string, unknown[]][]): Promise<unknown>[] {
    const open = socket;
    if (!open) {
      return calls.map(() =>
        Promise.reject(new Error("The backend isn't connected")),
      );
    }
    const requests = calls.map(([method, params]) => ({
      jsonrpc: "2.0",
      id: nextId++,
      method,
      params,
    }));
    const results = requests.map(
      ({ id }) =>
        new Promise<unknown>((resolve, reject) => {
          // Well past the handshake timeout: a batch of large transactions can be slow to arrive.
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error("The server didn't answer in time"));
          }, timeout * 6);
          pending.set(id, {
            resolve: (result) => {
              clearTimeout(timer);
              resolve(result);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          });
        }),
    );
    open.send(JSON.stringify(requests.length === 1 ? requests[0] : requests));
    return results;
  }

  function call(method: string, ...params: unknown[]): Promise<unknown> {
    return send([[method, params]])[0]!;
  }

  async function batch(method: string, params: unknown[][]): Promise<unknown[]> {
    const chunks: Promise<unknown[]>[] = [];
    for (let i = 0; i < params.length; i += BATCH) {
      const calls = params
        .slice(i, i + BATCH)
        .map((p): [string, unknown[]] => [method, p]);
      chunks.push(Promise.all(send(calls)));
    }
    return (await Promise.all(chunks)).flat();
  }

  function notifyScriptHash(scriptHash: string): void {
    for (const { scriptHashes, notify } of scriptHashListeners) {
      if (scriptHashes.has(scriptHash)) notify(scriptHash);
    }
  }

  function receive(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    for (const message of [parsed].flat() as Record<string, any>[]) {
      if (message.method === "blockchain.headers.subscribe") {
        tip = toHeader(message.params[0]);
        for (const listener of headerListeners) listener(tip);
      } else if (message.method === "blockchain.scripthash.subscribe") {
        const [scriptHash, scriptStatus] = message.params;
        statuses.set(scriptHash, scriptStatus);
        notifyScriptHash(scriptHash);
      } else {
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        if (message.error) request.reject(new RpcError(message.error.message));
        else request.resolve(message.result);
      }
    }
  }

  function drop(lost: WebSocket): void {
    if (socket !== lost) return;
    socket = null;
    for (const request of pending.values()) {
      request.reject(new Error("The connection to the server was lost"));
    }
    pending.clear();
  }

  async function establish(): Promise<void> {
    const opened = await handshake(url, timeout);
    socket = opened;
    opened.onmessage = (event) => receive(String(event.data));
    opened.onclose = () => {
      const wasConnected = socket === opened && status === "connected";
      drop(opened);
      if (wasConnected) void retry(0);
    };
    const previousTip = tip;
    try {
      const version = await Promise.race([
        call("server.version", "unbeholden-wallet", PROTOCOL),
        new Promise((_, reject) => setTimeout(reject, timeout)),
      ]);
      if (!Array.isArray(version) || typeof version[0] !== "string") {
        throw new Error("No server.version");
      }
      info = { software: version[0], implementation: implementation(version[0]) };
      tip = toHeader(await call("blockchain.headers.subscribe"));
    } catch {
      opened.onclose = null;
      drop(opened);
      opened.close();
      throw new ConnectionError("not-electrum");
    }
    if (previousTip && hex.encode(previousTip.header) !== hex.encode(tip.header)) {
      for (const listener of headerListeners) listener(tip);
    }
    const scriptHashes = [...statuses.keys()];
    const results = await batch(
      "blockchain.scripthash.subscribe",
      scriptHashes.map((scriptHash) => [scriptHash]),
    );
    scriptHashes.forEach((scriptHash, i) => {
      if (statuses.get(scriptHash) === results[i]) return;
      statuses.set(scriptHash, results[i]);
      notifyScriptHash(scriptHash);
    });
  }

  async function retry(failures: number): Promise<void> {
    setStatus("retrying");
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(1000 * 2 ** failures, MAX_BACKOFF)),
    );
    if (status !== "retrying") return;
    try {
      await establish();
      if (status === "retrying") setStatus("connected");
      else socket?.close();
    } catch {
      if (status === "retrying") void retry(failures + 1);
    }
  }

  function connected(): void {
    if (!socket) throw new Error("The backend isn't connected");
  }

  return {
    async connect() {
      setStatus("connecting");
      try {
        await establish();
      } catch (error) {
        setStatus("disconnected");
        throw error;
      }
      setStatus("connected");
    },

    close() {
      setStatus("disconnected");
      const open = socket;
      if (open) drop(open);
      open?.close();
      headerListeners.clear();
      scriptHashListeners.clear();
      statuses.clear();
    },

    onStatus(listener) {
      statusListeners.add(listener);
      return () => void statusListeners.delete(listener);
    },

    server: () => info,

    async chainTip() {
      connected();
      return tip!;
    },

    async subscribeHeaders(listener) {
      connected();
      headerListeners.add(listener);
      return () => void headerListeners.delete(listener);
    },

    async blockHeaders(heights) {
      const results = await batch(
        "blockchain.block.header",
        heights.map((height) => [height]),
      );
      return results.map((result) => hex.decode(result as string));
    },

    async history(scriptHashes) {
      const results = await batch(
        "blockchain.scripthash.get_history",
        scriptHashes.map((scriptHash) => [scriptHash]),
      );
      return (results as { tx_hash: string; height: number }[][]).map(
        (entries) =>
          entries.map(
            ({ tx_hash, height }): HistoryEntry => ({
              txid: tx_hash,
              height: height > 0 ? height : null,
              unconfirmedParents: height === -1,
            }),
          ),
      );
    },

    async transactions(txids) {
      const results = await batch(
        "blockchain.transaction.get",
        txids.map((txid) => [txid]),
      );
      return results.map((result) => hex.decode(result as string));
    },

    async subscribeScriptHashes(scriptHashes, listener) {
      connected();
      const entry = { scriptHashes: new Set(scriptHashes), notify: listener };
      scriptHashListeners.add(entry);
      const fresh = scriptHashes.filter((hash) => !statuses.has(hash));
      const results = await batch(
        "blockchain.scripthash.subscribe",
        fresh.map((hash) => [hash]),
      );
      // A notification that arrived while subscribing is newer than this reply.
      fresh.forEach((hash, i) => {
        if (!statuses.has(hash)) statuses.set(hash, results[i]);
      });
      return () => void scriptHashListeners.delete(entry);
    },

    async feeHistogram() {
      const result = (await call("mempool.get_fee_histogram")) as [
        number,
        number,
      ][];
      return result.map(([feeRate, vsize]) => ({ feeRate, vsize }));
    },

    async broadcast(raw) {
      try {
        return (await call(
          "blockchain.transaction.broadcast",
          hex.encode(raw),
        )) as string;
      } catch (error) {
        if (error instanceof RpcError) throw new BroadcastError(error.message);
        throw error;
      }
    },
  };
}
