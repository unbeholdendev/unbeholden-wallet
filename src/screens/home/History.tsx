import { useState } from "react";
import { useOwners } from "../../app/session";
import { useUnit } from "../../app/vault";
import { txDirection, txWhen } from "../../core/history";
import type { WalletSnapshot, WalletTx } from "../../core/wallet";
import { btcParts } from "../../ui/amount";
import { dateText, txFallback } from "../../ui/format";
import { Icon } from "../../ui/icons";
import { Button, LinkButton, Segmented } from "../../ui/kit";
import { parseAmount } from "../../wallet/parse";
import { HistoryRow } from "./HistoryRow";

function haystack(tx: WalletTx, owners: ReadonlyMap<string, string>) {
  const when = txWhen(tx);
  const abs = Math.abs(tx.net);
  const { lead, rest } = btcParts(abs);
  return [
    tx.label ?? txFallback(tx, owners),
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

const noFilters = { direction: "all", unconfirmed: false, from: "", to: "", min: "", max: "" };
const directions = [
  { value: "all", label: "All" },
  { value: "received", label: "Received" },
  { value: "sent", label: "Sent" },
  { value: "to self", label: "To self" },
];
const smallInput =
  "min-h-9 w-full rounded-control border border-rule-2 bg-sheet px-2.5 py-1.5 text-ink placeholder:text-ink-3 focus:outline-2 focus:-outline-offset-1 focus:outline-carbon";
const localDay = (seconds: number) => new Date(seconds * 1000).toLocaleDateString("en-CA");

export function History({ snapshot }: { snapshot: WalletSnapshot }) {
  const owners = useOwners();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState(noFilters);
  const [limit, setLimit] = useState(25);
  const inSats = useUnit() === "sats";
  const amount = (text: string) => parseAmount(inSats ? `${text}sats` : text);
  const set = (change: Partial<typeof noFilters>) => {
    setFilters((f) => ({ ...f, ...change }));
    setLimit(25);
  };
  const active = Object.entries(filters).filter(([k, v]) => v !== noFilters[k as keyof typeof noFilters]).length;
  const min = amount(filters.min);
  const max = amount(filters.max);
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
    const text = haystack(tx, owners);
    return terms.every((t) => text.includes(t));
  });
  return (
    <section className="@container min-w-0 rounded-panel border border-rule bg-sheet">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 pb-3">
        <h2 className="text-md font-bold">Transactions</h2>
        <div className="flex w-full gap-2 @min-[480px]:w-auto">
          <label className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-control border border-rule-2 bg-sheet px-2.5 text-ink-3 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-carbon @min-[480px]:w-64">
            <Icon name="search" className="size-4" />
            <span className="sr-only">Search transactions</span>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(25);
              }}
              placeholder="Label, amount or date"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-ink outline-none placeholder:text-ink-3"
            />
          </label>
          <Button
            size="sm"
            aria-expanded={open}
            aria-controls="history-filters"
            onClick={() => setOpen(!open)}
            className={active ? "border-carbon text-carbon" : ""}
          >
            {active ? `Filters (${active})` : "Filters"}
          </Button>
        </div>
      </div>
      {open && (
        <div
          id="history-filters"
          className="grid gap-3 border-t border-rule bg-sunk px-4 py-3 text-sm text-ink-2 @min-[640px]:grid-cols-2"
        >
          <Segmented
            label="Direction"
            options={directions}
            value={filters.direction}
            onChange={(direction) => set({ direction })}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={filters.unconfirmed}
              onChange={(e) => set({ unconfirmed: e.target.checked })}
              className="size-4 accent-carbon"
            />
            Unconfirmed only
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              From
              <input
                type="date"
                value={filters.from}
                onChange={(e) => set({ from: e.target.value })}
                className={smallInput}
              />
            </label>
            <label className="grid gap-1">
              To
              <input
                type="date"
                value={filters.to}
                onChange={(e) => set({ to: e.target.value })}
                className={smallInput}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              At least
              <input
                inputMode={inSats ? "numeric" : "decimal"}
                autoComplete="off"
                placeholder={inSats ? "sats" : "BTC"}
                value={filters.min}
                onChange={(e) => set({ min: e.target.value })}
                aria-invalid={!!filters.min && min === null}
                className={`${smallInput} aria-invalid:border-bad`}
              />
            </label>
            <label className="grid gap-1">
              At most
              <input
                inputMode={inSats ? "numeric" : "decimal"}
                autoComplete="off"
                placeholder={inSats ? "sats" : "BTC"}
                value={filters.max}
                onChange={(e) => set({ max: e.target.value })}
                aria-invalid={!!filters.max && max === null}
                className={`${smallInput} aria-invalid:border-bad`}
              />
            </label>
          </div>
          {active > 0 && (
            <LinkButton className="justify-self-start text-sm" onClick={() => set(noFilters)}>
              Clear filters
            </LinkButton>
          )}
        </div>
      )}
      {shown.length ? (
        <ul className="m-0 list-none p-0">
          {shown.slice(0, limit).map((tx) => (
            <HistoryRow key={tx.txid} tx={tx} owners={owners} />
          ))}
        </ul>
      ) : (
        <p className="m-0 border-t border-rule px-4 py-6 text-ink-3">
          {terms.length ? (
            <>
              Nothing matches &ldquo;{query.trim()}&rdquo;{active ? " with these filters" : ""}.
            </>
          ) : (
            "Nothing matches these filters."
          )}
        </p>
      )}
      {shown.length > limit && (
        <div className="flex justify-center border-t border-rule px-4 py-3">
          <Button size="sm" onClick={() => setLimit((n) => n + 25)}>
            Show more
          </Button>
        </div>
      )}
    </section>
  );
}
