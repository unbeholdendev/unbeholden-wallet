import type { WalletCoin } from "../../core/wallet";
import { Amount, btcParts } from "../../ui/amount";
import { Icon, type IconName } from "../../ui/icons";
import { Button, Chip } from "../../ui/kit";
import { SourceSwatch, TINT, type Source } from "../../ui/sources";
import { outpoint } from "../../wallet/coin";
import { SourceTitle } from "../parts";

/** Frozen coins and coins waiting on someone else's unconfirmed transaction cannot be chosen. */
export const selectable = (c: WalletCoin) => !c.frozen && c.status !== "unconfirmed-parents";

function age(coin: WalletCoin, tip: number | null) {
  if (coin.height === null || tip === null) return "unconfirmed";
  const confs = tip - coin.height + 1;
  if (confs < 6) return `${confs} conf`;
  const days = Math.round(confs / 144);
  if (days < 1) return "today";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / 30.4);
  return months < 24 ? `${months} months` : `${(months / 12).toFixed(1)} years`;
}

function status(coin: WalletCoin): { text: string; tone?: "ok" | "warn"; icon?: IconName } | null {
  if (coin.frozen) return { text: "Frozen", icon: "lock" };
  if (coin.status === "own-change") return { text: "Your change, unconfirmed", tone: "ok" };
  if (coin.status === "foreign-unconfirmed") return { text: "Unconfirmed, from someone else", tone: "warn", icon: "warn" };
  if (coin.status === "unconfirmed-parents") return { text: "Waits on an unconfirmed parent, cannot be spent yet" };
  return null;
}

const COLUMNS = "@min-[900px]:grid-cols-[22px_150px_92px_minmax(0,1fr)]";

/** One coin; given its source, the coin stands for the whole of a one-coin source. */
function CoinRow({ coin, source, tip, on, onToggle }: { coin: WalletCoin; source?: Source; tip: number | null; on: boolean; onToggle: () => void }) {
  const ok = selectable(coin);
  const s = status(coin);
  const { lead, rest } = btcParts(coin.value);
  const when = age(coin, tip);
  return (
    <div
      data-on={on || undefined}
      data-off={!ok || undefined}
      className={`group relative grid min-h-14 w-full grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-t px-4 py-3 transition-colors @min-[900px]:items-center @min-[900px]:py-2.5 ${COLUMNS} ${source ? `border-rule-2 data-on:shadow-[inset_4px_0_0_var(--route)] ${TINT[source.tone]}` : "border-rule bg-sheet hover:bg-[color-mix(in_srgb,var(--route-tint)_45%,var(--sheet))] data-on:bg-route-tint data-off:hover:bg-sheet"}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-disabled={!ok}
        aria-label={[`${lead}${rest} BTC`, source?.name ?? coin.label ?? coin.address, when, s?.text].filter(Boolean).join(", ")}
        onClick={() => ok && onToggle()}
        className="mt-px grid size-5 place-items-center rounded-check border-[1.5px] border-ink-3 bg-sheet text-route-ink after:absolute after:inset-0 aria-checked:border-route aria-checked:bg-route aria-disabled:cursor-not-allowed aria-disabled:border-dashed aria-disabled:after:cursor-not-allowed"
      >
        {on && (
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-none stroke-current stroke-[2.4] [stroke-linecap:round] [stroke-linejoin:round]">
            <path d="M3 8.5l3 3 7-7" />
          </svg>
        )}
      </button>
      <span className="text-md font-medium group-data-off:text-ink-3 @min-[900px]:text-right">
        <Amount sats={coin.value} />
      </span>
      <span className="text-right text-sm whitespace-nowrap text-ink-2 @max-[899px]:hidden">{when}</span>
      <span className="col-start-2 col-end-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-3 @min-[900px]:col-auto">
        {source ? (
          <span className="flex min-w-0 items-center gap-2.5 text-base text-ink">
            <SourceSwatch source={source} />
            <SourceTitle source={source} />
          </span>
        ) : (
          <span className={`min-w-0 ${coin.label ? "text-ink group-data-off:text-ink-3" : "truncate font-mono text-[0.86em]"}`}>{coin.label ?? coin.address}</span>
        )}
        <span className="whitespace-nowrap @min-[900px]:hidden">{when}</span>
        {s && (
          <Chip tone={s.tone}>
            {s.icon && <Icon name={s.icon} className="size-3.5" />}
            {s.text}
          </Chip>
        )}
      </span>
    </div>
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
        <span>Label</span>
      </div>
      {sources.map((source) => {
        if (source.coins.length === 1) {
          const coin = source.coins[0]!;
          return <CoinRow key={source.id} coin={coin} source={source} tip={tip} on={selected.has(outpoint(coin))} onToggle={() => onToggle(coin)} />;
        }
        const open = source.coins.filter((c) => selectable(c) && c.status !== "foreign-unconfirmed");
        const whole = open.length > 0 && open.every((c) => selected.has(outpoint(c)));
        return (
          <div key={source.id} role="group" aria-label={source.name} className="border-t border-rule-2">
            <div className={`sticky top-14 z-[2] grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-2.5 ${TINT[source.tone]}`}>
              <SourceSwatch source={source} />
              <SourceTitle source={source} />
              <div className="grid justify-items-end text-sm text-ink-2">
                <span>
                  {source.coins.length} coins, <Amount sats={source.total} />
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
