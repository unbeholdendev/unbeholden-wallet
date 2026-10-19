import type { ReactNode } from "react";
import { navigate } from "../app/route";
import { useWalletSnapshot } from "../app/session";
import { feeRate, isOutgoing, txWhen, type AddressInfo, type TxInput, type TxOutput, type WalletTx } from "../core/view";
import { Amount, groupSats } from "../ui/amount";
import { confText, dateText, satsText, shortId, timeText, txFallback } from "../ui/format";
import { Icon } from "../ui/icons";
import { Button, Chip, Empty, linkClass } from "../ui/kit";
import { CopyButton, EditableLabel, GroupedAddress, Opening } from "./parts";

function Back() {
  return (
    <a href="#/home" className={`${linkClass} inline-flex items-center gap-1 justify-self-start text-sm`}>
      <Icon name="chev" className="size-4 rotate-90" />
      History
    </a>
  );
}

function Mine({ info }: { info: AddressInfo }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Chip tone="ok">{info.chain === 1 ? "Your change" : "Yours"}</Chip>
      <span className="font-mono text-xs text-ink-3">{info.path}</span>
    </span>
  );
}

function Endpoint({ value, address, mine, children }: { value: number | null; address: string | null; mine: AddressInfo | null; children?: ReactNode }) {
  return (
    <li className={`grid gap-1 border-t border-rule px-4 py-3 ${mine ? "bg-[color-mix(in_srgb,var(--ok-tint)_35%,var(--sheet))]" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        {address ? <GroupedAddress address={address} className="text-[0.86em] text-ink-2" /> : <span className="text-sm text-ink-3">Script with no address</span>}
        <span className="text-md">{value === null ? <span className="text-sm text-ink-3">Amount unknown</span> : <Amount sats={value} />}</span>
      </div>
      {mine && <Mine info={mine} />}
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

const coinbase = (input: TxInput) => /^0+$/.test(input.txid);

function Facts({ tx }: { tx: WalletTx }) {
  const rate = feeRate(tx);
  const when = txWhen(tx);
  const rows: [string, ReactNode][] = [
    ["Status", tx.confirmations ? `${confText(tx.confirmations)}${tx.confirmations >= 6 ? `, ${groupSats(tx.confirmations)} blocks deep` : ""}` : "Waiting for a block"],
    ["Block", tx.height === null ? "None yet" : groupSats(tx.height)],
    [tx.time === null ? "First seen" : "Block time", when === null ? "Unknown" : `${dateText(when)}, ${timeText(when)}`],
    ["Fee", tx.fee === null ? "Unknown, an input's amount is not known" : satsText(tx.fee)],
    ["Size", `${groupSats(tx.vsize)} vB`],
    ["Fee rate", rate === null ? "Unknown" : `${rate} sat/vB`],
  ];
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
      {rows.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-ink-2">{name}</dt>
          <dd className="m-0 text-right tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Transaction({ txid }: { txid: string | undefined }) {
  const snapshot = useWalletSnapshot();
  if (!snapshot) return <Opening title="Transaction" />;
  const tx = snapshot.transactions.find((t) => t.txid === txid);
  if (!tx)
    return (
      <div className="grid content-start gap-4">
        <Back />
        <Empty title="This wallet has no such transaction">
          <p className="m-0">It may belong to another wallet, or a reorganisation removed it.</p>
          {txid && <p className="m-0 mt-2 font-mono text-[0.86em] break-all text-ink-3">{txid}</p>}
        </Empty>
      </div>
    );

  const outgoing = isOutgoing(tx);
  const pending = tx.confirmations === 0;
  const paysUs = snapshot.coins.some((c) => c.txid === tx.txid && !c.frozen);
  return (
    <div className="grid content-start gap-6">
      <Back />
      <div className="grid items-start gap-6 @min-[900px]/app:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid gap-4 rounded-panel border border-rule bg-sheet p-4 @min-[900px]/app:col-start-2 @min-[900px]/app:row-start-1">
          <div className="grid gap-1">
            <h1 className="m-0 text-lg font-bold">
              <EditableLabel type="tx" target={tx.txid} value={tx.label} placeholder={`${txFallback(tx)}, add a label`} />
            </h1>
            <span className="text-2xl font-medium tracking-[-0.01em]">
              <Amount sats={tx.net} signed unit />
            </span>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {pending && !outgoing && <Chip tone="warn">From someone else, can still be replaced</Chip>}
              {pending && outgoing && <Chip tone="warn">Unconfirmed</Chip>}
              {!pending && <Chip tone="ok">{confText(tx.confirmations)}</Chip>}
            </div>
          </div>
          {pending && (outgoing || paysUs) && (
            <div className="grid gap-2 rounded-control bg-sunk p-3 text-sm text-ink-2">
              <p className="m-0">
                {outgoing
                  ? "Not in a block yet. If it is stuck, you can replace it with a higher fee, or cancel it before it confirms."
                  : "Not in a block yet. If it is stuck, you can spend what it pays you in a child transaction with a fee high enough for both."}
              </p>
              <div className="flex flex-wrap gap-2">
                {outgoing && (
                  <>
                    <Button variant="primary" onClick={() => navigate(`/bump/${tx.txid}`)}>
                      Speed up
                    </Button>
                    <Button onClick={() => navigate(`/cancel/${tx.txid}`)}>Cancel transaction</Button>
                  </>
                )}
                {paysUs && (
                  <Button variant={outgoing ? undefined : "primary"} onClick={() => navigate(`/cpfp/${tx.txid}`)}>
                    Speed up with a child
                  </Button>
                )}
              </div>
            </div>
          )}
          <Facts tx={tx} />
          <div className="grid gap-1.5 border-t border-rule pt-3">
            <span className="text-sm text-ink-2">Transaction ID</span>
            <span className="font-mono text-[0.86em] break-all select-all">{tx.txid}</span>
            <span className="justify-self-start">
              <CopyButton text={tx.txid} what="Transaction ID" />
            </span>
          </div>
        </section>
        <div className="grid min-w-0 gap-6 @min-[900px]/app:col-start-1 @min-[900px]/app:row-start-1">
          <Endpoints title="Inputs" count={tx.inputs.length}>
            {tx.inputs.map((input: TxInput) =>
              coinbase(input) ? (
                <li key="coinbase" className="border-t border-rule px-4 py-3 text-sm text-ink-2">
                  New coins from mining
                </li>
              ) : (
                <Endpoint key={`${input.txid}:${input.vout}`} {...input}>
                  {input.mine ? (
                    <a href={`#/tx/${input.txid}`} className={`${linkClass} justify-self-start font-mono text-xs`}>
                      From {shortId(input.txid)}:{input.vout}
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-ink-3">
                      From {shortId(input.txid)}:{input.vout}
                    </span>
                  )}
                </Endpoint>
              ),
            )}
          </Endpoints>
          <Endpoints title="Outputs" count={tx.outputs.length}>
            {tx.outputs.map((output: TxOutput) => (
              <Endpoint key={output.vout} {...output}>
                <EditableLabel type="output" target={`${tx.txid}:${output.vout}`} value={output.label} placeholder={output.mine ? "Label this coin" : "Label this payment"} className="text-sm" />
              </Endpoint>
            ))}
          </Endpoints>
        </div>
      </div>
    </div>
  );
}
