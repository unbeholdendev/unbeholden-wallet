import { useState } from "react";
import { navigate } from "../app/route";
import { useWalletSession, useWalletSnapshot } from "../app/session";
import { useVault } from "../app/vault";
import { feeRate, isOutgoing, txDirection, txWhen } from "../core/view";
import type { WalletSnapshot, WalletTx } from "../core/wallet";
import { Amount, btcParts, groupSats } from "../ui/amount";
import { confText, dateText, hostText, timeText, txFallback } from "../ui/format";
import { Icon } from "../ui/icons";
import { Button, Chip, Empty, LinkButton, linkClass, Segmented } from "../ui/kit";
import { Opening } from "./parts";
import { parseAmount } from "./send/Recipients";

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
    ...tx.outputs.flatMap((o) => (o.mine ? [o.label, o.mine.label] : [])),
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

const noFilters = { direction: "all", unconfirmed: false, from: "", to: "", min: "", max: "" };
const directions = [
  { value: "all", label: "All" },
  { value: "received", label: "Received" },
  { value: "sent", label: "Sent" },
  { value: "to self", label: "To self" },
];
const smallInput = "min-h-9 w-full rounded-control border border-rule-2 bg-sheet px-2.5 py-1.5 text-ink placeholder:text-ink-3 focus:outline-2 focus:-outline-offset-1 focus:outline-route";
const localDay = (seconds: number) => new Date(seconds * 1000).toLocaleDateString("en-CA");

function History({ snapshot }: { snapshot: WalletSnapshot }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState(noFilters);
  const set = (change: Partial<typeof noFilters>) => setFilters((f) => ({ ...f, ...change }));
  const active = Object.entries(filters).filter(([k, v]) => v !== noFilters[k as keyof typeof noFilters]).length;
  const min = parseAmount(filters.min);
  const max = parseAmount(filters.max);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = snapshot.transactions.filter((tx) => {
    const when = txWhen(tx);
    const day = when === null ? null : localDay(when);
    const abs = Math.abs(tx.net);
    if (filters.direction !== "all" && txDirection(tx) !== filters.direction) return false;
    if (filters.unconfirmed && tx.confirmations > 0) return false;
    if (filters.from && (day === null || day < filters.from)) return false;
    if (filters.to && (day === null || day > filters.to)) return false;
    if ((min !== null && abs < min) || (max !== null && abs > max)) return false;
    if (!terms.length) return true;
    const text = haystack(tx);
    return terms.every((t) => text.includes(t));
  });
  return (
    <section className="@container min-w-0 rounded-panel border border-rule bg-sheet">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 pb-3">
        <h2 className="text-md font-semibold">Transactions</h2>
        <div className="flex w-full gap-2 @min-[480px]:w-auto">
          <label className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-control border border-rule-2 bg-sheet px-2.5 text-ink-3 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-route @min-[480px]:w-64">
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
          <Button size="sm" aria-expanded={open} aria-controls="history-filters" onClick={() => setOpen(!open)} className={active ? "border-route text-route" : ""}>
            {active ? `Filters (${active})` : "Filters"}
          </Button>
        </div>
      </div>
      {open && (
        <div id="history-filters" className="grid gap-3 border-t border-rule bg-sunk px-4 py-3 text-sm text-ink-2 @min-[640px]:grid-cols-2">
          <Segmented label="Direction" options={directions} value={filters.direction} onChange={(direction) => set({ direction })} />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={filters.unconfirmed} onChange={(e) => set({ unconfirmed: e.target.checked })} className="size-4 accent-route" />
            Unconfirmed only
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              From
              <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className={smallInput} />
            </label>
            <label className="grid gap-1">
              To
              <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className={smallInput} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              At least
              <input inputMode="decimal" autoComplete="off" placeholder="BTC or sats" value={filters.min} onChange={(e) => set({ min: e.target.value })} aria-invalid={!!filters.min && min === null} className={`${smallInput} aria-invalid:border-bad`} />
            </label>
            <label className="grid gap-1">
              At most
              <input inputMode="decimal" autoComplete="off" placeholder="BTC or sats" value={filters.max} onChange={(e) => set({ max: e.target.value })} aria-invalid={!!filters.max && max === null} className={`${smallInput} aria-invalid:border-bad`} />
            </label>
          </div>
          {active > 0 && (
            <LinkButton className="justify-self-start text-sm" onClick={() => setFilters(noFilters)}>
              Clear filters
            </LinkButton>
          )}
        </div>
      )}
      {shown.length ? (
        <ul className="m-0 list-none p-0">
          {shown.map((tx) => (
            <HistoryRow key={tx.txid} tx={tx} />
          ))}
        </ul>
      ) : (
        <p className="m-0 border-t border-rule px-4 py-6 text-ink-3">
          {terms.length ? <>Nothing matches &ldquo;{query.trim()}&rdquo;{active ? " with these filters" : ""}.</> : "Nothing matches these filters."}
        </p>
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
      <Balance snapshot={snapshot} />
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
    </div>
  );
}
