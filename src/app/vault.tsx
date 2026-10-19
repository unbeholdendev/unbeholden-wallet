import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createVault,
  DEFAULT_KDF,
  destroyVault,
  idleLock,
  memoryStore,
  openBackup,
  requestPersistence,
  sealBackup,
  unlockVault,
  Vault,
  vaultExists,
  type KdfParams,
  type Store,
} from "../vault/vault";
import {
  backupRecords,
  createWallet,
  deleteWallet,
  getSettings,
  listWallets,
  mergeBackup,
  renameWallet,
  saveSettings,
  type Merged,
  type Contact,
  type NewWallet,
  type Settings as CoreSettings,
  type WalletRecord,
} from "../core/wallets";

export type Settings = CoreSettings & { idleMinutes?: number; walletId?: string; notify?: boolean; skipForeignUnconfirmed?: boolean };

export type Persistence = Awaited<ReturnType<typeof requestPersistence>>;

export const IDLE_DEFAULT_MINUTES = 15;

type Open = {
  vault: Store;
  /** Set up in memory only, until `create` saves it. */
  draft: boolean;
  /** Without one, it opens by itself and never locks. */
  passphrase: boolean;
  settings: Settings;
  wallets: WalletRecord[];
  walletId: string | null;
  /** Counts backups merged in, so the open wallet rereads its labels. */
  restored: number;
};

type VaultState =
  | { phase: "loading" | "locked" }
  | ({ phase: "open" } & Open);

type VaultApi = {
  state: VaultState;
  persistence: Persistence | null;
  /** Saves the draft into a new vault; `null` for no passphrase. */
  create(passphrase: string | null): Promise<void>;
  /** @throws {WrongPassphrase} */
  unlock(passphrase: string): Promise<void>;
  lock(): void;
  destroy(): Promise<void>;
  changePassphrase(old: string | null, next: string | null): Promise<void>;
  /** @throws {WrongPassphrase} when the vault has a passphrase and this is not it. */
  exportBackup(passphrase: string): Promise<string>;
  /** Merges into the vault, or on first run makes one with the backup's passphrase. */
  restoreBackup(file: string, passphrase: string): Promise<Merged>;
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

export function useBook() {
  const { vault, restored } = useVault();
  const [book, setBook] = useState<Contact[]>([]);
  useEffect(() => {
    vault.get<Contact[]>("book").then((b) => setBook(b ?? []));
  }, [vault, restored]);
  const save = useCallback(
    async (next: Contact[]) => {
      await vault.put("book", next);
      setBook(next);
    },
    [vault],
  );
  return [book, save] as const;
}

async function load(vault: Store): Promise<Open> {
  const wallets = await listWallets(vault);
  const settings: Settings = await getSettings(vault);
  const walletId = (wallets.find((w) => w.id === settings.walletId) ?? wallets[0])?.id ?? null;
  const draft = !(vault instanceof Vault);
  return { vault, draft, passphrase: !draft && vault.hasPassphrase, settings, wallets, walletId, restored: 0 };
}

export function VaultProvider({ kdf = DEFAULT_KDF, children }: { kdf?: KdfParams; children: ReactNode }) {
  const [state, setState] = useState<VaultState>({ phase: "loading" });
  const [persistence, setPersistence] = useState<Persistence | null>(null);

  const open = useCallback(async (vault: Vault) => {
    setState({ phase: "open", ...(await load(vault)) });
    requestPersistence().then(setPersistence, () => setPersistence("unsupported"));
  }, []);

  useEffect(() => {
    unlockVault(null).then(open, async () =>
      setState((await vaultExists()) ? { phase: "locked" } : { phase: "open", ...(await load(memoryStore())) }),
    );
  }, [open]);

  const vault = state.phase === "open" && state.vault instanceof Vault ? state.vault : null;
  const lock = useCallback(() => {
    vault?.lock();
    setState({ phase: "locked" });
  }, [vault]);

  const idleMinutes = state.phase === "open" && state.passphrase ? (state.settings.idleMinutes ?? IDLE_DEFAULT_MINUTES) : null;
  useEffect(() => {
    if (idleMinutes === null) return;
    const idle = idleLock(idleMinutes * 60_000, Date.now, lock);
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    // Someone holding the signer up to the signing QR, or to the camera, touches nothing here.
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

  const api = useMemo<VaultApi>(() => {
    const create = async (passphrase: string | null) => {
      if (state.phase !== "open" || !state.draft) throw new Error("A vault already exists in this browser");
      const created = await createVault(passphrase, kdf);
      try {
        for (const key of await state.vault.keys()) await created.put(key, await state.vault.get(key));
      } catch (error) {
        created.lock();
        await destroyVault().catch(() => {});
        throw error;
      }
      await open(created);
    };
    return {
      state,
      persistence,
      create,
      unlock: async (passphrase) => open(await unlockVault(passphrase)),
      lock,
      destroy: async () => {
        vault?.lock();
        await destroyVault();
        setState({ phase: "open", ...(await load(memoryStore())) });
      },
      changePassphrase: async (old, next) => {
        await vault!.changePassphrase(old, next, kdf);
        if (state.phase === "open") setState({ ...state, passphrase: next !== null });
      },
      exportBackup: async (passphrase) => {
        if (vault!.hasPassphrase) await vault!.verify(passphrase);
        return sealBackup(passphrase, await backupRecords(vault!), kdf);
      },
      restoreBackup: async (file, passphrase) => {
        if (state.phase !== "open") throw new Error("The vault is locked");
        const merged = await mergeBackup(state.vault, await openBackup(file, passphrase));
        if (state.draft) await create(passphrase);
        else setState({ ...state, ...(await load(state.vault)), restored: state.restored + 1 });
        return merged;
      },
      saveSettings: async (patch) => {
        if (state.phase !== "open") return;
        const settings = { ...state.settings, ...patch };
        await saveSettings(state.vault, settings);
        setState({ ...state, settings });
      },
      addWallet: async (wallet) => {
        if (state.phase !== "open") throw new Error("The vault is locked");
        const record = await createWallet(state.vault, wallet);
        const settings = { ...state.settings, walletId: record.id };
        await saveSettings(state.vault, settings);
        setState({ ...state, settings, wallets: [...state.wallets, record], walletId: record.id });
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
      selectWallet: (id) => {
        if (state.phase !== "open") return;
        const settings = { ...state.settings, walletId: id };
        setState({ ...state, settings, walletId: id });
        saveSettings(state.vault, settings).catch(() => {});
      },
    };
  }, [state, persistence, kdf, open, lock, vault]);

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>;
}
