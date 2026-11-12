import { Amount } from "../../app/amount";
import { FiatAmount } from "../../app/fiat";
import { useWallet } from "../../app/session";
import { isOutgoing, txWhen } from "../../core/history";
import type { WalletSnapshot } from "../../core/wallet";
import { groupSats } from "../../ui/amount";
import { dateText } from "../../ui/format";
import { Panel } from "../../ui/kit";
import { BUSY_RATE } from "../../wallet/fees";
import { spend, spendCost } from "../../wallet/select";

/** Worked out from the cached history alone: what sending has cost, and the coins held. */
export function Stats({ snapshot }: { snapshot: WalletSnapshot }) {
  const { kind } = useWallet();
  const sends = snapshot.transactions.filter(isOutgoing);
  const fees = sends.reduce((a, t) => a + (t.fee ?? 0), 0);
  const when = new Map(snapshot.transactions.map((t) => [t.txid, txWhen(t)]));
  const { coins } = snapshot;
  const oldest = Math.min(...coins.flatMap((c) => when.get(c.txid) ?? []));
  const sweep = coins.length
    ? spend(coins, { recipients: [{ script: coins[0]!.script, value: "max" }], feeRate: BUSY_RATE, ...kind }).fee
    : 0;
  const uneconomic = coins.filter((c) => spendCost(kind, BUSY_RATE) >= c.value).length;
  return (
    <Panel title="Statistics">
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-ink-2">Fees paid, {sends.length === 1 ? "1 send" : `${sends.length} sends`}</dt>
        <dd className="m-0 text-right tabular-nums">
          <Amount sats={fees} />
          <FiatAmount sats={fees} brief />
        </dd>
        <dt className="text-ink-2">Coins held</dt>
        <dd className="m-0 text-right tabular-nums">{groupSats(coins.length)}</dd>
        {coins.length > 0 && (
          <>
            <dt className="text-ink-2">To spend every coin at {BUSY_RATE} sat/vB</dt>
            <dd className="m-0 text-right tabular-nums">
              <Amount sats={sweep} />
              <FiatAmount sats={sweep} brief />
            </dd>
          </>
        )}
        {uneconomic > 0 && (
          <>
            <dt className="text-ink-2">Uneconomic at {BUSY_RATE} sat/vB</dt>
            <dd className="m-0 text-right tabular-nums">
              {uneconomic === 1 ? "1 coin" : `${groupSats(uneconomic)} coins`}
            </dd>
          </>
        )}
        {oldest !== Infinity && (
          <>
            <dt className="text-ink-2">Oldest coin</dt>
            <dd className="m-0 text-right tabular-nums">{dateText(oldest)}</dd>
          </>
        )}
      </dl>
    </Panel>
  );
}
