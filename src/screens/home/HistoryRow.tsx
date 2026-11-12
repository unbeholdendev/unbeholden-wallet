import { Amount } from "../../app/amount";
import { TxRowFiat } from "../../app/fiat";
import { navigate } from "../../app/route";
import { feeRate, isOutgoing, txWhen } from "../../core/history";
import type { WalletTx } from "../../core/wallet";
import { confText, dateText, timeText, txFallback } from "../../ui/format";
import { Button, Chip } from "../../ui/kit";
import { EditableLabel } from "../parts";

export function HistoryRow({ tx, owners }: { tx: WalletTx; owners: ReadonlyMap<string, string> }) {
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
      <span className="col-start-1 row-start-1 flex min-w-0 items-baseline gap-1.5 @min-[640px]:col-start-2 [&:has(input)>a]:hidden [&>input]:flex-1">
        <a
          href={`#/tx/${tx.txid}`}
          className={`min-w-0 truncate font-medium no-underline after:absolute after:inset-0 ${tx.label ? "text-ink" : "text-ink-2"}`}
        >
          {tx.label ?? txFallback(tx, owners)}
        </a>
        <EditableLabel
          type="tx"
          target={tx.txid}
          value={tx.label}
          placeholder="Label this transaction"
          className="relative z-[1] text-sm"
        >
          <span className="sr-only">{tx.label ?? "Label this transaction"}</span>
        </EditableLabel>
      </span>
      <span className="col-start-3 row-start-1 hidden text-right text-sm whitespace-nowrap text-ink-2 @min-[640px]:block">
        {pending ? <Chip tone="warn">Unconfirmed</Chip> : confText(tx.confirmations)}
      </span>
      <span className="col-start-2 row-start-1 text-right text-md @min-[640px]:col-start-4">
        <Amount sats={tx.net} signed />
        <TxRowFiat tx={tx} />
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
