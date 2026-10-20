import { hex } from "@scure/base";
import { Address, OutScript, Transaction } from "@scure/btc-signer";
import { sha256x2 } from "@scure/btc-signer/utils.js";
import {
  scriptHash,
  type BlockHeader,
  type HistoryEntry,
  type Unsubscribe,
  type WalletBackend,
} from "../backend/backend";
import { log } from "../log";
import type { Clock, Store } from "../vault/vault";
import { outpoint } from "../wallet/coin";
import { deriveAddress } from "../wallet/derive";
import { NETWORKS } from "../wallet/network";
import { bip329Origin, formatBip329, parseBip329, sameOrigin, type Bip329Record } from "./bip329";
import {
  blockTime,
  COINBASE,
  deriveView,
  emptyCache,
  lastUsed as lastUsedOn,
  parseTx,
  type Cache,
  type Parsed,
  type View,
  type ViewSource,
} from "./view";
import { getWallet, walletDescriptor } from "./wallets";

export type { AddressInfo, Balance, TxInput, TxOutput, WalletCoin, WalletTx } from "./view";

export type SyncProgress = {
  stage: "history" | "transactions" | "blocks";
  done: number;
  total: number;
};

export type WalletSnapshot = Omit<View, "own"> & {
  id: string;
  /** Why the last sync failed, cleared by the next that succeeds. */
  error: string | null;
  /** Null when no sync is running. */
  progress: SyncProgress | null;
  /** Set when a reorg discarded the cache; cleared by `dismissReorg`. */
  reorg: { height: number; at: number } | null;
};

export type LabelType = "tx" | "addr" | "output";

export type WalletSession = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): WalletSnapshot;
  /** Syncs now. Resolves when done, never rejects. */
  refresh(): Promise<void>;
  /** Syncs on this backend from scratch, or stops syncing on null. The caller connects and closes it. */
  use(backend: WalletBackend | null): void;
  /** Resolves once no sync is running. */
  settled(): Promise<void>;
  /** Checks `count` more addresses on each chain, keeps them only up to the gap past any found used, and returns how many were found used. */
  scanDeeper(count?: number): Promise<number>;
  /** An empty or null label removes it. */
  setLabel(type: LabelType, ref: string, label: string | null): Promise<void>;
  setFrozen(coin: { txid: string; vout: number }, frozen: boolean): Promise<void>;
  /** Marks or clears the coins as paid by someone who knows who the user is. */
  setKyc(coins: { txid: string; vout: number }[], kyc: boolean): Promise<void>;
  exportLabels(): string;
  /** `skipped` counts unreadable lines and records labelled for another wallet. */
  importLabels(text: string): Promise<{ imported: number; skipped: number }>;
  /** Shows a just-broadcast transaction as unconfirmed before the server reports it. */
  addTransaction(raw: Uint8Array): Promise<void>;
  dismissReorg(): void;
  /** Stops syncing. */
  close(): void;
};

const PARSE = {
  allowUnknownInputs: true,
  allowUnknownOutputs: true,
  allowLegacyWitnessUtxo: true,
  disableScriptCheck: true,
};


export async function openWallet(
  vault: Store,
  id: string,
  server: WalletBackend | null,
  { now = Date.now as Clock, gapLimit = 20 } = {},
): Promise<WalletSession> {
  const record = await getWallet(vault, id);
  const descriptor = walletDescriptor(record);
  const network = NETWORKS[record.network];
  const chains = descriptor.keys[0]!.path.some(Array.isArray) ? 2 : 1;
  const origin = bip329Origin(descriptor);

  let cache =
    (await vault.get<Cache>(`cache/${id}/state`)) ??
    emptyCache(Array.from({ length: chains }, () => []));
  let raw: Record<string, string> = (await vault.get(`cache/${id}/txs`)) ?? {};
  const labels: Record<string, string> = (await vault.get(`labels/${id}`)) ?? {};
  const frozen = new Set<string>((await vault.get<string[]>(`frozen/${id}`)) ?? []);
  const kyc = new Set<string>((await vault.get<string[]>(`kyc/${id}`)) ?? []);

  const scripts = new Map<string, { script: string; hash: string }>();
  const scriptOf = (address: string) => {
    let found = scripts.get(address);
    if (!found) {
      const script = OutScript.encode(Address(network).decode(address));
      found = { script: hex.encode(script), hash: scriptHash(script) };
      scripts.set(address, found);
    }
    return found;
  };
  const addressOf = (script: string) => {
    try {
      return Address(network).encode(OutScript.decode(hex.decode(script)));
    } catch {
      return null;
    }
  };
  let parsedTxs = new Map<string, Parsed>();
  const parsed = (txid: string): Parsed | undefined => {
    if (!raw[txid]) return undefined;
    let p = parsedTxs.get(txid);
    if (!p) {
      p = parseTx(txid, hex.decode(raw[txid]));
      parsedTxs.set(txid, p);
    }
    return p;
  };
  const allHashes = () => cache.addresses.flat().map((a) => scriptOf(a).hash);
  const source = (): ViewSource => ({ descriptor, cache, labels, frozen, kyc, parsed, scriptOf, addressOf });
  const lastUsed = (chain: number) => lastUsedOn(source(), chain);

  /** Derives up to the gap limit past the last used address, and returns the new scripthashes. */
  function extend(minimum = 0): string[] {
    const added: string[] = [];
    for (let chain = 0; chain < chains; chain++) {
      const list = cache.addresses[chain]!;
      const need = Math.max(lastUsed(chain) + 1 + gapLimit, minimum);
      if (list.length >= need) continue;
      // Doubling keeps a long history to a few round trips, at the cost of some unused addresses.
      const target = minimum ? need : Math.max(need, list.length * 2);
      for (let i = list.length; i < target; i++) {
        const address = deriveAddress(descriptor, record.network, chain, i);
        list.push(address);
        added.push(scriptOf(address).hash);
      }
    }
    return added;
  }

  const listeners = new Set<() => void>();
  extend();
  let derived = deriveView(source());
  let status: Pick<WalletSnapshot, "error" | "progress" | "reorg"> = {
    error: null,
    progress: null,
    reorg: null,
  };
  let snapshot!: WalletSnapshot;
  const emit = (change: Partial<typeof status> = {}) => {
    status = { ...status, ...change };
    const { own: _, ...rest } = derived;
    snapshot = { id, ...rest, ...status };
    for (const listener of listeners) listener();
  };
  const rebuild = () => {
    derived = deriveView(source());
    emit();
  };
  emit();

  let closed = false;
  let backend: WalletBackend | null = null;
  let watching = false;
  let full = true;
  let newTip: BlockHeader | null = null;
  const dirty = new Set<string>();
  const subscribed = new Set<string>();
  const unsubscribes: Unsubscribe[] = [];
  let loop: Promise<void> | null = null;
  let txsChanged = false;

  const persist = async () => {
    await vault.put(`cache/${id}/state`, cache);
    if (txsChanged) await vault.put(`cache/${id}/txs`, raw);
    txsChanged = false;
  };

  async function extendsStored(tip: BlockHeader): Promise<boolean> {
    const stored = cache.tip!;
    if (tip.height < stored.height) return false;
    if (tip.height === stored.height + 1) {
      return hex.encode(tip.header.slice(4, 36)) === hex.encode(sha256x2(hex.decode(stored.header)));
    }
    const [header] =
      tip.height === stored.height ? [tip.header] : await backend!.blockHeaders([stored.height]);
    return hex.encode(header!) === stored.header;
  }

  async function fetchTransactions(txids: string[], stage: SyncProgress["stage"]) {
    if (!txids.length) return;
    emit({ progress: { stage, done: 0, total: txids.length } });
    const found = await backend!.transactions(txids);
    txids.forEach((txid, i) => {
      if (Transaction.fromRaw(found[i]!, PARSE).id !== txid) {
        throw new Error(`The server sent a different transaction for ${txid}`);
      }
      raw[txid] = hex.encode(found[i]!);
    });
    txsChanged = true;
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
      if (cache.tip && !(await extendsStored(tip))) {
        cache = emptyCache(cache.addresses);
        raw = {};
        parsedTxs = new Map();
        txsChanged = true;
        everything = true;
        emit({ reorg: { height: tip.height, at: now() } });
      }
      cache.tip = { height: tip.height, header: hex.encode(tip.header) };
      for (const hash of allHashes()) if (!subscribed.has(hash)) ask.add(hash);
    }
    if (everything) ask = new Set(allHashes());

    let pending = [...ask];
    let done = 0;
    while (pending.length) {
      emit({ progress: { stage: "history", done, total: done + pending.length } });
      const histories = await backend!.history(pending);
      pending.forEach((hash, i) => {
        if (histories[i]!.length) cache.histories[hash] = histories[i]!;
        else delete cache.histories[hash];
      });
      done += pending.length;
      pending = extend();
    }

    const entries = Object.values(cache.histories).flat();
    const txids = [...new Set(entries.map((e) => e.txid))];
    await fetchTransactions(txids.filter((t) => !raw[t]), "transactions");
    const prevouts = new Set(
      txids.flatMap((t) => parsed(t)!.inputs.map((i) => i.txid)).filter((t) => t !== COINBASE && !raw[t]),
    );
    await fetchTransactions([...prevouts], "transactions");

    const heights = [
      ...new Set(entries.flatMap((e) => (e.height === null || cache.times[e.height] ? [] : [e.height]))),
    ];
    if (heights.length) {
      emit({ progress: { stage: "blocks", done: 0, total: heights.length } });
      const headers = await backend!.blockHeaders(heights);
      heights.forEach((h, i) => (cache.times[h] = blockTime(headers[i]!)));
    }
    for (const e of entries) if (e.height === null) cache.seen[e.txid] ??= now();

    await persist();
    rebuild();

    const watch = new Set(derived.coins.map((c) => scriptOf(c.address).hash));
    for (let chain = 0; chain < chains; chain++) {
      const list = cache.addresses[chain]!;
      const from = lastUsed(chain) + 1;
      for (const a of list.slice(from, from + gapLimit)) watch.add(scriptOf(a).hash);
    }
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
        log("sync failed", { message: (error as Error).message });
        emit({ error: backend ? (error as Error).message : null, progress: null });
      } finally {
        loop = null;
      }
    })();
    return loop;
  }

  const saveLabels = () => vault.put(`labels/${id}`, labels);
  const saveFrozen = () => vault.put(`frozen/${id}`, [...frozen]);
  const saveKyc = () => vault.put(`kyc/${id}`, [...kyc]);

  const use = (next: WalletBackend | null) => {
    if (next === backend) return;
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    subscribed.clear();
    watching = false;
    full = true;
    backend = next;
    if (next) emit({ progress: { stage: "history", done: 0, total: allHashes().length } });
    // A sync still running may fail on the old backend after this one is in.
    void (loop ? loop.then(request) : request());
  };
  use(server);

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    refresh() {
      full = true;
      return request();
    },
    settled: async () => {
      while (loop) await loop;
    },
    async scanDeeper(count = 100) {
      const lengths = cache.addresses.map((l) => l.length);
      const used = () => allHashes().filter((h) => cache.histories[h]).length;
      const before = used();
      for (const hash of extend(Math.max(...lengths) + count)) dirty.add(hash);
      await request();
      cache.addresses.forEach((list, chain) => {
        list.length = Math.min(list.length, Math.max(lengths[chain]!, lastUsed(chain) + 1 + gapLimit));
      });
      await persist();
      rebuild();
      return used() - before;
    },
    async setLabel(type, ref, label) {
      if (label) labels[`${type}:${ref}`] = label;
      else delete labels[`${type}:${ref}`];
      rebuild();
      await saveLabels();
    },
    async setFrozen(coin, on) {
      if (on) frozen.add(outpoint(coin));
      else frozen.delete(outpoint(coin));
      rebuild();
      await saveFrozen();
    },
    async setKyc(coins, on) {
      for (const c of coins) {
        if (on) kyc.add(outpoint(c));
        else kyc.delete(outpoint(c));
      }
      rebuild();
      await saveKyc();
    },
    exportLabels() {
      const records = new Map<string, Bip329Record>();
      for (const [key, label] of Object.entries(labels)) {
        const at = key.indexOf(":");
        records.set(key, { type: key.slice(0, at), ref: key.slice(at + 1), label });
      }
      for (const point of frozen) {
        const key = `output:${point}`;
        records.set(key, { ...(records.get(key) ?? { type: "output", ref: point }), spendable: false });
      }
      for (const point of kyc) {
        const key = `output:${point}`;
        records.set(key, { ...(records.get(key) ?? { type: "output", ref: point }), kyc: true });
      }
      return formatBip329([...records.values()].map((r) => (origin ? { ...r, origin } : r)));
    },
    async importLabels(text) {
      const { records, skipped } = parseBip329(text);
      let imported = 0;
      for (const r of records) {
        if (r.origin && origin && !sameOrigin(r.origin, origin)) continue;
        imported++;
        if (r.label !== undefined) {
          if (r.label) labels[`${r.type}:${r.ref}`] = r.label;
          else delete labels[`${r.type}:${r.ref}`];
        }
        if (r.type === "output" && r.spendable !== undefined) {
          if (r.spendable) frozen.delete(r.ref);
          else frozen.add(r.ref);
        }
        if (r.type === "output" && r.kyc !== undefined) {
          if (r.kyc) kyc.add(r.ref);
          else kyc.delete(r.ref);
        }
      }
      rebuild();
      await Promise.all([saveLabels(), saveFrozen(), saveKyc()]);
      return { imported, skipped: skipped + records.length - imported };
    },
    async addTransaction(bytes) {
      const tx = Transaction.fromRaw(bytes, PARSE);
      raw[tx.id] = hex.encode(bytes);
      txsChanged = true;
      const p = parsed(tx.id)!;
      const unconfirmedParents = p.inputs.some((i) =>
        Object.values(cache.histories).some((l) => l.some((e) => e.txid === i.txid && e.height === null)),
      );
      const spends = new Set(p.inputs.map(outpoint));
      const conflicts = (e: HistoryEntry) =>
        e.height === null && e.txid !== tx.id && !!parsed(e.txid)?.inputs.some((i) => spends.has(outpoint(i)));
      for (const [hash, list] of Object.entries(cache.histories)) {
        const kept = list.filter((e) => !conflicts(e));
        if (kept.length) cache.histories[hash] = kept;
        else delete cache.histories[hash];
      }
      const touched = [...p.outputs, ...p.inputs.flatMap((i) => parsed(i.txid)?.outputs[i.vout] ?? [])];
      for (const { script } of touched) {
        const info = derived.own.get(script);
        if (!info) continue;
        const hash = scriptOf(info.address).hash;
        const list = cache.histories[hash] ?? [];
        if (!list.some((e) => e.txid === tx.id)) list.push({ txid: tx.id, height: null, unconfirmedParents });
        cache.histories[hash] = list;
      }
      cache.seen[tx.id] ??= now();
      rebuild();
      await persist();
    },
    use,
    dismissReorg: () => emit({ reorg: null }),
    close() {
      closed = true;
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    },
  };
}
