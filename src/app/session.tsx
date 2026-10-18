import { hex } from "@scure/base";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { openWallet, type WalletSession, type WalletSnapshot } from "../core/wallet";
import { walletDescriptor } from "../core/wallets";
import type { SendDraft } from "../screens/send/Send";
import type { Store } from "../vault/vault";
import { useBackendFactory } from "./connection";
import { useVault } from "./vault";

const SessionContext = createContext<WalletSession | null>(null);
const DraftContext = createContext<[SendDraft | null, Dispatch<SetStateAction<SendDraft | null>>]>([null, () => {}]);
const SkipContext = createContext(new Map<string, string>());

type Saved = Omit<SendDraft, "built"> & { built: Omit<NonNullable<SendDraft["built"]>, "psbt" | "signed"> & { psbt: string; signed?: string } };

/** Keeps a send with a built PSBT in the vault, so it outlasts a lock or a reload, and forgets one without. */
async function saveSend(vault: Store, walletId: string, draft: SendDraft | null): Promise<void> {
  const built = draft?.built;
  if (!built) return vault.delete(`send/${walletId}`);
  const signed = built.signed && hex.encode(built.signed);
  await vault.put(`send/${walletId}`, { ...draft, built: { ...built, psbt: hex.encode(built.psbt), signed } });
}

async function loadSend(vault: Store, walletId: string): Promise<SendDraft | null> {
  const saved = await vault.get<Saved>(`send/${walletId}`);
  if (!saved) return null;
  const { psbt, signed, ...built } = saved.built;
  return { ...saved, built: { ...built, psbt: hex.decode(psbt), signed: signed ? hex.decode(signed) : undefined } };
}

/**
 * Opens the selected wallet on its own backend to the saved server, and closes
 * it on a switch, a server change or a lock. Holds the selected wallet's
 * unfinished send, kept in the vault once its PSBT is built, and each
 * wallet's skipped receive address until the lock.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { vault, walletId, settings } = useVault();
  const factory = useBackendFactory();
  const [session, setSession] = useState<WalletSession | null>(null);
  const skips = useRef(new Map<string, string>()).current;
  const draft = useState<SendDraft | null>(null);
  const setDraft = draft[1];

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

  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (!walletId) return;
    let cancelled = false;
    loadSend(vault, walletId).then((saved) => {
      if (cancelled) return;
      loaded.current = walletId;
      if (saved) setDraft(saved);
    });
    return () => {
      cancelled = true;
      loaded.current = null;
      setDraft(null);
    };
  }, [vault, walletId]);

  const built = draft[0]?.built;
  useEffect(() => {
    if (walletId && loaded.current === walletId) saveSend(vault, walletId, draft[0]).catch(() => {});
  }, [built]);

  return (
    <SessionContext.Provider value={session}>
      <DraftContext.Provider value={draft}>
        <SkipContext.Provider value={skips}>{children}</SkipContext.Provider>
      </DraftContext.Provider>
    </SessionContext.Provider>
  );
}

/** The selected wallet's session, null while it opens. */
export const useWalletSession = () => useContext(SessionContext);

/** The selected wallet's unfinished send and its setter. */
export const useSendDraft = () => useContext(DraftContext);

/** Receive's "Use a new address" position, by wallet id. Gone on a lock. */
export const useReceiveSkips = () => useContext(SkipContext);

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
