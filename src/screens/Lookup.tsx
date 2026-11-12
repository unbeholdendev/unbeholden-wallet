import { type ReactNode, useEffect, useState } from "react";
import { useConnection } from "../app/connection";
import { useNetwork, useOwners } from "../app/session";
import { type DecodedTx, type LookedUpTx, lookupTransaction } from "../core/lookup";
import { COINBASE, feeRate } from "../core/view";
import { Amount, groupSats } from "../ui/amount";
import { confText, satsText, shortId } from "../ui/format";
import { Chip, Empty, linkClass } from "../ui/kit";
import { CopyButton, GroupedAddress } from "./parts";

type Found = { txid: string } & ({ tx: LookedUpTx } | { tx: null } | { error: string });

function Endpoint({
  value,
  address,
  owner,
  children,
}: {
  value: number | null;
  address: string | null;
  owner: string | undefined;
  children?: ReactNode;
}) {
  return (
    <li
      className={`grid gap-1 border-t border-rule px-4 py-3 ${owner ? "bg-[color-mix(in_srgb,var(--ok-tint)_35%,var(--sheet))]" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        {address ? (
          <GroupedAddress address={address} className="text-[0.86em] text-ink-2" />
        ) : (
          <span className="text-sm text-ink-3">Script with no address</span>
        )}
        <span className="text-md">
          {value === null ? <span className="text-sm text-ink-3">Amount unknown</span> : <Amount sats={value} />}
        </span>
      </div>
      {owner !== undefined && (
        <span className="justify-self-start">
          <Chip tone="ok">{owner}</Chip>
        </span>
      )}
      {children}
    </li>
  );
}

function Endpoints({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-panel border border-rule bg-sheet">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-3">
        <h2 className="text-md font-bold">{title}</h2>
        <span className="text-sm text-ink-3">{count}</span>
      </div>
      <ul className="m-0 list-none p-0">{children}</ul>
    </section>
  );
}

export function Missing({ title, id, children }: { title: string; id: string | undefined; children: ReactNode }) {
  return (
    <Empty title={title}>
      {children}
      {id && <p className="m-0 mt-2 font-mono text-[0.86em] break-all text-ink-3">{id}</p>}
    </Empty>
  );
}

/** Any transaction on the server, read fresh when opened and on each block, and kept nowhere. */
export function Lookup({ txid }: { txid: string | undefined }) {
  const { backend, connection } = useConnection();
  const live = connection.phase === "connected" ? backend : null;
  const tip = connection.phase === "connected" ? connection.tip : null;
  const network = useNetwork();
  const valid = !!txid && /^[0-9a-f]{64}$/.test(txid);
  const [found, setFound] = useState<Found | null>(null);

  useEffect(() => {
    if (!live || !valid) return;
    let cancelled = false;
    lookupTransaction(live, txid, network).then(
      (tx) => cancelled || setFound({ txid, tx }),
      (error) => cancelled || setFound({ txid, error: String((error as Error)?.message ?? error) }),
    );
    return () => void (cancelled = true);
  }, [live, txid, network, tip]);

  if (!valid)
    return (
      <Missing title="That isn't a transaction ID" id={txid}>
        <p className="m-0">A transaction ID is 64 characters of 0 to 9 and a to f.</p>
      </Missing>
    );
  const current = found?.txid === txid ? found : null;
  if (!current)
    return live ? (
      <p className="m-0 text-ink-3">Looking the transaction up.</p>
    ) : (
      <Missing title="Not connected" id={txid}>
        <p className="m-0">
          Looking a transaction up needs the server.{" "}
          <a href="#/connect" className={linkClass}>
            Connect to it
          </a>
          .
        </p>
      </Missing>
    );
  if ("error" in current)
    return (
      <Missing title="The lookup failed" id={txid}>
        <p className="m-0">{current.error}</p>
      </Missing>
    );
  const { tx } = current;
  if (!tx)
    return (
      <Missing title="No transaction with this ID" id={txid}>
        <p className="m-0">
          The server has none in a block or its mempool. Blocks can't be looked up by their hash: search by height
          instead.
        </p>
      </Missing>
    );

  const confirmations = tx.height !== null && tip !== null ? tip - tx.height + 1 : 0;
  return (
    <TxDetails
      tx={tx}
      title="Transaction"
      chip={
        tx.height === null ? (
          <Chip tone="warn">Unconfirmed</Chip>
        ) : (
          <Chip tone="ok">{confirmations ? confText(confirmations) : "Confirmed"}</Chip>
        )
      }
      rows={[
        ["Status", tx.height === null ? "Waiting for a block" : confirmations ? confText(confirmations) : "In a block"],
        [
          "Block",
          tx.height === null ? (
            "None yet"
          ) : (
            <a href={`#/block/${tx.height}`} className={linkClass}>
              {groupSats(tx.height)}
            </a>
          ),
        ],
      ]}
    />
  );
}

/** A transaction's inputs, outputs and fee, with `rows` and `children` for what is known of it beyond its bytes. */
export function TxDetails({
  tx,
  title,
  chip,
  rows,
  children,
}: {
  tx: DecodedTx;
  title: string;
  chip: ReactNode;
  rows: [string, ReactNode][];
  children?: ReactNode;
}) {
  const owners = useOwners();
  const rate = feeRate(tx);
  const coinbase = tx.inputs[0]?.txid === COINBASE;
  const facts: [string, ReactNode][] = [
    ...rows,
    ["Fee", tx.fee === null ? (coinbase ? "None, it mints new coins" : "Unknown") : satsText(tx.fee)],
    ["Size", `${groupSats(tx.vsize)} vB`],
    ["Fee rate", rate === null ? "Unknown" : `${rate} sat/vB`],
    ["Replaceable", tx.rbf ? "Signals RBF" : "Doesn't signal RBF"],
  ];
  return (
    <div className="grid items-start gap-6 @min-[900px]/app:grid-cols-[minmax(0,1fr)_360px]">
      <section className="grid gap-4 rounded-panel border border-rule bg-sheet p-4 @min-[900px]/app:col-start-2 @min-[900px]/app:row-start-1">
        <div className="grid gap-1">
          <h1 className="m-0 text-lg font-bold">{title}</h1>
          <span className="text-2xl font-medium tracking-[-0.01em]">
            <Amount sats={tx.outputs.reduce((total, o) => total + o.value, 0)} unit />
          </span>
          <div className="flex flex-wrap gap-1.5 pt-1">{chip}</div>
        </div>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
          {facts.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-ink-2">{name}</dt>
              <dd className="m-0 text-right tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="grid gap-1.5 border-t border-rule pt-3">
          <span className="text-sm text-ink-2">Transaction ID</span>
          <span className="font-mono text-[0.86em] break-all select-all">{tx.txid}</span>
          <span className="justify-self-start">
            <CopyButton text={tx.txid} what="Transaction ID" />
          </span>
        </div>
        {children}
      </section>
      <div className="grid min-w-0 gap-6 @min-[900px]/app:col-start-1 @min-[900px]/app:row-start-1">
        <Endpoints title="Inputs" count={tx.inputs.length}>
          {coinbase ? (
            <li className="border-t border-rule px-4 py-3 text-sm text-ink-2">New coins from mining</li>
          ) : (
            tx.inputs.map((input) => (
              <Endpoint
                key={`${input.txid}:${input.vout}`}
                value={input.value}
                address={input.address}
                owner={input.address ? owners.get(input.address) : undefined}
              >
                <a href={`#/tx/${input.txid}`} className={`${linkClass} justify-self-start font-mono text-xs`}>
                  From {shortId(input.txid)}:{input.vout}
                </a>
              </Endpoint>
            ))
          )}
        </Endpoints>
        <Endpoints title="Outputs" count={tx.outputs.length}>
          {tx.outputs.map((output) => (
            <Endpoint
              key={output.vout}
              value={output.value}
              address={output.address}
              owner={output.address ? owners.get(output.address) : undefined}
            />
          ))}
        </Endpoints>
      </div>
    </div>
  );
}
