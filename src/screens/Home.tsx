import { useConnection } from "../app/connection";
import { useSendDraft, useWalletSession, useWalletSnapshot } from "../app/session";
import { useVault } from "../app/vault";
import { stillPending } from "../core/send";
import { groupSats } from "../ui/amount";
import { hostText } from "../ui/format";
import { Icon } from "../ui/icons";
import { buttonClass, Empty, linkClass, Panel } from "../ui/kit";
import { RestoreBackup } from "./Backup";
import { Balance } from "./home/Balance";
import { CoinAge } from "./home/CoinAge";
import { History } from "./home/History";
import { Network } from "./home/Network";
import { Pending } from "./home/Pending";
import { Sources } from "./home/Sources";
import { Stats } from "./home/Stats";
import { Opening } from "./parts";

export function Home() {
  const snapshot = useWalletSnapshot();
  const session = useWalletSession();
  const [draft] = useSendDraft();
  if (!snapshot) return <Opening title="Home" />;
  const fresh = !snapshot.transactions.length;
  const built = draft?.built && stillPending(draft.built, snapshot) ? draft.built : null;
  const left = "empty:hidden @min-[900px]/app:col-start-1";
  return (
    <div className="grid content-start gap-6">
      <h1 className="sr-only">Home</h1>
      {snapshot.reorg && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-control bg-warn-tint px-3 py-2.5 text-sm text-warn"
        >
          <Icon name="warn" className="mt-px size-[18px]" />
          <p className="m-0 flex-1 text-ink">
            <b className="font-bold text-warn">The chain reorganised.</b> The tip moved to a different block at height{" "}
            {groupSats(snapshot.reorg.height)}, so this wallet threw away what it had cached and synced again. Balances
            and confirmations below are current.
          </p>
          <button
            type="button"
            onClick={() => session?.dismissReorg()}
            aria-label="Dismiss"
            className="-m-1 grid size-8 flex-none place-items-center rounded-control hover:bg-[color-mix(in_srgb,var(--warn)_12%,transparent)]"
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      <div className="grid items-start gap-6 @min-[900px]/app:grid-cols-[360px_minmax(0,1fr)] @min-[900px]/app:grid-rows-[auto_auto_auto_auto_auto_1fr]">
        <div className={left}>
          <Balance snapshot={snapshot} />
        </div>
        <div className={left}>
          <Pending snapshot={snapshot} waiting={built ? (built.signed ? "broadcast" : "sign") : null} />
        </div>
        <div className={left}>
          <Sources snapshot={snapshot} />
        </div>
        <div className={left}>
          <Network />
        </div>
        <div className={left}>
          {!fresh && (
            <div className="grid gap-6">
              <Stats snapshot={snapshot} />
              <CoinAge snapshot={snapshot} />
            </div>
          )}
        </div>
        <div className="min-w-0 @min-[900px]/app:col-start-2 @min-[900px]/app:row-span-6 @min-[900px]/app:row-start-1">
          {fresh && snapshot.tip && !snapshot.progress ? (
            <Empty title="No transactions yet">
              <p className="m-0">
                Nothing has been paid to this wallet&rsquo;s addresses. To receive, share an unused address from{" "}
                <a className={linkClass} href="#/receive">
                  Receive
                </a>
                . If you expected coins here, they may sit beyond the addresses this wallet checks;{" "}
                <a className={linkClass} href="#/addresses">
                  scan further
                </a>
                .
              </p>
            </Empty>
          ) : fresh ? (
            <p className="m-0 text-ink-3">Transactions appear here once the first sync finishes.</p>
          ) : (
            <History snapshot={snapshot} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Home and the wallet tabs before there is a wallet. */
export function Start() {
  const { connection } = useConnection();
  const { settings, draft } = useVault();
  const connected = connection.phase === "connected" || connection.phase === "retrying";
  return (
    <div className="grid max-w-[720px] content-start gap-6">
      <div className="grid gap-1">
        <h1 className="m-0 text-xl font-bold">No wallet yet</h1>
        <p className="m-0 text-ink-2">
          Connect to your server and add a wallet, in either order.
          {draft && " Nothing is saved in this browser until you add a wallet and choose a passphrase."}
        </p>
      </div>
      <div className="grid gap-4 @min-[720px]/app:grid-cols-2">
        <Panel title="Your server" aside={connected ? "Connected" : settings.server ? "Not connected" : undefined}>
          <p className="m-0 text-sm text-ink-2">
            {connected ? (
              <>Connected to {hostText(connection.url)}.</>
            ) : (
              "An Electrum server or Esplora API you run. The wallet talks to nothing else."
            )}
          </p>
          <a
            className={`${buttonClass({ variant: connected ? "default" : "primary" })} justify-self-start`}
            href="#/connect"
          >
            {connected ? "See the connection" : "Connect to your server"}
          </a>
        </Panel>
        <Panel title="Your wallet">
          <p className="m-0 text-sm text-ink-2">
            An output descriptor or extended public key from your signer. No private keys.
          </p>
          <a
            className={`${buttonClass({ variant: connected ? "primary" : "default" })} justify-self-start`}
            href="#/import"
          >
            Add a wallet
          </a>
        </Panel>
      </div>
      {draft && (
        <Panel title="Or restore from a backup">
          <RestoreBackup />
        </Panel>
      )}
    </div>
  );
}
