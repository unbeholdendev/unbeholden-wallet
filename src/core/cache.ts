import { hex } from "@scure/base";
import { Address, OutScript, Transaction } from "@scure/btc-signer";
import { type HistoryEntry, scriptHash } from "../backend/backend";
import type { Clock, Store } from "../vault/vault";
import { outpoint } from "../wallet/coin";
import { deriveAddress } from "../wallet/derive";
import type { Descriptor } from "../wallet/descriptor";
import { NETWORKS, type Network } from "../wallet/network";
import { emptyCache, lastUsed as lastUsedOn, type Parsed, parseTx } from "./view";
import { readRecord, vaultKey, writeRecord } from "./wallets";

const PARSE = {
  allowUnknownInputs: true,
  allowUnknownOutputs: true,
  allowLegacyWitnessUtxo: true,
  disableScriptCheck: true,
};

export type WalletCache = Awaited<ReturnType<typeof openCache>>;

/** The chain data and raw transactions kept between visits, and the addresses derived for them. */
export async function openCache(
  vault: Store,
  id: string,
  descriptor: Descriptor,
  network: Network,
  { now, gapLimit }: { now: Clock; gapLimit: number },
) {
  const btc = NETWORKS[network];
  const chains = descriptor.keys[0]!.path.some(Array.isArray) ? 2 : 1;
  const keys = vaultKey.cache(id);
  let cache = (await readRecord(vault, keys.state)) ?? emptyCache(Array.from({ length: chains }, () => []));
  let raw = (await readRecord(vault, keys.txs)) ?? {};
  let txsChanged = false;

  const scripts = new Map<string, { script: string; hash: string }>();
  const scriptOf = (address: string) => {
    let found = scripts.get(address);
    if (!found) {
      const script = OutScript.encode(Address(btc).decode(address));
      found = { script: hex.encode(script), hash: scriptHash(script) };
      scripts.set(address, found);
    }
    return found;
  };
  const addressOf = (script: string) => {
    try {
      return Address(btc).encode(OutScript.decode(hex.decode(script)));
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
  const hashes = () => cache.addresses.flat().map((a) => scriptOf(a).hash);
  const lastUsed = (chain: number) => lastUsedOn({ cache, scriptOf }, chain);

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
        const address = deriveAddress(descriptor, network, chain, i);
        list.push(address);
        added.push(scriptOf(address).hash);
      }
    }
    return added;
  }
  extend();

  return {
    /** Replaced by `reset`. The sync engine writes its chain fields. */
    get state() {
      return cache;
    },
    scriptOf,
    addressOf,
    parsed,
    has: (txid: string) => !!raw[txid],
    hashes,
    lastUsed,
    extend,
    /** Scripthashes of the gap-limit addresses past the last used one, per chain. */
    gap(): string[] {
      return cache.addresses.flatMap((list, chain) => {
        const from = lastUsed(chain) + 1;
        return list.slice(from, from + gapLimit).map((a) => scriptOf(a).hash);
      });
    },
    /** Drops addresses past both `lengths` and the gap limit. */
    trim(lengths: number[]) {
      cache.addresses.forEach((list, chain) => {
        list.length = Math.min(list.length, Math.max(lengths[chain]!, lastUsed(chain) + 1 + gapLimit));
      });
    },
    /** Forgets everything but the addresses. */
    reset() {
      cache = emptyCache(cache.addresses);
      raw = {};
      parsedTxs = new Map();
      txsChanged = true;
    },
    /** Throws if a transaction does not match its txid. */
    store(txids: string[], found: Uint8Array[]) {
      txids.forEach((txid, i) => {
        if (Transaction.fromRaw(found[i]!, PARSE).id !== txid) {
          throw new Error(`The server sent a different transaction for ${txid}`);
        }
        raw[txid] = hex.encode(found[i]!);
      });
      txsChanged = true;
    },
    /** Records `bytes` as unconfirmed on the addresses in `own` it touches, dropping any it conflicts with. */
    addTransaction(bytes: Uint8Array, own: ReadonlyMap<string, { address: string }>) {
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
        const info = own.get(script);
        if (!info) continue;
        const hash = scriptOf(info.address).hash;
        const list = cache.histories[hash] ?? [];
        if (!list.some((e) => e.txid === tx.id)) list.push({ txid: tx.id, height: null, unconfirmedParents });
        cache.histories[hash] = list;
      }
      cache.seen[tx.id] ??= now();
    },
    async persist() {
      await writeRecord(vault, keys.state, cache);
      if (txsChanged) await writeRecord(vault, keys.txs, raw);
      txsChanged = false;
    },
  };
}
