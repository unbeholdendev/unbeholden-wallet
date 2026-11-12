import { type ReactNode, useEffect, useRef, useState } from "react";
import { Amount } from "../app/amount";
import { useConnection } from "../app/connection";
import { useNetwork, useOwners } from "../app/session";
import { RefusedError } from "../backend/backend";
import { AMOUNTS_PAGE, addressAmounts, type LookedUpAddress, lookupAddress } from "../core/lookup";
import { groupSats } from "../ui/amount";
import { dateText, shortId } from "../ui/format";
import { Button, Chip, CopyButton, linkClass } from "../ui/kit";
import { checkAddress } from "../wallet/parse";
import { Missing } from "./Lookup";
import { GroupedAddress } from "./parts";

type Found = { address: string } & ({ found: LookedUpAddress } | { refused: string } | { error: string });

const message = (error: unknown) => String((error as Error)?.message ?? error);

function List({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-panel border border-rule bg-sheet">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-3">
        <h2 className="text-md font-bold">{title}</h2>
        <span className="text-sm text-ink-3">{count}</span>
      </div>
      {children}
    </section>
  );
}

function Row({
  txid,
  vout,
  height,
  time,
  children,
}: {
  txid: string;
  vout?: number;
  height: number | null;
  time?: number | null;
  children: ReactNode;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-t border-rule px-4 py-3">
      <div className="grid min-w-0 gap-0.5">
        <a href={`#/tx/${txid}`} className={`${linkClass} justify-self-start font-mono text-xs`}>
          {shortId(txid)}
          {vout === undefined ? "" : `:${vout}`}
        </a>
        <span className="text-sm text-ink-3">
          {height === null ? "Waiting for a block" : `Block ${groupSats(height)}${time ? `, ${dateText(time)}` : ""}`}
        </span>
      </div>
      <span className="text-md">{children}</span>
    </li>
  );
}

/** Any address on the server, read fresh when opened and on each block, and kept nowhere. */
export function AddressLookup({ address: text }: { address: string | undefined }) {
  const { backend, connection } = useConnection();
  const live = connection.phase === "connected" ? backend : null;
  const tip = connection.phase === "connected" ? connection.tip : null;
  const network = useNetwork();
  const owners = useOwners();
  const checked = checkAddress(text ?? "", network);
  const address = "address" in checked ? checked.address : null;
  const [state, setState] = useState<Found | null>(null);
  const [amounts, setAmounts] = useState<{ address: string | null; byTxid: Map<string, number> }>({
    address: null,
    byTxid: new Map(),
  });
  const [more, setMore] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const shown = useRef(AMOUNTS_PAGE);
  const showing = useRef(address);
  showing.current = address;

  useEffect(() => {
    shown.current = AMOUNTS_PAGE;
    setMore({ loading: false, error: null });
  }, [address]);

  // A transaction's amount for an address never changes, so a refresh and a page that cross can both merge.
  const merge = (forAddress: string, page: Map<string, number>) =>
    setAmounts((now) => ({
      address: forAddress,
      byTxid: new Map([...(now.address === forAddress ? now.byTxid : []), ...page]),
    }));

  useEffect(() => {
    if (!live || !address) return;
    let cancelled = false;
    lookupAddress(live, address, network)
      .then(async (found) => ({
        found,
        page: await addressAmounts(
          live,
          found,
          found.history.slice(0, shown.current).map((entry) => entry.txid),
        ),
      }))
      .then(
        ({ found, page }) => {
          if (cancelled) return;
          merge(address, page);
          setState({ address, found });
        },
        (error) =>
          cancelled ||
          setState(
            error instanceof RefusedError ? { address, refused: error.message } : { address, error: message(error) },
          ),
      );
    return () => void (cancelled = true);
  }, [live, address, network, tip]);

  if (!address)
    return (
      <Missing title="That isn't an address" id={text}>
        <p className="m-0">{"error" in checked ? checked.error : null}</p>
      </Missing>
    );
  const current = state?.address === address ? state : null;
  if (!current)
    return live ? (
      <p className="m-0 text-ink-3">Looking the address up.</p>
    ) : (
      <Missing title="Not connected" id={address}>
        <p className="m-0">
          Looking an address up needs the server.{" "}
          <a href="#/connect" className={linkClass}>
            Connect to it
          </a>
          .
        </p>
      </Missing>
    );
  if ("refused" in current)
    return (
      <Missing title="The server won't list this address" id={address}>
        <p className="m-0">{current.refused}</p>
      </Missing>
    );
  if ("error" in current)
    return (
      <Missing title="The lookup failed" id={address}>
        <p className="m-0">{current.error}</p>
      </Missing>
    );

  const { found } = current;
  const loaded = amounts.address === address ? amounts.byTxid : new Map<string, number>();
  const owner = owners.get(address);
  const next = found.history
    .filter((entry) => !loaded.has(entry.txid))
    .slice(0, AMOUNTS_PAGE)
    .map((entry) => entry.txid);
  const loadMore = () => {
    if (!live) return;
    setMore({ loading: true, error: null });
    shown.current += AMOUNTS_PAGE;
    addressAmounts(live, found, next).then(
      (page) => {
        if (showing.current !== address) return;
        merge(address, page);
        setMore({ loading: false, error: null });
      },
      (error) => showing.current === address && setMore({ loading: false, error: message(error) }),
    );
  };
  const rows: [string, ReactNode][] = [
    ["Confirmed", <Amount sats={found.balance.confirmed} unit />],
    ["Unconfirmed", found.balance.unconfirmed ? <Amount sats={found.balance.unconfirmed} unit signed /> : "None"],
    ["Transactions", groupSats(found.history.length)],
    ["Unspent outputs", groupSats(found.unspent.length)],
  ];
  return (
    <div className="grid items-start gap-6 @min-[900px]/app:grid-cols-[minmax(0,1fr)_360px]">
      <section className="grid gap-4 rounded-panel border border-rule bg-sheet p-4 @min-[900px]/app:col-start-2 @min-[900px]/app:row-start-1">
        <div className="grid gap-1">
          <h1 className="m-0 text-lg font-bold">Address</h1>
          <span className="text-2xl font-medium tracking-[-0.01em]">
            <Amount sats={found.balance.confirmed + found.balance.unconfirmed} unit />
          </span>
          {owner !== undefined && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Chip tone="ok">{owner}</Chip>
            </div>
          )}
        </div>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
          {rows.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-ink-2">{name}</dt>
              <dd className="m-0 text-right tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="grid gap-1.5 border-t border-rule pt-3">
          <GroupedAddress address={address} className="text-[0.86em] break-all" />
          <span className="justify-self-start">
            <CopyButton text={address} what="Address" />
          </span>
        </div>
      </section>
      <div className="grid min-w-0 gap-6 @min-[900px]/app:col-start-1 @min-[900px]/app:row-start-1">
        <List title="History" count={found.history.length}>
          {found.history.length ? (
            <ul className="m-0 list-none p-0">
              {found.history.map(({ txid, height, time }) => {
                const amount = loaded.get(txid);
                return (
                  <Row key={txid} txid={txid} height={height} time={time}>
                    {amount === undefined ? (
                      <span className="text-sm text-ink-3">Not loaded</span>
                    ) : (
                      <Amount sats={amount} signed />
                    )}
                  </Row>
                );
              })}
            </ul>
          ) : (
            <p className="m-0 border-t border-rule px-4 py-6 text-ink-3">
              No transaction has paid or spent from this address.
            </p>
          )}
          {next.length > 0 && (
            <div className="grid justify-items-center gap-2 border-t border-rule px-4 py-3">
              <Button size="sm" onClick={loadMore} disabled={more.loading}>
                {more.loading ? "Loading amounts" : `Load ${next.length} more amounts`}
              </Button>
              {more.error && (
                <p role="alert" className="m-0 text-sm text-bad">
                  {more.error}
                </p>
              )}
            </div>
          )}
        </List>
        <List title="Unspent outputs" count={found.unspent.length}>
          {found.unspent.length > 0 && (
            <ul className="m-0 list-none p-0">
              {found.unspent.map(({ txid, vout, height, value }) => (
                <Row key={`${txid}:${vout}`} txid={txid} vout={vout} height={height}>
                  <Amount sats={value} />
                </Row>
              ))}
            </ul>
          )}
        </List>
      </div>
    </div>
  );
}
