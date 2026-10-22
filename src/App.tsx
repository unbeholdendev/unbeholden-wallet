import { useEffect, useState } from "react";
import { BackendProvider, ConnectionProvider, useConnection, type BackendFactory } from "./app/connection";
import { Page } from "./app/layout";
import { useRoute } from "./app/route";
import { SessionProvider } from "./app/session";
import { log } from "./log";
import { Shell, type Tab } from "./app/Shell";
import { useVault, useVaultState, VaultProvider } from "./app/vault";
import { registerServiceWorker } from "./pwa/register";
import { Connect } from "./screens/Connect";
import { CreateVault } from "./screens/CreateVault";
import { Guide, Trust } from "./screens/Guides";
import { ImportWallet } from "./screens/ImportWallet";
import { Addresses } from "./screens/Addresses";
import { Coins } from "./screens/Coins";
import { Home } from "./screens/Home";
import { Receive } from "./screens/Receive";
import { Bump, type BumpMode } from "./screens/send/Bump";
import { Send } from "./screens/send/Send";
import { BroadcastSigned } from "./screens/send/Sign";
import { Transaction } from "./screens/Transaction";
import { CoinHistory } from "./screens/CoinHistory";
import { Settings } from "./screens/Settings";
import { Unlock } from "./screens/Unlock";
import { RestoreBackup } from "./screens/Backup";
import { Button, Empty, linkClass, LinkButton, Panel } from "./ui/kit";
import { ToastProvider } from "./ui/toast";
import type { KdfParams } from "./vault/vault";

const TABS: string[] = ["home", "send", "receive", "coins"] satisfies Tab[];
const BUMPS: Record<string, BumpMode | undefined> = { bump: "speed", cancel: "cancel", cpfp: "cpfp" };

function Unlocked({ route }: { route: string[] }) {
  const { settings, wallets, draft, passphrase, lock } = useVault();
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
    return (
      <Page aside={passphrase ? <LinkButton onClick={lock}>Lock</LinkButton> : undefined}>
        {reached ? <ImportWallet /> : <Connect onboarding />}
        {draft && (
          <Panel title="Or restore from a backup" className="max-w-[400px]">
            <RestoreBackup />
          </Panel>
        )}
      </Page>
    );
  if (draft)
    return (
      <SessionProvider>
        <CreateVault />
      </SessionProvider>
    );

  const [screen = "home", detail] = route;
  const body =
    screen === "settings" ? <Settings /> :
    screen === "connect" ? <Connect /> :
    screen === "import" ? <ImportWallet /> :
    screen === "tx" ? <Transaction txid={detail} /> :
    screen === "coin" ? <CoinHistory point={detail} /> :
    screen === "send" ? <Send /> :
    screen === "broadcast" ? <BroadcastSigned /> :
    BUMPS[screen] && detail ? <Bump key={screen + detail} txid={detail} mode={BUMPS[screen]} /> :
    screen === "receive" ? <Receive /> :
    screen === "coins" ? <Coins /> :
    screen === "addresses" ? <Addresses /> :
    <Home />;
  return (
    <SessionProvider>
      <Shell tab={BUMPS[screen] || screen === "broadcast" ? "send" : screen === "coin" ? "coins" : TABS.includes(screen) ? (screen as Tab) : null}>{body}</Shell>
    </SessionProvider>
  );
}

function Insecure() {
  return (
    <Page>
      <Empty title="Open this over https or localhost">
        <div className="grid gap-3">
          <p>
            The vault needs your browser's encryption, and a browser only offers it to a secure page. Plain http to a network
            address isn't one. Open the app over https, or at http://localhost on the computer running it.
          </p>
          <a className={linkClass} href="#/guide">
            How to reach it from another device
          </a>
        </div>
      </Empty>
    </Page>
  );
}

function Root() {
  const route = useRoute();
  const { state } = useVaultState();
  useEffect(() => log("screen", { screen: route[0] ?? "home", vault: state.phase }), [route[0], state.phase]);
  if (route[0] === "trust") return <Trust />;
  if (route[0] === "guide") return <Guide />;
  if (!window.isSecureContext) return <Insecure />;
  if (state.phase !== "open") return state.phase === "locked" ? <Unlock /> : null;
  return <Unlocked key={String(state.draft)} route={route} />;
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
