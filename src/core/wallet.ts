import type { WalletBackend } from "../backend/backend";
import type { Clock, Store } from "../vault/vault";
import { openAnnotations } from "./annotations";
import { bip329Origin } from "./bip329";
import { openCache } from "./cache";
import { startSync } from "./sync";
import { deriveView, type View, type ViewSource } from "./view";
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

export async function openWallet(
  vault: Store,
  id: string,
  server: WalletBackend | null,
  { now = Date.now as Clock, gapLimit = 20 } = {},
): Promise<WalletSession> {
  const record = await getWallet(vault, id);
  const descriptor = walletDescriptor(record);
  const cache = await openCache(vault, id, descriptor, record.network, { now, gapLimit });
  const notes = await openAnnotations(vault, id, bip329Origin(descriptor), () => rebuild());

  const source = (): ViewSource => ({
    descriptor,
    cache: cache.state,
    labels: notes.labels,
    frozen: notes.frozen,
    kyc: notes.kyc,
    parsed: cache.parsed,
    scriptOf: cache.scriptOf,
    addressOf: cache.addressOf,
  });
  const listeners = new Set<() => void>();
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
  const rebuild = (): View => {
    derived = deriveView(source());
    emit();
    return derived;
  };
  emit();

  const sync = startSync(cache, { now, emit, rebuild });
  sync.use(server);

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    refresh: sync.refresh,
    settled: sync.settled,
    async scanDeeper(count = 100) {
      const lengths = cache.state.addresses.map((l) => l.length);
      const used = () => cache.hashes().filter((h) => cache.state.histories[h]).length;
      const before = used();
      await sync.check(cache.extend(Math.max(...lengths) + count));
      cache.trim(lengths);
      await cache.persist();
      rebuild();
      return used() - before;
    },
    setLabel: notes.setLabel,
    setFrozen: notes.setFrozen,
    setKyc: notes.setKyc,
    exportLabels: notes.exportLabels,
    importLabels: notes.importLabels,
    async addTransaction(bytes) {
      cache.addTransaction(bytes, derived.own);
      rebuild();
      await cache.persist();
    },
    use: sync.use,
    dismissReorg: () => emit({ reorg: null }),
    close: sync.close,
  };
}
