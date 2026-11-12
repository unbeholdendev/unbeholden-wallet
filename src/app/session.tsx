import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { loadSend, type SendDraft, saveSend } from "../core/send";
import { openWallet, type WalletSession, type WalletSnapshot } from "../core/wallet";
import { walletDescriptor } from "../core/wallets";
import { log } from "../log";
import type { Network } from "../wallet/network";
import { walletKind } from "../wallet/select";
import { useConnection } from "./connection";
import { useVault } from "./vault";

const SessionsContext = createContext<ReadonlyMap<string, WalletSession>>(new Map());
const SessionContext = createContext<WalletSession | null>(null);
const DraftContext = createContext<[SendDraft | null, Dispatch<SetStateAction<SendDraft | null>>]>([null, () => {}]);
const SkipContext = createContext(new Map<string, string>());
const FailedContext = createContext<{ message: string; retry(): void } | null>(null);

function without<T>(all: ReadonlyMap<string, T>, id: string): ReadonlyMap<string, T> {
  if (!all.has(id)) return all;
  const rest = new Map(all);
  rest.delete(id);
  return rest;
}

type Pool = { opening: Map<string, Promise<WalletSession | null>>; closed: boolean };

/**
 * Opens every wallet in the vault, the selected one first, syncs them while
 * the connection is up, and closes them on a server change, a restored backup
 * or a lock, or one on its removal. Holds the selected wallet's unfinished
 * send, kept in the vault once its PSBT is built, and each wallet's skipped
 * receive address until the lock.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { vault, wallets, walletId, settings, restored } = useVault();
  const { backend, connection } = useConnection();
  const live = connection.phase === "connected" ? backend : null;
  const liveNow = useRef(live);
  liveNow.current = live;
  const [pool, setPool] = useState<Pool | null>(null);
  const [sessions, setSessions] = useState<ReadonlyMap<string, WalletSession>>(new Map());
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map());
  const skips = useRef(new Map<string, string>()).current;
  const draft = useState<SendDraft | null>(null);
  const setDraft = draft[1];

  useEffect(() => {
    if (!settings.server) return;
    const next: Pool = { opening: new Map(), closed: false };
    setPool(next);
    return () => {
      next.closed = true;
      for (const opening of next.opening.values()) opening.then((session) => session?.close());
      setPool(null);
      setSessions(new Map());
      setFailures(new Map());
    };
  }, [vault, settings.server, restored]);

  useEffect(() => {
    if (!pool) return;
    const present = new Set(wallets.map((w) => w.id));
    for (const [id, opening] of pool.opening) {
      if (present.has(id)) continue;
      pool.opening.delete(id);
      opening.then((session) => session?.close());
      setSessions((all) => without(all, id));
      setFailures((all) => without(all, id));
    }
    const open = (id: string, after: Promise<unknown>) => {
      const current = () => !pool.closed && pool.opening.get(id) === opening;
      const opening: Promise<WalletSession | null> = after
        .then(() => (current() ? openWallet(vault, id, null) : null))
        .then(
          (session) => {
            if (session && !current()) return (session.close(), null);
            if (session) {
              session.use(liveNow.current);
              setSessions((all) => new Map(all).set(id, session));
            }
            return session;
          },
          (error) => {
            const message = String((error as Error)?.message ?? error);
            log("wallet open failed", { message });
            if (current()) setFailures((all) => new Map(all).set(id, message));
            return null;
          },
        );
      pool.opening.set(id, opening);
    };
    if (walletId && !pool.opening.has(walletId)) open(walletId, Promise.resolve());
    const first = (walletId && pool.opening.get(walletId)) || Promise.resolve();
    for (const id of present) if (!pool.opening.has(id)) open(id, first);
  }, [pool, wallets, walletId, failures]);

  useEffect(() => {
    for (const session of sessions.values()) session.use(live);
  }, [sessions, live]);

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

  const session = (walletId && sessions.get(walletId)) || null;
  const failed = walletId ? failures.get(walletId) : undefined;
  const retry = () => {
    pool?.opening.delete(walletId!);
    setFailures((all) => without(all, walletId!));
  };
  return (
    <SessionsContext.Provider value={sessions}>
      <SessionContext.Provider value={session}>
        <DraftContext.Provider value={draft}>
          <SkipContext.Provider value={skips}>
            <FailedContext.Provider value={failed === undefined ? null : { message: failed, retry }}>
              {children}
            </FailedContext.Provider>
          </SkipContext.Provider>
        </DraftContext.Provider>
      </SessionContext.Provider>
    </SessionsContext.Provider>
  );
}

/** The selected wallet's session, null while it opens. */
export const useWalletSession = () => useContext(SessionContext);

/** Why the selected wallet could not be opened, and a retry. */
export const useOpenFailure = () => useContext(FailedContext);

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
    return { record, descriptor, network: record.network, kind: walletKind(descriptor) };
  }, [record]);
}

/** Every open wallet's session, by wallet id. */
export const useWalletSessions = () => useContext(SessionsContext);

/** Every open wallet's live snapshot. */
function useSnapshots(): WalletSnapshot[] {
  const sessions = useWalletSessions();
  const last = useRef<WalletSnapshot[]>([]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = [...sessions.values()].map((session) => session.subscribe(listener));
      return () => stops.forEach((stop) => stop());
    },
    [sessions],
  );
  return useSyncExternalStore(subscribe, () => {
    const now = [...sessions.values()].map((session) => session.getSnapshot());
    if (now.length !== last.current.length || now.some((snapshot, i) => snapshot !== last.current[i]))
      last.current = now;
    return last.current;
  });
}

/** Each address the open wallets watch, by the name of the wallet that owns it. */
export function useOwners(): Map<string, string> {
  const snapshots = useSnapshots();
  const { wallets } = useVault();
  return useMemo(() => {
    const names = new Map(wallets.map((w) => [w.id, w.name]));
    return new Map(
      snapshots.flatMap((snapshot) => {
        const name = names.get(snapshot.id);
        return name === undefined
          ? []
          : [...snapshot.addresses.receive, ...snapshot.addresses.change].map((a) => [a.address, name] as const);
      }),
    );
  }, [snapshots, wallets]);
}

/** The selected wallet's network, else the server's, for reading addresses with no wallet imported. */
export function useNetwork(): Network {
  const { wallets, walletId } = useVault();
  const { connection } = useConnection();
  return (
    wallets.find((w) => w.id === walletId)?.network ??
    (connection.phase !== "idle" && connection.phase !== "failed" ? connection.network : null) ??
    "mainnet"
  );
}
