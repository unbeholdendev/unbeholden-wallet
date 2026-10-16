import { useWalletSession, useWalletSnapshot } from "../app/session";
import type { WalletCoin, WalletSnapshot, WalletTx } from "../core/wallet";
import { Amount, btcParts } from "../ui/amount";
import { ageText, confText, shortId } from "../ui/format";
import { Icon } from "../ui/icons";
import { Button, Chip, Empty, linkClass } from "../ui/kit";
import { SourceSwatch, sourcesOf, TINT, type Source } from "../ui/sources";
import { EditableLabel, Opening } from "./parts";

const statusChip = {
  confirmed: null,
  "own-change": <Chip tone="ok">Your change, unconfirmed</Chip>,
  "foreign-unconfirmed": (
    <Chip tone="warn">
      <Icon name="warn" className="size-3.5" />
      Unconfirmed, from someone else
    </Chip>
  ),
  "unconfirmed-parents": <Chip tone="bad">Waits on an unconfirmed payment, not spendable yet</Chip>,
};

const sum = (coins: WalletCoin[]) => coins.reduce((a, c) => a + c.value, 0);

const lookups = new WeakMap<WalletSnapshot, { tx: Map<string, WalletTx>; path: Map<string, string> }>();

function lookup(snapshot: WalletSnapshot) {
  let found = lookups.get(snapshot);
  if (!found) {
    const { receive, change } = snapshot.addresses;
    found = {
      tx: new Map(snapshot.transactions.map((t) => [t.txid, t])),
      path: new Map([...receive, ...change].map((a) => [a.address, a.path])),
    };
    lookups.set(snapshot, found);
  }
  return found;
}

function CoinRow({ coin, snapshot }: { coin: WalletCoin; snapshot: WalletSnapshot }) {
  const session = useWalletSession();
  const tx = lookup(snapshot).tx.get(coin.txid);
  const confirmations = tx?.confirmations ?? 0;
  const age = tx?.time && snapshot.tip ? ageText(snapshot.tip.time - tx.time) : null;
  const path = lookup(snapshot).path.get(coin.address);
  const { lead, rest } = btcParts(coin.value);
  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-t border-rule px-4 py-3 @min-[720px]:grid-cols-[140px_84px_84px_minmax(0,1fr)_auto] @min-[720px]:items-center ${coin.frozen ? "bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_srgb,var(--rule)_45%,transparent)_6px_7px)]" : "bg-sheet"}`}
    >
      <a href={`#/tx/${coin.txid}`} className={`text-md font-medium no-underline hover:underline @min-[720px]:text-right ${coin.frozen ? "opacity-60" : "text-ink"}`}>
        <Amount sats={coin.value} />
      </a>
      <span className="hidden text-right text-sm text-ink-2 @min-[720px]:block">{age}</span>
      <span className="hidden text-right text-sm text-ink-2 @min-[720px]:block">{confText(confirmations)}</span>
      <div className="col-span-2 row-start-2 grid min-w-0 gap-1 @min-[720px]:col-span-1 @min-[720px]:col-start-4 @min-[720px]:row-start-1">
        <EditableLabel type="output" target={`${coin.txid}:${coin.vout}`} value={coin.label} placeholder="Label this coin" className="text-sm" />
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
          <span className="@min-[720px]:hidden">
            {age ? `${age} · ${confText(confirmations).toLowerCase()}` : "unconfirmed"}
          </span>
          <span className="font-mono">{shortId(coin.address, 10, 6)}</span>
          {path && <span className="font-mono">{path}</span>}
        </span>
        {(coin.frozen || statusChip[coin.status]) && (
          <span className="flex flex-wrap gap-1.5">
            {coin.frozen && (
              <Chip>
                <Icon name="lock" className="size-3.5" />
                Frozen, never spent automatically
              </Chip>
            )}
            {statusChip[coin.status]}
          </span>
        )}
      </div>
      <Button
        size="sm"
        icon={coin.frozen ? "unlock" : "lock"}
        aria-label={`${coin.frozen ? "Unfreeze" : "Freeze"} ${lead}${rest} BTC`}
        className="col-start-2 row-start-1 @min-[720px]:col-start-5"
        onClick={() => session?.setFrozen(coin, !coin.frozen)}
      >
        {coin.frozen ? "Unfreeze" : "Freeze"}
      </Button>
    </li>
  );
}

function Group({ source, snapshot }: { source: Source; snapshot: WalletSnapshot }) {
  return (
    <li className="border-t border-rule-2 first:border-t-0">
      <div className={`grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-2.5 ${TINT[source.tone]}`}>
        <SourceSwatch source={source} />
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{source.name}</h3>
          <p className="m-0 text-xs text-ink-2">{source.note}</p>
        </div>
        <span className="text-right text-sm text-ink-2">
          {source.coins.length === 1 ? "1 coin" : `${source.coins.length} coins`}
          <br />
          <Amount sats={source.total} />
        </span>
      </div>
      <ul className="m-0 list-none p-0">
        {source.coins.map((c) => (
          <CoinRow key={`${c.txid}:${c.vout}`} coin={c} snapshot={snapshot} />
        ))}
      </ul>
    </li>
  );
}

export function Coins() {
  const snapshot = useWalletSnapshot();
  if (!snapshot) return <Opening title="Coins" />;
  const { coins, balance } = snapshot;
  const waiting = sum(coins.filter((c) => !c.frozen && (c.status === "foreign-unconfirmed" || c.status === "unconfirmed-parents")));
  const totals: [string, number][] = [
    ["Spendable now", balance.spendable],
    ["Frozen", balance.frozen],
    ["Not spendable yet", waiting],
  ];
  return (
    <div className="grid content-start gap-6">
      <div className="grid gap-2">
        <h1 className="m-0 text-xl font-semibold">Coins</h1>
        <p className="m-0 max-w-[64ch] text-ink-2">
          Every coin this wallet holds, grouped by source. Coins in one source are already linked on-chain; spending
          from two sources together links them for good. A frozen coin is left out of the spendable balance and never
          picked automatically.
        </p>
      </div>
      {coins.length ? (
        <section className="@container rounded-panel border border-rule bg-sheet">
          <dl className="m-0 grid grid-cols-3 gap-3 p-4">
            {totals.map(([name, sats]) => (
              <div key={name} className="grid gap-0.5">
                <dt className="text-xs text-ink-2">{name}</dt>
                <dd className="m-0 text-base font-medium @min-[560px]:text-md">
                  <Amount sats={sats} />
                </dd>
              </div>
            ))}
          </dl>
          <div className="hidden grid-cols-[140px_84px_84px_minmax(0,1fr)_auto] gap-x-3 border-t border-rule px-4 py-2 text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase @min-[720px]:grid">
            <span className="text-right">Value</span>
            <span className="text-right">Age</span>
            <span className="text-right">Confirmations</span>
            <span>Label</span>
          </div>
          <ul className="m-0 list-none border-t border-rule-2 p-0">
            {sourcesOf(snapshot).map((s) => (
              <Group key={s.id} source={s} snapshot={snapshot} />
            ))}
          </ul>
        </section>
      ) : (
        <Empty title="No coins yet">
          <p className="m-0">
            Coins appear here once someone pays one of this wallet&rsquo;s addresses.{" "}
            <a className={linkClass} href="#/receive">
              Get an address
            </a>
          </p>
        </Empty>
      )}
    </div>
  );
}
