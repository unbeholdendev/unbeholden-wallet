import { useRef, type ReactNode } from "react";
import { groupSats } from "../ui/amount";
import { hostText } from "../ui/format";
import { Icon, type IconName } from "../ui/icons";
import { useConnection, type Connection } from "./connection";
import { Footer, InstallPrompt } from "./layout";
import { walletDescriptor, type WalletRecord } from "../core/wallets";
import { useVault } from "./vault";

export type Tab = "home" | "send" | "receive" | "coins";

const tabs: { id: Tab; label: string; icon: IconName }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "send", label: "Send", icon: "send" },
  { id: "receive", label: "Receive", icon: "recv" },
  { id: "coins", label: "Coins", icon: "coins" },
];

const scriptType = (w: WalletRecord) => walletDescriptor(w).scriptType;

function NetworkBadge({ wallet }: { wallet: WalletRecord }) {
  if (wallet.network === "mainnet") return null;
  return (
    <span className="rounded-chip bg-warn-tint px-1.5 py-px text-[11px] font-semibold tracking-[0.06em] text-warn uppercase">
      {wallet.network}
    </span>
  );
}

function WalletSwitcher() {
  const { wallets, walletId, selectWallet } = useVault();
  const menu = useRef<HTMLDetailsElement>(null);
  const current = wallets.find((w) => w.id === walletId);
  const close = () => menu.current?.removeAttribute("open");
  if (!current) return null;
  return (
    <details ref={menu} className="group relative min-w-0">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2.5 rounded-control border border-legend-rule px-2.5 py-1.5 hover:bg-legend-hi [&::-webkit-details-marker]:hidden">
        <span className="truncate text-md font-semibold">{current.name}</span>
        <span className="hidden text-xs text-legend-ink-2 @min-[720px]/app:inline">{scriptType(current)}</span>
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
            className="flex items-baseline justify-between gap-3 rounded-control px-2.5 py-2 text-left hover:bg-sunk aria-[current=true]:bg-route-tint"
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
        <a href="#/import" onClick={close} className="flex items-center gap-2 rounded-control px-2.5 py-2 font-medium text-route hover:bg-sunk">
          <Icon name="plus" className="size-4" /> Add a wallet
        </a>
      </div>
    </details>
  );
}

function statusOf(connection: Connection) {
  switch (connection.phase) {
    case "connected":
      return { dot: "bg-[#5fc27a]", text: <>Connected to <b className="font-medium text-legend-ink">{hostText(connection.url)}</b></>, short: connection.tip === null ? "Connected" : groupSats(connection.tip) };
    case "connecting":
      return { dot: "bg-[#e6b95a] animate-pulse", text: <>Connecting to {hostText(connection.url)}</>, short: "Connecting" };
    case "retrying":
      return { dot: "bg-[#e6b95a] animate-pulse", text: <>Lost {hostText(connection.url)}, retrying</>, short: "Retrying" };
    default:
      return { dot: "bg-[#f2948a]", text: <>Not connected</>, short: "Offline" };
  }
}

function ConnectionStatus() {
  const { connection } = useConnection();
  const status = statusOf(connection);
  const tip = connection.phase === "connected" && connection.tip !== null ? connection.tip : null;
  return (
    <a href="#/connect" className="ml-auto flex min-w-0 items-center gap-2.5 rounded-control px-2 py-1.5 text-sm whitespace-nowrap text-legend-ink-2 no-underline hover:bg-legend-hi">
      <span aria-hidden="true" className={`size-2 flex-none rounded-full ${status.dot}`} />
      <span className="@min-[720px]/app:hidden">{status.short}</span>
      <span className="hidden truncate @min-[720px]/app:inline">
        {status.text}
        {tip !== null && <> &middot; block {groupSats(tip)}</>}
      </span>
    </a>
  );
}

const barButton = "grid size-[34px] flex-none place-items-center rounded-control border border-legend-rule text-legend-ink hover:bg-legend-hi";

/** The signed-in frame: legend bar on top, tab bar at the bottom on a phone. */
export function Shell({ tab, children }: { tab: Tab | null; children: ReactNode }) {
  const { lock } = useVault();
  return (
    <div className="@container/app flex min-h-dvh flex-col bg-paper">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-2 bg-legend px-3 text-legend-ink @min-[720px]/app:gap-4 @min-[720px]/app:px-6">
        <WalletSwitcher />
        <nav aria-label="Main" className="hidden h-full gap-1 @min-[720px]/app:flex">
          {tabs.map((t) => (
            <a
              key={t.id}
              href={`#/${t.id}`}
              aria-current={t.id === tab ? "page" : undefined}
              className="relative flex h-full items-center px-3 font-medium text-legend-ink-2 no-underline hover:text-legend-ink aria-[current=page]:text-legend-ink aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:bottom-0 aria-[current=page]:after:h-[3px] aria-[current=page]:after:rounded-t-[3px] aria-[current=page]:after:bg-route"
            >
              {t.label}
            </a>
          ))}
        </nav>
        <ConnectionStatus />
        <a href="#/settings" aria-label="Settings" className={barButton}>
          <Icon name="settings" />
        </a>
        <button type="button" aria-label="Lock" onClick={lock} className={barButton}>
          <Icon name="lock" />
        </button>
      </header>
      <main className="mx-auto grid w-full max-w-[1280px] flex-1 content-start gap-6 p-4 @min-[720px]/app:p-6">
        <InstallPrompt />
        {children}
        <Footer />
      </main>
      <nav aria-label="Main" className="sticky bottom-0 z-10 grid grid-cols-4 border-t border-legend-rule bg-legend pb-[env(safe-area-inset-bottom)] text-legend-ink-2 @min-[720px]/app:hidden">
        {tabs.map((t) => (
          <a
            key={t.id}
            href={`#/${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className="group grid h-14 content-center justify-items-center gap-0.5 text-xs font-medium no-underline aria-[current=page]:text-legend-ink"
          >
            <span className="group-aria-[current=page]:text-route-tint-2">
              <Icon name={t.icon} />
            </span>
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
