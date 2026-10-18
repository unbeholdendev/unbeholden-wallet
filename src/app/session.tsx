import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { openWallet, type WalletSession, type WalletSnapshot } from "../core/wallet";
import { walletDescriptor } from "../core/wallets";
import { useBackendFactory } from "./connection";
import { useVault } from "./vault";

const SessionContext = createContext<WalletSession | null>(null);

/**
 * Opens the selected wallet on its own backend to the saved server, and closes
 * it on a switch, a server change or a lock.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { vault, walletId, settings } = useVault();
  const factory = useBackendFactory();
  const [session, setSession] = useState<WalletSession | null>(null);

  useEffect(() => {
    if (!walletId || !settings.server) return;
    let open: WalletSession | null = null;
    let cancelled = false;
    openWallet(vault, walletId, factory(settings.server)).then((opened) =>
      cancelled ? opened.close() : setSession((open = opened)),
    );
    return () => {
      cancelled = true;
      open?.close();
      setSession(null);
    };
  }, [vault, walletId, settings.server, factory]);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** The selected wallet's session, null while it opens. */
export const useWalletSession = () => useContext(SessionContext);

const none = () => () => {};

/** The selected wallet's live snapshot, null while it opens. */
export function useWalletSnapshot(): WalletSnapshot | null {
  const session = useWalletSession();
  return useSyncExternalStore(session?.subscribe ?? none, () => session?.getSnapshot() ?? null);
}

/** The selected wallet's record, descriptor and network. */
export function useWallet() {
  const { wallets, walletId } = useVault();
  const record = wallets.find((w) => w.id === walletId)!;
  return useMemo(() => {
    const descriptor = walletDescriptor(record);
    return { record, descriptor, network: record.network, scriptType: descriptor.scriptType };
  }, [record]);
}
