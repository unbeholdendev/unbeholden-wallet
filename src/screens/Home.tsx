import { useState } from "react";
import { navigate } from "../app/route";
import { useWalletSession, useWalletSnapshot } from "../app/session";
import { useVault } from "../app/vault";
import { feeRate, isOutgoing, txWhen } from "../core/view";
import type { WalletSnapshot, WalletTx } from "../core/wallet";
import { Amount, btcParts, groupSats } from "../ui/amount";
import { confText, dateText, hostText, timeText, txFallback } from "../ui/format";
import { Icon } from "../ui/icons";
import { Button, Chip, Empty, LinkButton, linkClass } from "../ui/kit";
import { SourceSwatch, sourcesOf } from "../ui/sources";
import { Opening } from "./parts";

const stages = { history: "Checking addresses", transactions: "Fetching transactions", blocks: "Fetching block times" };

function SyncLine({ snapshot }: { snapshot: WalletSnapshot }) {
  const session = useWalletSession();
  const { settings } = useVault();
  const server = settings.server ? hostText(settings.server) : "your server";
  const { progress, connection, tip } = snapshot;
  const [dot, text] = progress
    ? ["bg-warn animate-pulse", `${stages[progress.stage]}, ${groupSats(progress.done)} of ${groupSats(progress.total)}.`]
    : connection === "connecting"
      ? ["bg-warn animate-pulse", `Connecting to ${server}.`]
      : connection === "disconnected"
        ? ["bg-bad", `Not connected to ${server}. ${snapshot.error ?? "Balances are as of the last sync."}`]
        : ["bg-ok", tip ? `Up to date at block ${groupSats(tip.height)}. Watching ${server}.` : `Watching ${server}.`];
  return (
    <div role="status" className="flex items-center gap-2.5 border-t border-rule px-4 py-3 text-sm text-ink-2">
      <span aria-hidden="true" className={`size-2 flex-none rounded-full ${dot}`} />
      <span className="min-w-0 flex-1">{text}</span>
      {connection === "disconnected" && (
        <LinkButton className="text-sm" onClick={() => session?.refresh()}>
          Try again
        </LinkButton>
      )}
    </div>
  );
}

function Balance({ snapshot }: { snapshot: WalletSnapshot }) {
  const { confirmed, unconfirmed, frozen, spendable } = snapshot.balance;
  // Unconfirmed change of our own is already in spendable; what is left is other people's payments still waiting.
  const waiting = confirmed + unconfirmed - spendable - frozen;
  return (
    <section aria-label="Balance" className="rounded-panel border border-rule bg-sheet">
      <div className="grid gap-1 px-4 pt-5 pb-4">
        <span className="text-sm text-ink-2">Spendable now</span>
        <span className="text-2xl font-medium tracking-[-0.01em] @max-[380px]/app:text-[34px]">
          <Amount sats={spendable} unit />
        </span>
        {(waiting > 0 || frozen > 0) && (
          <span className="flex flex-wrap gap-x-3 text-sm text-ink-2">
            {waiting > 0 && (
              <span>
                <Amount sats={waiting} signed /> waiting to confirm
              </span>
            )}
            {frozen > 0 && (
              <span>
                <Amount sats={frozen} /> frozen
              </span>
            )}
          </span>
        )}
      </div>
      <SyncLine snapshot={snapshot} />
    </section>
  );
}

function SourcesKey({ snapshot }: { snapshot: WalletSnapshot }) {
  const sources = sourcesOf(snapshot);
  if (!sources.length) return null;
  return (
    <section className="rounded-panel border border-rule bg-sheet">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2">
        <h2 className="text-md font-semibold">Sources</h2>
        <a className={`${linkClass} text-sm`} href="#/coins">
          See coins
        </a>
      </div>
      <p className="m-0 px-4 pb-3 text-sm text-ink-3">Coins in one source are already linked to each other on-chain.</p>
      <ul className="m-0 list-none p-0">
        {sources.map((s) => (
          <li key={s.id} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-rule px-4 py-2.5 text-sm">
            <SourceSwatch source={s} />
            <span className="min-w-0">
              <span className="block truncate text-base font-medium">{s.name}</span>
              <span className="text-xs text-ink-3">
                {s.coins.length === 1 ? "1 coin" : `${s.coins.length} coins`}
                {s.tone === 0 && ", frozen"}
              </span>
            </span>
            <Amount sats={s.total} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function haystack(tx: WalletTx) {
  const when = txWhen(tx);
  const abs = Math.abs(tx.net);
  const { lead, rest } = btcParts(abs);
  return [
    tx.label ?? txFallback(tx),
    tx.txid,
    lead + rest,
    (abs / 1e8).toFixed(8),
    abs,
    when === null ? "unconfirmed" : `${dateText(when)} ${new Date(when * 1000).toISOString().slice(0, 10)}`,
  ]
    .join(" ")
    .toLowerCase();
}

function HistoryRow({ tx }: { tx: WalletTx }) {
  const when = txWhen(tx);
  const outgoing = isOutgoing(tx);
  const pending = tx.confirmations === 0;
  const rate = feeRate(tx);
  const date = when === null ? "Date unknown" : dateText(when);
  return (
    <li className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-rule px-4 py-3 hover:bg-sunk @min-[640px]:grid-cols-[96px_minmax(0,1fr)_96px_auto]">
      <span className="col-start-1 row-span-2 row-start-1 hidden text-sm text-ink-2 @min-[640px]:block">
        {date}
        {when !== null && (
          <>
            <br />
            {timeText(when)}
          </>
        )}
      </span>
      <a
        href={`#/tx/${tx.txid}`}
        className={`col-start-1 row-start-1 min-w-0 truncate font-medium no-underline after:absolute after:inset-0 @min-[640px]:col-start-2 ${tx.label ? "text-ink" : "text-ink-2"}`}
      >
        {tx.label ?? txFallback(tx)}
      </a>
      <span className="col-start-3 row-start-1 hidden text-right text-sm whitespace-nowrap text-ink-2 @min-[640px]:block">
        {pending ? <Chip tone="warn">Unconfirmed</Chip> : confText(tx.confirmations)}
      </span>
      <span className="col-start-2 row-start-1 text-right text-md @min-[640px]:col-start-4">
        <Amount sats={tx.net} signed />
      </span>
      <span className="col-start-1 row-start-2 text-sm text-ink-3 @min-[640px]:hidden">
        {date} &middot; {pending ? "unconfirmed" : confText(tx.confirmations).toLowerCase()}
      </span>
      {pending && (
        <span className="col-span-2 row-start-3 mt-1 flex flex-wrap items-center gap-1.5 @min-[640px]:col-span-3 @min-[640px]:col-start-2 @min-[640px]:row-start-2">
          {outgoing ? (
            <>
              {rate !== null && <Chip>Waiting at {rate} sat/vB</Chip>}
              <Button size="sm" className="relative z-[1]" onClick={() => navigate(`/bump/${tx.txid}`)}>
                Speed up
              </Button>
            </>
          ) : (
            <Chip tone="warn">From someone else, can still be replaced</Chip>
          )}
        </span>
      )}
    </li>
  );
}

function History({ snapshot }: { snapshot: WalletSnapshot }) {
  const [query, setQuery] = useState("");
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = snapshot.transactions.filter((tx) => {
    if (!terms.length) return true;
    const text = haystack(tx);
    return terms.every((t) => text.includes(t));
  });
  return (
    <section className="@container min-w-0 rounded-panel border border-rule bg-sheet">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 pb-3">
        <h2 className="text-md font-semibold">Transactions</h2>
        <label className="flex min-h-9 w-full items-center gap-2 rounded-control border border-rule-2 bg-sheet px-2.5 text-ink-3 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-route @min-[480px]:w-64">
          <Icon name="search" className="size-4" />
          <span className="sr-only">Search transactions</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Label, amount or date"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-ink outline-none placeholder:text-ink-3"
          />
        </label>
      </div>
      {shown.length ? (
        <ul className="m-0 list-none p-0">
          {shown.map((tx) => (
            <HistoryRow key={tx.txid} tx={tx} />
          ))}
        </ul>
      ) : (
        <p className="m-0 border-t border-rule px-4 py-6 text-ink-3">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
      )}
    </section>
  );
}

export function Home() {
  const snapshot = useWalletSnapshot();
  const session = useWalletSession();
  if (!snapshot) return <Opening title="Home" />;
  const fresh = !snapshot.transactions.length;
  return (
    <div className="grid content-start items-start gap-6 @min-[900px]/app:grid-cols-[360px_minmax(0,1fr)]">
      <h1 className="sr-only">Home</h1>
      {snapshot.reorg && (
        <div role="status" className="flex items-start gap-2 rounded-control bg-warn-tint px-3 py-2.5 text-sm text-warn @min-[900px]/app:col-span-2">
          <Icon name="warn" className="mt-px size-[18px]" />
          <p className="m-0 flex-1 text-ink">
            <b className="font-semibold text-warn">The chain reorganised.</b> The tip moved to a different block at height{" "}
            {groupSats(snapshot.reorg.height)}, so this wallet threw away what it had cached and synced again. Balances and
            confirmations below are current.
          </p>
          <button type="button" onClick={() => session?.dismissReorg()} aria-label="Dismiss" className="-m-1 grid size-8 flex-none place-items-center rounded-control hover:bg-[color-mix(in_srgb,var(--warn)_12%,transparent)]">
            <Icon name="close" />
          </button>
        </div>
      )}
      <div className="grid content-start gap-6">
        <Balance snapshot={snapshot} />
        <div className="hidden @min-[900px]/app:block">
          <SourcesKey snapshot={snapshot} />
        </div>
      </div>
      {fresh && snapshot.connection === "connected" && !snapshot.progress ? (
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
      <div className="@min-[900px]/app:hidden">
        <SourcesKey snapshot={snapshot} />
      </div>
    </div>
  );
}
