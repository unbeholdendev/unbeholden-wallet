import { useEffect, useRef, type ReactNode } from "react";
import { groupSats } from "../ui/amount";
import { hostText } from "../ui/format";
import { Icon, type IconName } from "../ui/icons";
import { useConnection, type Connection } from "./connection";
import { Footer, InstallPrompt } from "./layout";
import { usePaymentNotifications } from "./notify";
import { walletDescriptor, type WalletRecord } from "../core/wallets";
import { useVault } from "./vault";

export type Tab = "home" | "send" | "receive" | "coins";

const tabs: { id: Tab; label: string; icon: IconName }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "send", label: "Send", icon: "send" },
  { id: "receive", label: "Receive", icon: "recv" },
  { id: "coins", label: "Coins", icon: "coins" },
];

const scriptType = (w: WalletRecord) => {
  try {
    const { scriptType, keys, multi } = walletDescriptor(w);
    return multi ? `${multi.threshold}-of-${keys.length}` : scriptType;
  } catch {
    return null;
  }
};

function NetworkBadge({ wallet }: { wallet: WalletRecord }) {
  if (wallet.network === "mainnet") return null;
  return (
    <span className="rounded-chip bg-warn-tint px-1.5 py-px text-[11px] font-bold tracking-[0.06em] text-warn uppercase">
      {wallet.network}
    </span>
  );
}

function WalletSwitcher() {
  const { wallets, walletId, selectWallet } = useVault();
  const menu = useRef<HTMLDetailsElement>(null);
  const current = wallets.find((w) => w.id === walletId);
  const close = () => menu.current?.removeAttribute("open");
  useEffect(() => {
    const away = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menu.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", away);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", away);
    };
  }, []);
  if (!current) return null;
  return (
    <details ref={menu} className="group relative min-w-0">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2.5 rounded-control px-2 py-1.5 hover:bg-sunk [&::-webkit-details-marker]:hidden">
        <span className="truncate font-bold">{current.name}</span>
        <span className="hidden text-sm font-medium text-ink-3 @min-[720px]/app:inline">{scriptType(current)}</span>
        <NetworkBadge wallet={current} />
        <Icon name="chev" className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute top-[calc(100%+6px)] left-0 z-20 grid min-w-[260px] gap-0.5 rounded-panel border border-rule-2 bg-sheet p-1.5 text-ink shadow-float">
        {wallets.map((w) => (
          <button
            key={w.id}
            type="button"
            aria-current={w.id === walletId}
            onClick={() => {
              selectWallet(w.id);
              close();
            }}
            className="flex items-baseline justify-between gap-3 rounded-control px-2.5 py-2 text-left hover:bg-sunk aria-[current=true]:bg-carbon-tint"
          >
            <span className="font-medium">{w.name}</span>
            <span className="flex items-center gap-1.5 text-xs text-ink-3">
              {scriptType(w)} <NetworkBadge wallet={w} />
            </span>
          </button>
        ))}
        <hr className="my-1 border-rule" />
        <a href="#/addresses" onClick={close} className="rounded-control px-2.5 py-2 text-ink hover:bg-sunk">
          Addresses
        </a>
        <a href="#/import" onClick={close} className="flex items-center gap-2 rounded-control px-2.5 py-2 font-medium text-carbon hover:bg-sunk">
          <Icon name="plus" className="size-4" /> Add a wallet
        </a>
      </div>
    </details>
  );
}

function statusOf(connection: Connection) {
  switch (connection.phase) {
    case "connected":
      return { dot: "bg-ok", text: <>Connected to <b className="font-medium text-ink">{hostText(connection.url)}</b></>, short: connection.tip === null ? "Connected" : groupSats(connection.tip) };
    case "connecting":
      return { dot: "bg-warn animate-pulse", text: <>Connecting to {hostText(connection.url)}</>, short: "Connecting" };
    case "retrying":
      return { dot: "bg-warn animate-pulse", text: <>Lost {hostText(connection.url)}, retrying</>, short: "Retrying" };
    default:
      return { dot: "bg-bad", text: <>Not connected</>, short: "Offline" };
  }
}

function ConnectionStatus() {
  const { connection } = useConnection();
  const status = statusOf(connection);
  const tip = connection.phase === "connected" && connection.tip !== null ? connection.tip : null;
  return (
    <a href="#/connect" className="ml-auto flex min-w-0 items-center gap-2.5 rounded-control px-2 py-1.5 text-sm whitespace-nowrap text-ink-2 no-underline hover:bg-sunk">
      <span aria-hidden="true" className={`size-2 flex-none rounded-full ${status.dot}`} />
      <span className="@min-[720px]/app:hidden">{status.short}</span>
      <span className="hidden truncate @min-[720px]/app:inline">
        {status.text}
        {tip !== null && <> &middot; block {groupSats(tip)}</>}
      </span>
    </a>
  );
}

const barButton = "grid size-10 flex-none place-items-center rounded-control border border-rule-2 bg-sheet text-ink hover:bg-sunk";

/** The signed-in frame: top bar, tab bar at the bottom on a phone. */
export function Shell({ tab, children }: { tab: Tab | null; children: ReactNode }) {
  const { lock, passphrase, settings, saveSettings } = useVault();
  usePaymentNotifications();
  return (
    <div className="@container/app flex min-h-dvh flex-col bg-paper">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-rule bg-sheet px-4 text-ink @min-[720px]/app:gap-6 @min-[720px]/app:px-6">
        <WalletSwitcher />
        <nav aria-label="Main" className="hidden h-full @min-[720px]/app:flex">
          {tabs.map((t) => (
            <a
              key={t.id}
              href={`#/${t.id}`}
              aria-current={t.id === tab ? "page" : undefined}
              className="flex h-full items-center border-y-2 border-transparent px-3.5 font-medium text-ink-2 no-underline hover:text-ink aria-[current=page]:border-b-carbon aria-[current=page]:font-bold aria-[current=page]:text-ink"
            >
              {t.label}
            </a>
          ))}
        </nav>
        <ConnectionStatus />
        <button type="button" aria-label="Hide amounts" aria-pressed={!!settings.hide} onClick={() => void saveSettings({ hide: !settings.hide })} className={barButton}>
          <Icon name={settings.hide ? "eyeOff" : "eye"} />
        </button>
        <a href="#/settings" aria-label="Settings" className={barButton}>
          <Icon name="settings" />
        </a>
        {passphrase && (
          <button type="button" aria-label="Lock" onClick={lock} className={barButton}>
            <Icon name="lock" />
          </button>
        )}
      </header>
      <main className="mx-auto grid w-full max-w-[1280px] flex-1 content-start gap-6 p-4 @min-[720px]/app:p-6">
        <InstallPrompt />
        {children}
        <Footer />
      </main>
      <nav aria-label="Main" className="sticky bottom-0 z-10 grid grid-cols-4 border-t border-rule bg-sheet pb-[env(safe-area-inset-bottom)] text-ink-2 @min-[720px]/app:hidden">
        {tabs.map((t) => (
          <a
            key={t.id}
            href={`#/${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className="group grid h-14 content-center justify-items-center gap-0.5 border-t-2 border-transparent text-xs font-medium no-underline aria-[current=page]:border-carbon aria-[current=page]:font-bold aria-[current=page]:text-ink"
          >
            <span className="group-aria-[current=page]:text-carbon">
              <Icon name={t.icon} />
            </span>
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
