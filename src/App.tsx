import { useEffect, useState } from "react";
import { BackendProvider, ConnectionProvider, useConnection, type BackendFactory } from "./app/connection";
import { Page } from "./app/layout";
import { useRoute } from "./app/route";
import { SessionProvider } from "./app/session";
import { Shell, type Tab } from "./app/Shell";
import { useVault, useVaultState, VaultProvider } from "./app/vault";
import { registerServiceWorker } from "./pwa/register";
import { Connect } from "./screens/Connect";
import { CreateVault } from "./screens/CreateVault";
import { Guide, Trust } from "./screens/Guides";
import { ImportWallet } from "./screens/ImportWallet";
import { Placeholder } from "./screens/Placeholders";
import { Settings } from "./screens/Settings";
import { Unlock } from "./screens/Unlock";
import { Button, LinkButton } from "./ui/kit";
import { ToastProvider } from "./ui/toast";
import type { KdfParams } from "./vault/vault";

const TABS: string[] = ["home", "send", "receive", "coins", "addresses"] satisfies Tab[];

function Unlocked({ route }: { route: string[] }) {
  const { settings, wallets, lock } = useVault();
  const { connection, connect, disconnect } = useConnection();
  const [reached, setReached] = useState(false);

  // Once per unlock: the connect screen reconnects itself when the URL changes.
  useEffect(() => {
    if (settings.server) connect(settings.server);
    return disconnect;
  }, []);

  useEffect(() => {
    if (connection.phase === "connected") setReached(true);
  }, [connection.phase]);

  if (!wallets.length)
    return <Page aside={<LinkButton onClick={lock}>Lock</LinkButton>}>{reached ? <ImportWallet /> : <Connect onboarding />}</Page>;

  const [screen = "home", detail] = route;
  const body =
    screen === "settings" ? <Settings /> :
    screen === "connect" ? <Connect /> :
    screen === "import" ? <ImportWallet /> :
    screen === "tx" ? <Placeholder screen="tx" detail={detail} /> :
    <Placeholder screen={TABS.includes(screen) ? (screen as Tab) : "home"} />;
  return (
    <SessionProvider>
      <Shell tab={TABS.includes(screen) ? (screen as Tab) : null}>{body}</Shell>
    </SessionProvider>
  );
}

function Root() {
  const route = useRoute();
  const { state } = useVaultState();
  if (route[0] === "trust") return <Trust />;
  if (route[0] === "guide") return <Guide />;
  if (state.phase === "loading") return null;
  if (state.phase === "absent") return <CreateVault />;
  if (state.phase === "locked") return <Unlock />;
  return <Unlocked route={route} />;
}

function UpdatePrompt() {
  const [apply, setApply] = useState<(() => void) | null>(null);
  useEffect(() => registerServiceWorker((next) => setApply(() => next)), []);
  if (!apply) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-[480px] flex-wrap items-center gap-3 rounded-panel border border-rule-2 bg-sheet p-3 pl-4 shadow-float min-[720px]:bottom-6">
      <p className="m-0 flex-1 text-sm">A new version is ready. It runs only when you reload.</p>
      <Button size="sm" variant="primary" onClick={apply}>
        Reload now
      </Button>
    </div>
  );
}

export function App({ factory, kdf }: { factory: BackendFactory; kdf?: KdfParams }) {
  return (
    <ToastProvider>
      <BackendProvider factory={factory}>
        <VaultProvider kdf={kdf}>
          <ConnectionProvider>
            <Root />
            <UpdatePrompt />
          </ConnectionProvider>
        </VaultProvider>
      </BackendProvider>
    </ToastProvider>
  );
}
