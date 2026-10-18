import { hex } from "@scure/base";
import { BroadcastError, ConnectionError, type BlockHeader, type HistoryEntry } from "./backend";
import type { ConnectionStatus, ElectrumBackend } from "./electrum";
import { handshake } from "./handshake";

/** How often it asks for a new tip, since HTTP cannot push one. */
export const POLL_SECONDS = 30;
// A self-hosted instance shares a small machine with the node.
const CONCURRENCY = 4;
// https://github.com/Blockstream/esplora/blob/master/API.md#get-scripthashhashtxschainlast_seen_txid
const PAGE = 25;

type Tx = { txid: string; status: { confirmed: boolean; block_height?: number }; vin: { txid: string }[] };
type Stats = { chain_stats: { tx_count: number }; mempool_stats: { tx_count: number } };

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    path: string,
  ) {
    super(`${status} from ${path}: ${body}`);
  }
}

/** fetch itself failed: nothing answered that the page may read. */
class Unreached extends Error {}

/**
 * Esplora takes the sha256 of the script in byte order, Electrum the reverse.
 * https://github.com/Blockstream/electrs/blob/new-index/src/rest.rs (parse_scripthash)
 */
const esploraHash = (scriptHash: string) => hex.encode(hex.decode(scriptHash).reverse());

/**
 * A `WalletBackend` over the Esplora HTTP API, `https://` or `http://`.
 * https://github.com/Blockstream/esplora/blob/master/API.md
 *
 * HTTP has no subscriptions. It polls for a new tip instead, and a new tip
 * reports every subscribed scripthash as changed, so payments that are only
 * in the mempool show at the next block or the next refresh.
 */
export function esploraBackend(
  url: string,
  { timeout = 10_000, poll = POLL_SECONDS * 1000, fetch = (input: string, init?: RequestInit) => globalThis.fetch(input, init) } = {},
): ElectrumBackend {
  const base = url.replace(/\/+$/, "");
  let status: ConnectionStatus = "disconnected";
  let tip: BlockHeader | null = null;
  let tipHash = "";
  let checking: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = 0;
  const waiting: (() => void)[] = [];
  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  const headerListeners = new Set<(tip: BlockHeader) => void>();
  const scriptHashListeners = new Set<{ scriptHashes: string[]; notify: (scriptHash: string) => void }>();

  function setStatus(next: ConnectionStatus): void {
    status = next;
    for (const listener of statusListeners) listener(next);
  }

  async function get(path: string, init: RequestInit = {}, wait = timeout * 6): Promise<string> {
    while (active >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      const response = await fetch(base + path, { ...init, signal: AbortSignal.timeout(wait) }).catch((error) => {
        throw new Unreached(String(error?.message ?? error), { cause: error });
      });
      const body = (await response.text()).trim();
      if (!response.ok) throw new HttpError(response.status, body, path);
      return body;
    } finally {
      active--;
      waiting.shift()?.();
    }
  }

  async function check(wait?: number): Promise<void> {
    const hash = await get("/blocks/tip/hash", {}, wait);
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("Not a block hash");
    if (hash === tipHash) return;
    const [block, header] = await Promise.all([get(`/block/${hash}`, {}, wait), get(`/block/${hash}/header`, {}, wait)]);
    const first = !tip;
    tip = { height: (JSON.parse(block) as { height: number }).height, header: hex.decode(header) };
    tipHash = hash;
    if (first) return;
    for (const listener of headerListeners) listener(tip);
    for (const { scriptHashes, notify } of scriptHashListeners) for (const hash of scriptHashes) notify(hash);
  }

  const refresh = () => (checking ??= check().finally(() => (checking = null)));

  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await refresh();
        if (status === "retrying") setStatus("connected");
      } catch {
        if (status === "connected") setStatus("retrying");
      }
      if (status !== "disconnected") schedule();
    }, poll);
  }

  /** A browser hides why a request failed, so the cause is found by trying around it. */
  async function diagnose(error: unknown): Promise<ConnectionError> {
    if (!(error instanceof Unreached)) return new ConnectionError("not-esplora");
    if ((error.cause as Error)?.name === "TimeoutError") return new ConnectionError("timeout");
    const opaque = await fetch(`${base}/blocks/tip/hash`, { mode: "no-cors", signal: AbortSignal.timeout(timeout) }).then(
      () => true,
      () => false,
    );
    if (opaque) return new ConnectionError("cors");
    try {
      (await handshake(base.replace(/^http/, "ws"), timeout)).close();
    } catch (failure) {
      if (failure instanceof ConnectionError && failure.failure !== "not-electrum") return failure;
    }
    return new ConnectionError("refused");
  }

  function connected(): void {
    if (status === "disconnected" || !tip) throw new Error("The backend is not connected");
  }

  async function history(scriptHash: string): Promise<Tx[]> {
    const path = `/scripthash/${esploraHash(scriptHash)}`;
    const { chain_stats, mempool_stats } = JSON.parse(await get(path)) as Stats;
    const total = chain_stats.tx_count + mempool_stats.tx_count;
    if (!total) return [];
    const txs = JSON.parse(await get(`${path}/txs`)) as Tx[];
    let page = txs.filter((tx) => tx.status.confirmed);
    while (page.length === PAGE) {
      page = JSON.parse(await get(`${path}/txs/chain/${page.at(-1)!.txid}`)) as Tx[];
      txs.push(...page);
    }
    if (txs.length < total) {
      throw new Error(`The server sent ${txs.length} of an address's ${total} transactions. It does not page history the way Esplora does.`);
    }
    return txs.reverse();
  }

  return {
    async connect() {
      setStatus("connecting");
      try {
        await check(timeout);
      } catch (error) {
        setStatus("disconnected");
        throw await diagnose(error);
      }
      setStatus("connected");
      schedule();
    },

    close() {
      setStatus("disconnected");
      clearTimeout(timer);
      headerListeners.clear();
      scriptHashListeners.clear();
    },

    onStatus(listener) {
      statusListeners.add(listener);
      return () => void statusListeners.delete(listener);
    },

    server: () => (tip ? { software: "Esplora", implementation: null } : null),

    async chainTip() {
      connected();
      await refresh();
      return tip!;
    },

    async subscribeHeaders(listener) {
      connected();
      headerListeners.add(listener);
      return () => void headerListeners.delete(listener);
    },

    blockHeaders: (heights) =>
      Promise.all(heights.map(async (height) => hex.decode(await get(`/block/${await get(`/block-height/${height}`)}/header`)))),

    async history(scriptHashes) {
      const lists = await Promise.all(scriptHashes.map(history));
      const confirmed = new Map(lists.flat().map((tx) => [tx.txid, tx.status.confirmed]));
      const parents = lists.flat().flatMap((tx) => (tx.status.confirmed ? [] : tx.vin.map((input) => input.txid)));
      await Promise.all(
        [...new Set(parents)]
          .filter((txid) => !confirmed.has(txid))
          .map(async (txid) => confirmed.set(txid, (JSON.parse(await get(`/tx/${txid}/status`)) as Tx["status"]).confirmed)),
      );
      return lists.map((txs) =>
        txs.map(
          ({ txid, status, vin }): HistoryEntry => ({
            txid,
            height: status.confirmed ? status.block_height! : null,
            unconfirmedParents: !status.confirmed && vin.some((input) => confirmed.get(input.txid) === false),
          }),
        ),
      );
    },

    transactions: (txids) => Promise.all(txids.map(async (txid) => hex.decode(await get(`/tx/${txid}/hex`)))),

    async subscribeScriptHashes(scriptHashes, listener) {
      connected();
      const entry = { scriptHashes, notify: listener };
      scriptHashListeners.add(entry);
      return () => void scriptHashListeners.delete(entry);
    },

    async feeHistogram() {
      const { fee_histogram } = JSON.parse(await get("/mempool")) as { fee_histogram: [number, number][] };
      return fee_histogram.map(([feeRate, vsize]) => ({ feeRate, vsize }));
    },

    async broadcast(raw) {
      try {
        return await get("/tx", { method: "POST", body: hex.encode(raw) });
      } catch (error) {
        if (error instanceof HttpError && error.status === 400) throw new BroadcastError(error.body);
        throw error;
      }
    },
  };
}
