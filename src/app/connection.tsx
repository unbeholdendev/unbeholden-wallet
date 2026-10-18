import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ConnectionError, type ConnectionFailure, type WalletBackend } from "../backend/backend";
import type { ConnectionStatus as Live, ElectrumBackend } from "../backend/electrum";
import { LOOPBACK } from "../backend/handshake";

export type Failure = ConnectionFailure | "invalid-url";

/** The fake backend in tests has no status to report, so these are optional. */
type Observable = WalletBackend & Partial<Pick<ElectrumBackend, "onStatus" | "server">>;

export type BackendFactory = (url: string) => Observable;

export type Connection =
  | { phase: "idle" }
  | { phase: Live; url: string; software: string | null; tip: number | null }
  | { phase: "failed"; url: string; failure: Failure | null; message: string };

const FactoryContext = createContext<BackendFactory | null>(null);

type ConnectionApi = {
  connection: Connection;
  backend: WalletBackend | null;
  /** Resolves true once connected; a failure lands in `connection`. */
  connect(url: string): Promise<boolean>;
  disconnect(): void;
};

const ConnectionContext = createContext<ConnectionApi | null>(null);

export function useConnection(): ConnectionApi {
  const api = useContext(ConnectionContext);
  if (!api) throw new Error("useConnection outside ConnectionProvider");
  return api;
}

/** Why a URL cannot be tried at all, before a socket is opened. */
export function precheck(url: string): Failure | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "invalid-url";
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return "invalid-url";
  if (parsed.protocol === "ws:" && location.protocol === "https:" && !LOOPBACK.test(parsed.hostname)) return "mixed-content";
  return null;
}

export function useBackendFactory(): BackendFactory {
  const factory = useContext(FactoryContext);
  if (!factory) throw new Error("useBackendFactory outside BackendProvider");
  return factory;
}

export function BackendProvider({ factory, children }: { factory: BackendFactory; children: ReactNode }) {
  return <FactoryContext.Provider value={factory}>{children}</FactoryContext.Provider>;
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const factory = useBackendFactory();
  const [connection, setConnection] = useState<Connection>({ phase: "idle" });
  const [backend, setBackend] = useState<Observable | null>(null);
  const attempt = useRef(0);
  const current = useRef<Observable | null>(null);

  const disconnect = useCallback(() => {
    attempt.current++;
    current.current?.close();
    current.current = null;
    setBackend(null);
    setConnection({ phase: "idle" });
  }, []);

  const connect = useCallback(
    async (url: string) => {
      disconnect();
      const mine = ++attempt.current;
      const stale = () => mine !== attempt.current;
      const early = precheck(url);
      if (early) {
        setConnection({ phase: "failed", url, failure: early, message: early });
        return false;
      }
      const next = factory(url);
      setConnection({ phase: "connecting", url, software: null, tip: null });
      try {
        await next.connect();
      } catch (error) {
        next.close();
        if (stale()) return false;
        const failure = error instanceof ConnectionError ? error.failure : null;
        setConnection({ phase: "failed", url, failure, message: String((error as Error)?.message ?? error) });
        return false;
      }
      if (stale()) {
        next.close();
        return false;
      }
      const software = next.server?.()?.software ?? null;
      setConnection({ phase: "connected", url, software, tip: null });
      current.current = next;
      setBackend(next);
      const update = (patch: Partial<{ phase: Live; tip: number }>) =>
        !stale() && setConnection((c) => (c.phase === "failed" || c.phase === "idle" ? c : { ...c, ...patch }));
      next.onStatus?.((phase) => update({ phase }));
      next.chainTip().then(({ height }) => update({ tip: height }), () => {});
      next.subscribeHeaders(({ height }) => update({ tip: height })).catch(() => {});
      return true;
    },
    [factory, disconnect],
  );

  useEffect(() => disconnect, [disconnect]);

  return (
    <ConnectionContext.Provider value={{ connection, backend, connect, disconnect }}>{children}</ConnectionContext.Provider>
  );
}
