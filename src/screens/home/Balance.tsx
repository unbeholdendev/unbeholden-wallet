import { Amount, UnitSwitch } from "../../app/amount";
import { FiatAmount, FiatControl } from "../../app/fiat";
import { useVault } from "../../app/vault";
import type { WalletSnapshot } from "../../core/wallet";
import { BalanceChart } from "./BalanceChart";
import { SyncLine } from "./SyncLine";

export function Balance({ snapshot }: { snapshot: WalletSnapshot }) {
  const { confirmed, unconfirmed, frozen, foreign } = snapshot.balance;
  const spendable = snapshot.balance.spendable + (useVault().settings.skipForeignUnconfirmed ? 0 : foreign);
  const waiting = confirmed + unconfirmed - spendable - frozen;
  return (
    <section aria-label="Balance" className="rounded-panel border border-rule bg-sheet">
      <div className="grid gap-1 px-4 pt-5 pb-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink-2">Spendable now</span>
          <UnitSwitch />
        </div>
        <span className="text-2xl font-medium tracking-[-0.01em] @max-[380px]/app:text-[34px]">
          <Amount sats={spendable} unit />
        </span>
        <FiatAmount sats={spendable} />
        <FiatControl />
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
        <BalanceChart snapshot={snapshot} />
      </div>
      <SyncLine snapshot={snapshot} />
    </section>
  );
}
