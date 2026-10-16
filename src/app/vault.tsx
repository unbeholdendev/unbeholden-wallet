import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createVault,
  DEFAULT_KDF,
  destroyVault,
  idleLock,
  requestPersistence,
  unlockVault,
  vaultExists,
  type KdfParams,
  type Vault,
} from "../vault/vault";
import {
  createWallet,
  getSettings,
  listWallets,
  saveSettings,
  type NewWallet,
  type Settings as CoreSettings,
  type WalletRecord,
} from "../core/wallets";

export type Settings = CoreSettings & { idleMinutes?: number };

export type Persistence = Awaited<ReturnType<typeof requestPersistence>>;

export const IDLE_DEFAULT_MINUTES = 15;

type Open = {
  vault: Vault;
  settings: Settings;
  wallets: WalletRecord[];
  walletId: string | null;
};

type VaultState =
  | { phase: "loading" | "absent" | "locked" }
  | ({ phase: "open" } & Open);

type VaultApi = {
  state: VaultState;
  persistence: Persistence | null;
  create(passphrase: string): Promise<void>;
  /** @throws {WrongPassphrase} */
  unlock(passphrase: string): Promise<void>;
  lock(): void;
  destroy(): Promise<void>;
  changePassphrase(old: string, next: string): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  addWallet(wallet: NewWallet): Promise<WalletRecord>;
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

async function load(vault: Vault): Promise<Open> {
  const wallets = await listWallets(vault);
  return { vault, settings: await getSettings(vault), wallets, walletId: wallets[0]?.id ?? null };
}

export function VaultProvider({ kdf = DEFAULT_KDF, children }: { kdf?: KdfParams; children: ReactNode }) {
  const [state, setState] = useState<VaultState>({ phase: "loading" });
  const [persistence, setPersistence] = useState<Persistence | null>(null);

  useEffect(() => {
    vaultExists().then((exists) => setState({ phase: exists ? "locked" : "absent" }));
  }, []);

  const open = useCallback(async (vault: Vault) => {
    setState({ phase: "open", ...(await load(vault)) });
    requestPersistence().then(setPersistence, () => setPersistence("unsupported"));
  }, []);

  const vault = state.phase === "open" ? state.vault : null;
  const lock = useCallback(() => {
    vault?.lock();
    setState({ phase: "locked" });
  }, [vault]);

  const idleMinutes = state.phase === "open" ? (state.settings.idleMinutes ?? IDLE_DEFAULT_MINUTES) : null;
  useEffect(() => {
    if (idleMinutes === null) return;
    const idle = idleLock(idleMinutes * 60_000, Date.now, lock);
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    events.forEach((e) => addEventListener(e, idle.touch, { passive: true }));
    document.addEventListener("visibilitychange", idle.check);
    const timer = setInterval(idle.check, 10_000);
    return () => {
      events.forEach((e) => removeEventListener(e, idle.touch));
      document.removeEventListener("visibilitychange", idle.check);
      clearInterval(timer);
    };
  }, [idleMinutes, lock]);

  const api = useMemo<VaultApi>(
    () => ({
      state,
      persistence,
      create: async (passphrase) => open(await createVault(passphrase, kdf)),
      unlock: async (passphrase) => open(await unlockVault(passphrase)),
      lock,
      destroy: async () => {
        vault?.lock();
        await destroyVault();
        setState({ phase: "absent" });
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
      selectWallet: (id) => state.phase === "open" && setState({ ...state, walletId: id }),
    }),
    [state, persistence, kdf, open, lock, vault],
  );

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>;
}
