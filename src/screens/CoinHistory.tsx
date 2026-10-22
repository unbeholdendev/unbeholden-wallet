import { useWalletSnapshot } from "../app/session";
import { COINBASE, txWhen, type WalletTx } from "../core/view";
import { Amount } from "../ui/amount";
import { dateText, shortId, txFallback } from "../ui/format";
import { Icon } from "../ui/icons";
import { Chip, Empty, linkClass } from "../ui/kit";
import { sourcesOf } from "../ui/sources";
import { outpoint } from "../wallet/coin";
import { Opening, SourceTitle } from "./parts";

function Back() {
  return (
    <a href="#/coins" className={`${linkClass} inline-flex items-center gap-1 justify-self-start text-sm`}>
      <Icon name="chev" className="size-4 rotate-90" />
      Coins
    </a>
  );
}

/** The wallet's transactions that led to a coin, newest first, and how many earlier ones are not cached. */
function trail(transactions: WalletTx[], txid: string) {
  const byId = new Map(transactions.map((t) => [t.txid, t]));
  const seen = new Set<string>();
  const missing = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const i of byId.get(id)!.inputs) {
      if (i.mine && byId.has(i.txid)) walk(i.txid);
      else if (i.mine || (i.value === null && i.txid !== COINBASE)) missing.add(i.txid);
    }
  };
  walk(txid);
  return { stops: transactions.filter((t) => seen.has(t.txid)), missing: missing.size };
}

function Stop({ tx }: { tx: WalletTx }) {
  const when = txWhen(tx);
  const outside = tx.inputs.filter((i) => !i.mine);
  const own = tx.inputs.length > outside.length;
  return (
    <li className="relative grid gap-1 pb-5 pl-7 last:pb-0">
      <span aria-hidden="true" className="absolute top-1.5 left-0 size-3 rounded-full border-2 border-carbon bg-sheet" />
      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
        <a href={`#/tx/${tx.txid}`} className={`${linkClass} font-bold`}>
          {tx.label ?? txFallback(tx)}
        </a>
        <span className="text-sm text-ink-2">{when === null ? "Unconfirmed" : dateText(when)}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-sm text-ink-2">
        {outside.some((i) => i.txid === COINBASE) ? (
          <Chip tone="carbon">New coins from mining</Chip>
        ) : outside.length > 0 && (
          <Chip tone="carbon">{own ? "Joined with someone else's coins" : "Paid in from outside"}</Chip>
        )}
        {own && !outside.length && <span>Spent your earlier coins</span>}
        {tx.outputs.some((o) => o.mine && o.kyc) && (
          <Chip tone="warn">
            <Icon name="check" className="size-3" />
            Knows who you are
          </Chip>
        )}
      </span>
    </li>
  );
}

export function CoinHistory({ point }: { point: string | undefined }) {
  const snapshot = useWalletSnapshot();
  if (!snapshot) return <Opening title="Coin history" />;
  const coin = snapshot.coins.find((c) => outpoint(c) === point);
  if (!coin)
    return (
      <div className="grid content-start gap-4">
        <Back />
        <Empty title="This wallet holds no such coin">
          <p className="m-0">It may have been spent.</p>
        </Empty>
      </div>
    );

  const source = sourcesOf(snapshot).find((s) => s.coins.some((c) => outpoint(c) === point))!;
  const others = source.coins.filter((c) => c !== coin);
  const { stops, missing } = trail(snapshot.transactions, coin.txid);
  const entries = stops.filter((t) => t.inputs.some((i) => !i.mine)).length;
  return (
    <div className="grid max-w-[720px] content-start gap-6">
      <Back />
      <div className="grid gap-2">
        <h1 className="m-0 text-xl font-bold">Coin history</h1>
        <span className="text-2xl font-medium">
          <Amount sats={coin.value} unit />
        </span>
        <p className="m-0 max-w-[64ch] text-ink-2">
          What the chain already shows about this coin. Spending it tells whoever you pay all of this too.
        </p>
      </div>
      <section aria-label="Source" className="grid gap-3 rounded-panel border border-rule bg-manila-2 p-4">
        <SourceTitle source={source} />
        {others.length ? (
          <div className="grid gap-1.5 text-sm">
            <span>
              Already linked on-chain with {others.length === 1 ? "another coin" : `${others.length} other coins`} you hold:
            </span>
            <ul className="m-0 grid list-none gap-1 p-0">
              {others.map((c) => (
                <li key={outpoint(c)} className="flex flex-wrap items-baseline gap-x-3">
                  <a href={`#/coin/${outpoint(c)}`} className={linkClass}>
                    <Amount sats={c.value} />
                  </a>
                  <span className="text-ink-2">{c.label ?? <span className="font-mono text-xs">{shortId(c.address, 10, 6)}</span>}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="m-0 text-sm text-ink-2">Not linked to any other coin you hold.</p>
        )}
      </section>
      <section aria-label="How it got here" className="grid gap-4 rounded-panel border border-rule bg-sheet p-4">
        <div className="grid gap-1">
          <h2 className="m-0 text-md font-bold">How it got here</h2>
          <p className="m-0 text-sm text-ink-2">
            {stops.length === 1
              ? "Straight from one transaction."
              : `Through ${stops.length} of your transactions, from ${entries === 1 ? "one place" : `${entries} places`} where value came in from outside.`}
          </p>
        </div>
        <ol className="relative m-0 list-none p-0 before:absolute before:top-3 before:bottom-3 before:left-[5px] before:border-l-2 before:border-dashed before:border-carbon">
          {stops.map((tx) => (
            <Stop key={tx.txid} tx={tx} />
          ))}
        </ol>
        {missing > 0 && (
          <p className="m-0 text-sm text-warn">
            {missing === 1 ? "An earlier transaction isn't" : `${missing} earlier transactions aren't`} in this wallet&rsquo;s cache, so the trail stops short.
            Syncing again may fetch {missing === 1 ? "it" : "them"}.
          </p>
        )}
      </section>
    </div>
  );
}
