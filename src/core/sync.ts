import { hex } from "@scure/base";
import { sha256x2 } from "@scure/btc-signer/utils.js";
import type { BlockHeader, Unsubscribe, WalletBackend } from "../backend/backend";
import { log } from "../log";
import type { Clock } from "../vault/vault";
import type { WalletCache } from "./cache";
import { blockTime, COINBASE, type View } from "./view";
import type { SyncProgress, WalletSnapshot } from "./wallet";

type Status = Pick<WalletSnapshot, "error" | "progress" | "reorg">;

/** Keeps `cache` current from a backend. `rebuild` derives the view from the cache and publishes it. */
export function startSync(
  cache: WalletCache,
  { now, emit, rebuild }: { now: Clock; emit: (change: Partial<Status>) => void; rebuild: () => View },
) {
  let closed = false;
  let backend: WalletBackend | null = null;
  let watching = false;
  let full = true;
  let newTip: BlockHeader | null = null;
  const dirty = new Set<string>();
  const subscribed = new Set<string>();
  const unsubscribes: Unsubscribe[] = [];
  let loop: Promise<void> | null = null;

  async function extendsStored(tip: BlockHeader): Promise<boolean> {
    const stored = cache.state.tip!;
    if (tip.height < stored.height) return false;
    if (tip.height === stored.height + 1) {
      return hex.encode(tip.header.slice(4, 36)) === hex.encode(sha256x2(hex.decode(stored.header)));
    }
    const [header] = tip.height === stored.height ? [tip.header] : await backend!.blockHeaders([stored.height]);
    return hex.encode(header!) === stored.header;
  }

  async function fetchTransactions(txids: string[], stage: SyncProgress["stage"]) {
    if (!txids.length) return;
    emit({ progress: { stage, done: 0, total: txids.length } });
    cache.store(txids, await backend!.transactions(txids));
  }

  async function syncOnce() {
    if (!watching) {
      unsubscribes.push(
        await backend!.subscribeHeaders((tip) => {
          newTip = tip;
          void request();
        }),
      );
      watching = true;
    }
    let everything = full;
    const tip = newTip ?? (full ? await backend!.chainTip() : null);
    let ask = new Set(dirty);
    full = false;
    newTip = null;
    dirty.clear();

    if (tip) {
      if (cache.state.tip && !(await extendsStored(tip))) {
        cache.reset();
        everything = true;
        emit({ reorg: { height: tip.height, at: now() } });
      }
      cache.state.tip = { height: tip.height, header: hex.encode(tip.header) };
      for (const hash of cache.hashes()) if (!subscribed.has(hash)) ask.add(hash);
    }
    if (everything) ask = new Set(cache.hashes());

    let pending = [...ask];
    let done = 0;
    while (pending.length) {
      emit({ progress: { stage: "history", done, total: done + pending.length } });
      const histories = await backend!.history(pending);
      if (histories.flat().some((e) => !/^[0-9a-f]{64}$/.test(e.txid)))
        throw new Error("The server sent a malformed txid");
      pending.forEach((hash, i) => {
        if (histories[i]!.length) cache.state.histories[hash] = histories[i]!;
        else delete cache.state.histories[hash];
      });
      done += pending.length;
      pending = cache.extend();
    }

    const entries = Object.values(cache.state.histories).flat();
    const txids = [...new Set(entries.map((e) => e.txid))];
    await fetchTransactions(
      txids.filter((t) => !cache.has(t)),
      "transactions",
    );
    const prevouts = new Set(
      txids.flatMap((t) => cache.parsed(t)!.inputs.map((i) => i.txid)).filter((t) => t !== COINBASE && !cache.has(t)),
    );
    await fetchTransactions([...prevouts], "transactions");

    const heights = [
      ...new Set(entries.flatMap((e) => (e.height === null || cache.state.times[e.height] ? [] : [e.height]))),
    ];
    if (heights.length) {
      emit({ progress: { stage: "blocks", done: 0, total: heights.length } });
      const headers = await backend!.blockHeaders(heights);
      heights.forEach((h, i) => (cache.state.times[h] = blockTime(headers[i]!)));
    }
    for (const e of entries) if (e.height === null) cache.state.seen[e.txid] ??= now();
    cache.state.syncedAt = now();

    await cache.persist();
    const view = rebuild();

    const watch = new Set(view.coins.map((c) => cache.scriptOf(c.address).hash));
    for (const hash of cache.gap()) watch.add(hash);
    const fresh = [...watch].filter((h) => !subscribed.has(h));
    if (fresh.length) {
      for (const h of fresh) subscribed.add(h);
      unsubscribes.push(
        await backend!.subscribeScriptHashes(fresh, (hash) => {
          dirty.add(hash);
          void request();
        }),
      );
    }
  }

  function request(): Promise<void> {
    // With nothing to await, the loop below would clear `loop` before it is set.
    if (!backend) return loop ?? Promise.resolve();
    loop ??= (async () => {
      try {
        while (!closed && backend && (full || newTip || dirty.size)) await syncOnce();
        if (!closed) emit(backend ? { progress: null, error: null } : { progress: null });
        if (!closed && backend) log("synced");
      } catch (error) {
        if (closed) return;
        full = true;
        log("sync failed", { name: (error as Error).name });
        emit({ error: backend ? (error as Error).message : null, progress: null });
      } finally {
        loop = null;
      }
    })();
    return loop;
  }

  return {
    /** Syncs on this backend from scratch, or stops syncing on null. */
    use(next: WalletBackend | null) {
      if (next === backend) return;
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
      subscribed.clear();
      watching = false;
      full = true;
      backend = next;
      if (next) emit({ progress: { stage: "history", done: 0, total: cache.hashes().length } });
      // A sync still running may fail on the old backend after this one is in.
      void (loop ? loop.then(request) : request());
    },
    refresh() {
      full = true;
      return request();
    },
    /** Syncs the history of these scripthashes. */
    check(hashes: string[]) {
      for (const hash of hashes) dirty.add(hash);
      return request();
    },
    async settled() {
      while (loop) await loop;
    },
    close() {
      closed = true;
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    },
  };
}
