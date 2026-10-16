import type { ReactNode } from "react";
import type { WalletCoin } from "../../core/wallet";
import { Amount, groupSats } from "../../ui/amount";
import { Icon } from "../../ui/icons";
import { Button, Chip } from "../../ui/kit";
import { SourceSwatch, TINT, type Source } from "../../ui/sources";
import { outpoint } from "../../wallet/coin";

/** Frozen coins and coins waiting on someone else's unconfirmed transaction cannot be chosen. */
export const selectable = (c: WalletCoin) => !c.frozen && c.status !== "unconfirmed-parents";

function age(coin: WalletCoin, tip: number | null) {
  if (coin.height === null || tip === null) return "unconfirmed";
  const days = Math.round((tip - coin.height + 1) / 144);
  if (days < 1) return "today";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / 30.4);
  return months < 24 ? `${months} months` : `${(months / 12).toFixed(1)} years`;
}

const confs = (coin: WalletCoin, tip: number | null) =>
  coin.height === null || tip === null ? "0 conf" : `${groupSats(tip - coin.height + 1)} conf`;

function chips(coin: WalletCoin): ReactNode {
  if (coin.frozen) return <Chip><Icon name="lock" className="size-3.5" />Frozen</Chip>;
  if (coin.status === "own-change") return <Chip tone="ok">Your change, unconfirmed</Chip>;
  if (coin.status === "foreign-unconfirmed") return <Chip tone="warn"><Icon name="warn" className="size-3.5" />Unconfirmed, from someone else</Chip>;
  if (coin.status === "unconfirmed-parents") return <Chip>Waits on an unconfirmed parent, cannot be spent yet</Chip>;
  return null;
}

const COLUMNS = "@min-[900px]:grid-cols-[22px_150px_92px_96px_minmax(0,1fr)]";

function CoinRow({ coin, tip, on, onToggle }: { coin: WalletCoin; tip: number | null; on: boolean; onToggle: () => void }) {
  const ok = selectable(coin);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-disabled={!ok}
      onClick={() => ok && onToggle()}
      className={`group grid min-h-14 w-full grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-t border-rule bg-sheet px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--route-tint)_45%,var(--sheet))] aria-checked:bg-route-tint aria-disabled:cursor-not-allowed aria-disabled:hover:bg-sheet @min-[900px]:items-center @min-[900px]:py-2.5 ${COLUMNS}`}
    >
      <span className="mt-px grid size-5 place-items-center rounded-check border-[1.5px] border-ink-3 bg-sheet text-route-ink group-aria-checked:border-route group-aria-checked:bg-route group-aria-disabled:border-dashed">
        {on && (
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-none stroke-current stroke-[2.4] [stroke-linecap:round] [stroke-linejoin:round]">
            <path d="M3 8.5l3 3 7-7" />
          </svg>
        )}
      </span>
      <span className="text-md font-medium group-aria-disabled:text-ink-3 @min-[900px]:text-right">
        <Amount sats={coin.value} />
      </span>
      <span className="text-right text-sm whitespace-nowrap text-ink-2 @max-[899px]:hidden">{age(coin, tip)}</span>
      <span className="text-right text-sm whitespace-nowrap text-ink-2 @max-[899px]:hidden">{confs(coin, tip)}</span>
      <span className="col-start-2 col-end-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-3 @min-[900px]:col-auto">
        <span className={`min-w-0 ${coin.label ? "text-ink group-aria-disabled:text-ink-3" : "truncate font-mono text-[0.86em]"}`}>{coin.label ?? coin.address}</span>
        <span className="whitespace-nowrap @min-[900px]:hidden">
          {age(coin, tip)} &middot; {confs(coin, tip)}
        </span>
        {chips(coin)}
      </span>
    </button>
  );
}

export function CoinList({
  sources,
  tip,
  selected,
  onToggle,
  onGroup,
  onPick,
  onClear,
  picking,
}: {
  sources: Source[];
  tip: number | null;
  selected: Set<string>;
  onToggle: (coin: WalletCoin) => void;
  onGroup: (source: Source) => void;
  onPick: () => void;
  onClear: () => void;
  picking: boolean;
}) {
  const all = sources.flatMap((s) => s.coins);
  const chosen = all.filter((c) => selected.has(outpoint(c)));
  return (
    <section aria-label="Coins" className="rounded-panel border border-rule bg-sheet">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
        <h2 className="mr-auto text-lg font-semibold">Coins</h2>
        <span className="order-3 basis-full text-sm text-ink-2 @min-[900px]:order-none @min-[900px]:basis-auto">
          {chosen.length} of {all.filter(selectable).length} selected &middot; <Amount sats={chosen.reduce((a, c) => a + c.value, 0)} />
        </span>
        <Button size="sm" onClick={onPick} disabled={picking}>
          Pick for me
        </Button>
        <Button size="sm" onClick={onClear} disabled={!chosen.length}>
          Clear
        </Button>
      </div>
      {!all.length && <p className="m-0 border-t border-rule px-4 py-6 text-ink-2">This wallet has no coins yet. Once a payment to it shows up, its coins appear here.</p>}
      <div aria-hidden="true" className={`hidden gap-3 border-t border-rule px-4 py-2 text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase @min-[900px]:grid ${COLUMNS}`}>
        <span />
        <span className="text-right">Value</span>
        <span className="text-right">Age</span>
        <span className="text-right">Confirmations</span>
        <span>Label</span>
      </div>
      {sources.map((source) => {
        const open = source.coins.filter((c) => selectable(c) && c.status !== "foreign-unconfirmed");
        const whole = open.length > 0 && open.every((c) => selected.has(outpoint(c)));
        return (
          <div key={source.id} role="group" aria-label={source.name} className="border-t border-rule-2">
            <div className={`sticky top-14 z-[1] grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-2.5 ${TINT[source.tone]}`}>
              <SourceSwatch source={source} />
              <div className="min-w-0">
                <span className="block truncate font-semibold">{source.name}</span>
                <small className="block text-xs text-ink-2">{source.note}</small>
              </div>
              <div className="grid justify-items-end text-sm text-ink-2">
                <span>
                  {source.coins.length} coin{source.coins.length > 1 ? "s" : ""}, <Amount sats={source.total} />
                </span>
                {open.length > 1 && (
                  <button type="button" onClick={() => onGroup(source)} className="text-xs font-medium text-route underline decoration-1 underline-offset-3">
                    {whole ? "Clear these" : "Select all"}
                  </button>
                )}
              </div>
            </div>
            {source.coins.map((coin) => (
              <CoinRow key={outpoint(coin)} coin={coin} tip={tip} on={selected.has(outpoint(coin))} onToggle={() => onToggle(coin)} />
            ))}
          </div>
        );
      })}
    </section>
  );
}
