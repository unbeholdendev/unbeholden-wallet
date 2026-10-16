import { hex } from "@scure/base";
import { Address, OutScript, RawTx, Transaction } from "@scure/btc-signer";
import { sha256x2 } from "@scure/btc-signer/utils.js";
import {
  ConnectionError,
  scriptHash,
  type BlockHeader,
  type ConnectionFailure,
  type HistoryEntry,
  type Unsubscribe,
  type WalletBackend,
} from "../backend/backend";
import type { Clock, Vault } from "../vault/vault";
import { outpoint, type Coin, type CoinStatus } from "../wallet/coin";
import { deriveAddress } from "../wallet/derive";
import type { Descriptor } from "../wallet/descriptor";
import { NETWORKS } from "../wallet/network";
import { linkCoins, type HistoryTx } from "../wallet/privacy";
import { bip329Origin, formatBip329, parseBip329, sameOrigin, type Bip329Record } from "./bip329";
import { getWallet, walletDescriptor } from "./wallets";

export type AddressInfo = {
  address: string;
  /** 0 receive, 1 change. */
  chain: number;
  index: number;
  /** From the master key when the descriptor gives a key origin, else from the key. */
  path: string;
  used: boolean;
  txCount: number;
  /** Paid by more than one transaction. */
  reused: boolean;
  label: string | null;
};

type Endpoint = {
  /** Null for an input whose previous transaction the server did not give. */
  value: number | null;
  address: string | null;
  /** Set when the wallet's descriptor owns the script. */
  mine: AddressInfo | null;
};

export type TxInput = Endpoint & { txid: string; vout: number };
export type TxOutput = Endpoint & { vout: number; script: string; label: string | null };

export type WalletTx = {
  txid: string;
  height: number | null;
  confirmations: number;
  /** Block time, unix seconds. */
  time: number | null;
  /** When this wallet first saw it unconfirmed, by the injected clock. */
  seenAt: number | null;
  /** Into the wallet, negative when sats left it. */
  net: number;
  /** Null when an input's value is unknown, as for a coinbase. */
  fee: number | null;
  vsize: number;
  inputs: TxInput[];
  outputs: TxOutput[];
  label: string | null;
};

export type WalletCoin = Coin & { label: string | null };

/**
 * Sats. `confirmed` and `unconfirmed` cover every coin, frozen or not.
 * `spendable` is what automatic selection may use: confirmed and own change, not frozen.
 */
export type Balance = { confirmed: number; unconfirmed: number; frozen: number; spendable: number };

export type SyncProgress = {
  stage: "history" | "transactions" | "blocks";
  done: number;
  total: number;
};

export type WalletSnapshot = {
  id: string;
  connection: "connecting" | "connected" | "disconnected";
  /** Why the last connection attempt failed, when it was a connection failure. */
  failure: ConnectionFailure | null;
  error: string | null;
  /** Null when no sync is running. */
  progress: SyncProgress | null;
  tip: { height: number; time: number } | null;
  balance: Balance;
  /** Newest first. */
  transactions: WalletTx[];
  addresses: { receive: AddressInfo[]; change: AddressInfo[] };
  /** The receive address after the last used one. */
  nextReceive: AddressInfo;
  coins: WalletCoin[];
  /** Outpoint to privacy group, from `linkCoins`. */
  groups: Map<string, string>;
  /** Set when a reorg discarded the cache; cleared by `dismissReorg`. */
  reorg: { height: number; at: number } | null;
};

export type LabelType = "tx" | "addr" | "output";

export type WalletSession = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): WalletSnapshot;
  /** Syncs now; also reconnects after a failure. Resolves when done, never rejects. */
  refresh(): Promise<void>;
  /** Resolves once no sync is running. */
  settled(): Promise<void>;
  /** Checks `count` more addresses on each chain, beyond the gap limit. */
  scanDeeper(count?: number): Promise<void>;
  /** An empty or null label removes it. */
  setLabel(type: LabelType, ref: string, label: string | null): Promise<void>;
  setFrozen(coin: { txid: string; vout: number }, frozen: boolean): Promise<void>;
  exportLabels(): string;
  /** `skipped` counts unreadable lines and records labelled for another wallet. */
  importLabels(text: string): Promise<{ imported: number; skipped: number }>;
  /** Shows a just-broadcast transaction as unconfirmed before the server reports it. */
  addTransaction(raw: Uint8Array): Promise<void>;
  dismissReorg(): void;
  /** Stops syncing and closes the backend. */
  close(): void;
};

type Cache = {
  tip: { height: number; header: string } | null;
  /** Per chain, so a return visit need not derive them again. */
  addresses: string[][];
  /** By scripthash; unused scripthashes are left out. */
  histories: Record<string, HistoryEntry[]>;
  /** Block time by height. */
  times: Record<string, number>;
  seen: Record<string, number>;
};

type Parsed = HistoryTx & { vsize: number };

const PARSE = {
  allowUnknownInputs: true,
  allowUnknownOutputs: true,
  allowLegacyWitnessUtxo: true,
  disableScriptCheck: true,
};

// https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
const HARDENED = 0x80000000;
const COINBASE = "00".repeat(32);

// Timestamp field of the block header.
// https://developer.bitcoin.org/reference/block_chain.html
const blockTime = (header: Uint8Array) =>
  new DataView(header.buffer, header.byteOffset).getUint32(68, true);

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function pathOf(descriptor: Descriptor, chain: number, index: number): string {
  const steps = [
    ...(descriptor.origin?.path ?? []),
    ...descriptor.path.map((s) => (s === "*" ? index : typeof s === "number" ? s : s[chain]!)),
  ].map((i) => (i >= HARDENED ? `${i - HARDENED}h` : `${i}`));
  return (descriptor.origin ? "m/" : "") + steps.join("/");
}

const emptyCache = (addresses: string[][]): Cache => ({
  tip: null,
  addresses,
  histories: {},
  times: {},
  seen: {},
});

export async function openWallet(
  vault: Vault,
  id: string,
  backend: WalletBackend,
  { now = Date.now as Clock, gapLimit = 20 } = {},
): Promise<WalletSession> {
  const record = await getWallet(vault, id);
  const descriptor = walletDescriptor(record);
  const network = NETWORKS[record.network];
  const chains = descriptor.path.some(Array.isArray) ? 2 : 1;
  const origin = bip329Origin(descriptor);

  let cache =
    (await vault.get<Cache>(`cache/${id}/state`)) ??
    emptyCache(Array.from({ length: chains }, () => []));
  let raw: Record<string, string> = (await vault.get(`cache/${id}/txs`)) ?? {};
  const labels: Record<string, string> = (await vault.get(`labels/${id}`)) ?? {};
  const frozen = new Set<string>((await vault.get<string[]>(`frozen/${id}`)) ?? []);

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
      const bytes = hex.decode(raw[txid]);
      const tx = RawTx.decode(bytes);
      const base = RawTx.encode({ ...tx, segwitFlag: false, witnesses: undefined }).length;
      p = {
        txid,
        inputs: tx.inputs.map((i) => ({ txid: hex.encode(i.txid), vout: i.index })),
        outputs: tx.outputs.map((o) => ({ script: hex.encode(o.script), value: Number(o.amount) })),
        // Weight is three times the size without witnesses plus the full size.
        // https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki
        vsize: Math.ceil((base * 3 + bytes.length) / 4),
      };
      parsedTxs.set(txid, p);
    }
    return p;
  };
  const allHashes = () => cache.addresses.flat().map((a) => scriptOf(a).hash);
  const lastUsed = (chain: number) =>
    cache.addresses[chain]!.findLastIndex((a) => cache.histories[scriptOf(a).hash]);

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

  function derive() {
    const entries = new Map<string, HistoryEntry>();
    for (const list of Object.values(cache.histories)) {
      for (const entry of list) entries.set(entry.txid, entry);
    }
    const own = new Map<string, AddressInfo>();
    const addresses = cache.addresses.map((list, chain) =>
      list.map((address, index) => {
        const { script, hash } = scriptOf(address);
        const txCount = cache.histories[hash]?.length ?? 0;
        const info: AddressInfo = {
          address,
          chain,
          index,
          path: pathOf(descriptor, chain, index),
          used: txCount > 0,
          txCount,
          reused: false,
          label: labels[`addr:${address}`] ?? null,
        };
        own.set(script, info);
        return info;
      }),
    );

    const txs = [...entries.keys()].flatMap((txid) => parsed(txid) ?? []);
    const paidTo = new Map<string, number>();
    const spent = new Set<string>();
    for (const tx of txs) {
      for (const script of new Set(tx.outputs.map((o) => o.script))) {
        paidTo.set(script, (paidTo.get(script) ?? 0) + 1);
      }
      for (const input of tx.inputs) spent.add(outpoint(input));
    }
    for (const [script, count] of paidTo) {
      const info = own.get(script);
      if (info && count > 1) info.reused = true;
    }

    const prevout = (input: { txid: string; vout: number }) =>
      parsed(input.txid)?.outputs[input.vout];
    const statuses = new Map<string, CoinStatus>();
    const statusOf = (txid: string): CoinStatus => {
      const known = statuses.get(txid);
      if (known) return known;
      const entry = entries.get(txid)!;
      let status: CoinStatus = "confirmed";
      if (entry.height === null) {
        let allOwn = true;
        let foreignParent = false;
        let badParent = false;
        for (const input of parsed(txid)!.inputs) {
          const parent = entries.get(input.txid);
          const mine = own.has(prevout(input)?.script ?? "");
          allOwn &&= mine;
          if (!parent) foreignParent = true;
          else if (parent.height === null && (!mine || statusOf(input.txid) !== "own-change")) {
            badParent = true;
          }
        }
        // The server flags an unconfirmed parent but not which, so a foreign one is assumed.
        status =
          badParent || (entry.unconfirmedParents && foreignParent)
            ? "unconfirmed-parents"
            : allOwn
              ? "own-change"
              : "foreign-unconfirmed";
      }
      statuses.set(txid, status);
      return status;
    };

    const coins: WalletCoin[] = txs.flatMap((tx) =>
      tx.outputs.flatMap((o, vout) => {
        const info = own.get(o.script);
        const point = `${tx.txid}:${vout}`;
        if (!info || spent.has(point)) return [];
        return [
          {
            txid: tx.txid,
            vout,
            value: o.value,
            script: o.script,
            address: info.address,
            chain: info.chain,
            index: info.index,
            height: entries.get(tx.txid)!.height,
            status: statusOf(tx.txid),
            frozen: frozen.has(point),
            label: labels[`output:${point}`] ?? null,
          },
        ];
      }),
    );

    const tip = cache.tip && {
      height: cache.tip.height,
      time: blockTime(hex.decode(cache.tip.header)),
    };
    const depths = new Map<string, number>();
    const depth = (tx: Parsed): number => {
      if (!depths.has(tx.txid)) {
        const height = entries.get(tx.txid)!.height;
        const parents = tx.inputs.flatMap((i) => {
          const p = entries.get(i.txid)?.height === height ? parsed(i.txid) : undefined;
          return p ? [depth(p)] : [];
        });
        depths.set(tx.txid, 1 + Math.max(0, ...parents));
      }
      return depths.get(tx.txid)!;
    };
    const order = (tx: Parsed) => entries.get(tx.txid)!.height ?? Infinity;
    const transactions: WalletTx[] = [...txs]
      .sort((a, b) => order(b) - order(a) || depth(b) - depth(a) || (a.txid < b.txid ? -1 : 1))
      .map((tx) => {
        const height = entries.get(tx.txid)!.height;
        const inputs = tx.inputs.map((input) => {
          const p = input.txid === COINBASE ? undefined : prevout(input);
          return {
            ...input,
            value: p?.value ?? null,
            address: p ? addressOf(p.script) : null,
            mine: (p && own.get(p.script)) ?? null,
          };
        });
        const outputs = tx.outputs.map((o, vout) => ({
          vout,
          script: o.script,
          value: o.value,
          address: addressOf(o.script),
          mine: own.get(o.script) ?? null,
          label: labels[`output:${tx.txid}:${vout}`] ?? null,
        }));
        const ownValue = (list: Endpoint[]) => sum(list.map((e) => (e.mine ? e.value! : 0)));
        const outTotal = sum(outputs.map((o) => o.value));
        return {
          txid: tx.txid,
          height,
          confirmations: height === null || !tip ? 0 : tip.height - height + 1,
          time: height === null ? null : (cache.times[height] ?? null),
          seenAt: cache.seen[tx.txid] ?? null,
          net: ownValue(outputs) - ownValue(inputs),
          fee: inputs.every((i) => i.value !== null)
            ? sum(inputs.map((i) => i.value!)) - outTotal
            : null,
          vsize: tx.vsize,
          inputs,
          outputs,
          label: labels[`tx:${tx.txid}`] ?? null,
        };
      });

    const [receive = [], change = []] = addresses;
    const total = (list: WalletCoin[]) => sum(list.map((c) => c.value));
    return {
      tip,
      balance: {
        confirmed: total(coins.filter((c) => c.status === "confirmed")),
        unconfirmed: total(coins.filter((c) => c.status !== "confirmed")),
        frozen: total(coins.filter((c) => c.frozen)),
        spendable: total(
          coins.filter(
            (c) => !c.frozen && (c.status === "confirmed" || c.status === "own-change"),
          ),
        ),
      },
      transactions,
      addresses: { receive, change },
      nextReceive: receive[lastUsed(0) + 1]!,
      coins,
      groups: linkCoins(txs, new Set(own.keys())),
      own,
    };
  }

  const listeners = new Set<() => void>();
  extend();
  let derived = derive();
  let status: Pick<WalletSnapshot, "connection" | "failure" | "error" | "progress" | "reorg"> = {
    connection: "connecting",
    failure: null,
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
    derived = derive();
    emit();
  };
  emit();

  let closed = false;
  let connected = false;
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
      tip.height === stored.height ? [tip.header] : await backend.blockHeaders([stored.height]);
    return hex.encode(header!) === stored.header;
  }

  async function fetchTransactions(txids: string[], stage: SyncProgress["stage"]) {
    if (!txids.length) return;
    emit({ progress: { stage, done: 0, total: txids.length } });
    const found = await backend.transactions(txids);
    txids.forEach((txid, i) => (raw[txid] = hex.encode(found[i]!)));
    txsChanged = true;
  }

  async function syncOnce() {
    if (!connected) {
      emit({ connection: "connecting" });
      await backend.connect();
      connected = true;
      full = true;
      subscribed.clear();
      unsubscribes.push(
        await backend.subscribeHeaders((tip) => {
          newTip = tip;
          void request();
        }),
      );
      emit({ connection: "connected", failure: null, error: null });
    }
    let everything = full;
    const tip = newTip ?? (full ? await backend.chainTip() : null);
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
      const histories = await backend.history(pending);
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
      const headers = await backend.blockHeaders(heights);
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
        await backend.subscribeScriptHashes(fresh, (hash) => {
          dirty.add(hash);
          void request();
        }),
      );
    }
  }

  function request(): Promise<void> {
    loop ??= (async () => {
      try {
        while (!closed && (full || newTip || dirty.size)) await syncOnce();
        if (!closed) emit({ progress: null });
      } catch (error) {
        if (closed) return;
        for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
        backend.close();
        connected = false;
        full = true;
        const failure = error instanceof ConnectionError ? error.failure : null;
        emit({
          connection: "disconnected",
          failure,
          error: failure ? null : (error as Error).message,
          progress: null,
        });
      } finally {
        loop = null;
      }
    })();
    return loop;
  }

  const saveLabels = () => vault.put(`labels/${id}`, labels);
  const saveFrozen = () => vault.put(`frozen/${id}`, [...frozen]);

  void request();

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
      for (const hash of extend(Math.max(...cache.addresses.map((l) => l.length)) + count)) {
        dirty.add(hash);
      }
      await request();
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
      }
      rebuild();
      await Promise.all([saveLabels(), saveFrozen()]);
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
    dismissReorg: () => emit({ reorg: null }),
    close() {
      closed = true;
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
      backend.close();
    },
  };
}
