import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createVault,
  DEFAULT_KDF,
  destroyVault,
  idleLock,
  memoryStore,
  requestPersistence,
  unlockVault,
  Vault,
  vaultExists,
  type KdfParams,
  type Store,
} from "../vault/vault";
import {
  createWallet,
  deleteWallet,
  getSettings,
  listWallets,
  renameWallet,
  saveSettings,
  type NewWallet,
  type Settings as CoreSettings,
  type WalletRecord,
} from "../core/wallets";

export type Settings = CoreSettings & { idleMinutes?: number };

export type Persistence = Awaited<ReturnType<typeof requestPersistence>>;

export const IDLE_DEFAULT_MINUTES = 15;

type Open = {
  vault: Store;
  /** Set up in memory only, until `create` gives it a passphrase. */
  draft: boolean;
  settings: Settings;
  wallets: WalletRecord[];
  walletId: string | null;
};

type VaultState =
  | { phase: "loading" | "locked" }
  | ({ phase: "open" } & Open);

type VaultApi = {
  state: VaultState;
  persistence: Persistence | null;
  /** Encrypts the draft into a new vault. */
  create(passphrase: string): Promise<void>;
  /** @throws {WrongPassphrase} */
  unlock(passphrase: string): Promise<void>;
  lock(): void;
  destroy(): Promise<void>;
  changePassphrase(old: string, next: string): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  addWallet(wallet: NewWallet): Promise<WalletRecord>;
  renameWallet(id: string, name: string): Promise<void>;
  removeWallet(id: string): Promise<void>;
  selectWallet(id: string): void;
};

const VaultContext = createContext<VaultApi | null>(null);

export function useVaultState(): VaultApi {
  const api = useContext(VaultContext);
  if (!api) throw new Error("useVaultState outside VaultProvider");
  return api;
}

/** The unlocked vault and what the app keeps in it. Only for screens behind the unlock. */
export function useVault() {
  const api = useVaultState();
  if (api.state.phase !== "open") throw new Error("useVault while the vault is not open");
  const { state, ...actions } = api;
  return { ...state, ...actions };
}

async function load(vault: Store): Promise<Open> {
  const wallets = await listWallets(vault);
  return { vault, draft: !(vault instanceof Vault), settings: await getSettings(vault), wallets, walletId: wallets[0]?.id ?? null };
}

export function VaultProvider({ kdf = DEFAULT_KDF, children }: { kdf?: KdfParams; children: ReactNode }) {
  const [state, setState] = useState<VaultState>({ phase: "loading" });
  const [persistence, setPersistence] = useState<Persistence | null>(null);

  useEffect(() => {
    vaultExists().then(async (exists) => setState(exists ? { phase: "locked" } : { phase: "open", ...(await load(memoryStore())) }));
  }, []);

  const open = useCallback(async (vault: Vault) => {
    setState({ phase: "open", ...(await load(vault)) });
    requestPersistence().then(setPersistence, () => setPersistence("unsupported"));
  }, []);

  const vault = state.phase === "open" && state.vault instanceof Vault ? state.vault : null;
  const lock = useCallback(() => {
    vault?.lock();
    setState({ phase: "locked" });
  }, [vault]);

  const idleMinutes = vault && state.phase === "open" ? (state.settings.idleMinutes ?? IDLE_DEFAULT_MINUTES) : null;
  useEffect(() => {
    if (idleMinutes === null) return;
    const idle = idleLock(idleMinutes * 60_000, Date.now, lock);
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    // Someone holding the signer up to the signing QR touches nothing here.
    const check = () => (document.querySelector("[data-keep-unlocked]") ? idle.touch() : idle.check());
    events.forEach((e) => addEventListener(e, idle.touch, { passive: true }));
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, 10_000);
    return () => {
      events.forEach((e) => removeEventListener(e, idle.touch));
      document.removeEventListener("visibilitychange", check);
      clearInterval(timer);
    };
  }, [idleMinutes, lock]);

  const api = useMemo<VaultApi>(
    () => ({
      state,
      persistence,
      create: async (passphrase) => {
        if (state.phase !== "open" || !state.draft) throw new Error("A vault already exists in this browser");
        const created = await createVault(passphrase, kdf);
        for (const key of await state.vault.keys()) await created.put(key, await state.vault.get(key));
        await open(created);
      },
      unlock: async (passphrase) => open(await unlockVault(passphrase)),
      lock,
      destroy: async () => {
        vault?.lock();
        await destroyVault();
        setState({ phase: "open", ...(await load(memoryStore())) });
      },
      changePassphrase: (old, next) => vault!.changePassphrase(old, next, kdf),
      saveSettings: async (patch) => {
        if (state.phase !== "open") return;
        const settings = { ...state.settings, ...patch };
        await saveSettings(state.vault, settings);
        setState({ ...state, settings });
      },
      addWallet: async (wallet) => {
        if (state.phase !== "open") throw new Error("The vault is locked");
        const record = await createWallet(state.vault, wallet);
        setState({ ...state, wallets: [...state.wallets, record], walletId: record.id });
        return record;
      },
      renameWallet: async (id, name) => {
        if (state.phase !== "open") return;
        await renameWallet(state.vault, id, name);
        setState({ ...state, wallets: state.wallets.map((w) => (w.id === id ? { ...w, name } : w)) });
      },
      removeWallet: async (id) => {
        if (state.phase !== "open") return;
        await deleteWallet(state.vault, id);
        const wallets = state.wallets.filter((w) => w.id !== id);
        setState({ ...state, wallets, walletId: state.walletId === id ? (wallets[0]?.id ?? null) : state.walletId });
      },
      selectWallet: (id) => state.phase === "open" && setState({ ...state, walletId: id }),
    }),
    [state, persistence, kdf, open, lock, vault],
  );

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>;
}
