import { useState } from "react";
import { navigate } from "../app/route";
import { useSendDraft, useWallet, useWalletSession, useWalletSnapshot } from "../app/session";
import { nextChange } from "../core/view";
import type { WalletCoin, WalletSnapshot, WalletTx } from "../core/wallet";
import { Amount, btcParts, groupSats } from "../ui/amount";
import { ageText, confText, shortId } from "../ui/format";
import { Icon } from "../ui/icons";
import { Button, Chip, Empty, linkClass, Panel } from "../ui/kit";
import { SourceSwatch, sourcesOf, TINT, type Source } from "../ui/sources";
import { outpoint } from "../wallet/coin";
import type { ScriptType } from "../wallet/descriptor";
import { feeTargets, MIN_FEE_RATE } from "../wallet/fees";
import { spend, spendCost } from "../wallet/select";
import { EditableLabel, Opening, SourceTitle } from "./parts";
import { selectable } from "./send/CoinList";
import { rateOf, rateText, useFeeHistogram } from "./send/fees";
import { blankDraft } from "./send/Send";

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

const sendable = (c: WalletCoin) => selectable(c) && c.status !== "foreign-unconfirmed";

type Picking = { picked: Set<string>; toggle: (coin: WalletCoin) => void };

/** One coin; given its source, the coin stands for the whole of a one-coin source. */
function CoinRow({ coin, source, snapshot, picking, rate }: { coin: WalletCoin; source?: Source; snapshot: WalletSnapshot; picking: Picking; rate: number | null }) {
  const session = useWalletSession();
  const tx = lookup(snapshot).tx.get(coin.txid);
  const confirmations = tx?.confirmations ?? 0;
  const age = tx?.time && snapshot.tip ? ageText(snapshot.tip.time - tx.time) : null;
  const when = (confirmations < 6 || !age ? confText(confirmations) : age).toLowerCase();
  const path = lookup(snapshot).path.get(coin.address);
  const cost = rate === null ? null : spendCost(coin, rate);
  const uneconomic = cost !== null && cost >= coin.value;
  const { lead, rest } = btcParts(coin.value);
  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-t px-4 py-3 @min-[720px]:grid-cols-[140px_84px_minmax(0,1fr)_auto] @min-[720px]:items-center ${source ? "border-rule-2 first:border-t-0" : "border-rule"} ${coin.frozen ? "bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_srgb,var(--rule)_45%,transparent)_6px_7px)]" : source ? TINT[source.tone] : "bg-sheet"}`}
    >
      <span className="flex items-center gap-2.5 @min-[720px]:justify-between">
        <input
          type="checkbox"
          aria-label={`Send ${lead}${rest} BTC`}
          checked={picking.picked.has(outpoint(coin))}
          disabled={!sendable(coin)}
          onChange={() => picking.toggle(coin)}
          className="size-4 flex-none accent-route"
        />
        <a href={`#/coin/${outpoint(coin)}`} className={`text-md font-medium no-underline hover:underline ${coin.frozen ? "opacity-60" : "text-ink"}`}>
          <Amount sats={coin.value} />
        </a>
      </span>
      <span className="hidden text-right text-sm text-ink-2 @min-[720px]:block">{when}</span>
      <div className="col-span-2 row-start-2 grid min-w-0 gap-1 @min-[720px]:col-span-1 @min-[720px]:col-start-3 @min-[720px]:row-start-1">
        {source ? (
          <span className="flex min-w-0 items-center gap-2.5">
            <SourceSwatch source={source} />
            <SourceTitle source={source} />
          </span>
        ) : (
          <EditableLabel type="output" target={`${coin.txid}:${coin.vout}`} value={coin.label} placeholder="Label this coin" className="text-sm" />
        )}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
          <span className="@min-[720px]:hidden">{when}</span>
          <span className="font-mono">{shortId(coin.address, 10, 6)}</span>
          {path && <span className="font-mono">{path}</span>}
          {cost !== null && <span>{groupSats(cost)} sats to spend</span>}
        </span>
        {(coin.frozen || statusChip[coin.status] || uneconomic) && (
          <span className="flex flex-wrap gap-1.5">
            {coin.frozen && (
              <Chip>
                <Icon name="lock" className="size-3.5" />
                Frozen, never spent automatically
              </Chip>
            )}
            {statusChip[coin.status]}
            {uneconomic && <Chip tone="warn">Uneconomic at {rateText(rate!)} sat/vB</Chip>}
          </span>
        )}
      </div>
      <Button
        size="sm"
        icon={coin.frozen ? "unlock" : "lock"}
        aria-label={`${coin.frozen ? "Unfreeze" : "Freeze"} ${lead}${rest} BTC`}
        className="col-start-2 row-start-1 @min-[720px]:col-start-4"
        onClick={() => session?.setFrozen(coin, !coin.frozen)}
      >
        {coin.frozen ? "Unfreeze" : "Freeze"}
      </Button>
    </li>
  );
}

function Group({ source, snapshot, picking, rate }: { source: Source; snapshot: WalletSnapshot; picking: Picking; rate: number | null }) {
  if (source.coins.length === 1) return <CoinRow coin={source.coins[0]!} source={source} snapshot={snapshot} picking={picking} rate={rate} />;
  return (
    <li className="border-t border-rule-2 first:border-t-0">
      <div className={`grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-2.5 ${TINT[source.tone]}`}>
        <SourceSwatch source={source} />
        <SourceTitle source={source} />
        <span className="text-right text-sm text-ink-2">
          {source.coins.length} coins
          <br />
          <Amount sats={source.total} />
        </span>
      </div>
      <ul className="m-0 list-none p-0">
        {source.coins.map((c) => (
          <CoinRow key={`${c.txid}:${c.vout}`} coin={c} snapshot={snapshot} picking={picking} rate={rate} />
        ))}
      </ul>
    </li>
  );
}

// An example of a busy day, the fee chart's top contour; the copy says it is not a forecast.
const BUSY_RATE = 50;

/**
 * Per source, its coins that a busy day's fee would take 1% or more of, and
 * what joining them now at `rate` saves over spending them one by one then.
 */
function joinPlans(sources: Source[], rate: number, scriptType: ScriptType) {
  return sources.flatMap((source) => {
    const coins = source.coins.filter((c) => sendable(c) && spendCost(c, BUSY_RATE) * 100 >= c.value);
    if (coins.length < 2) return [];
    const joined = spend(coins, { recipients: [{ script: coins[0]!.script, value: "max" }], feeRate: rate, scriptType });
    const later = spendCost(coins[0]!, BUSY_RATE);
    const apart = coins.length * later;
    const saving = apart - joined.fee - later;
    return joined.problem || saving <= 0 ? [] : [{ source, coins, fee: joined.fee, later, apart, saving }];
  });
}

function Join({ snapshot, sources, rate }: { snapshot: WalletSnapshot; sources: Source[]; rate: number }) {
  const { scriptType } = useWallet();
  const [draft, store] = useSendDraft();
  const plans = joinPlans(sources, rate, scriptType);
  if (!plans.length) return null;
  const busy = !!draft && (!!draft.built || draft.drafts.some((d) => d.address.trim()));
  const join = ({ source, coins }: (typeof plans)[number]) => {
    const to = nextChange(snapshot).address;
    store(() => ({ ...blankDraft(), drafts: [{ key: 0, address: to, amount: "", max: true, label: `Joined coins from ${source.name}` }], fee: { preset: "sixBlocks" }, picked: coins.map(outpoint) }));
    navigate("/send");
  };
  return (
    <Panel title="Fees are low: join small coins" className="@container">
      <p className="m-0 max-w-[64ch] text-ink-2">
        Everything waiting in your node&rsquo;s mempool fits in the next six blocks, so {rateText(rate)} sat/vB should confirm within
        about an hour. Joining a source&rsquo;s small coins into one now costs less than spending them one by one if fees rise to{" "}
        {BUSY_RATE} sat/vB, as they have on busy days. That is an example, not a forecast. Coins are only joined within one source,
        so nothing new is linked.
      </p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {plans.map((plan) => (
          <li key={plan.source.id} className={`grid gap-2 rounded-control px-3 py-2.5 @min-[560px]:grid-cols-[minmax(0,1fr)_auto] @min-[560px]:items-center ${TINT[plan.source.tone]}`}>
            <div className="grid min-w-0 gap-1">
              <span className="flex min-w-0 items-center gap-2.5 font-semibold">
                <SourceSwatch source={plan.source} />
                <span className="truncate">{plan.source.name}</span>
              </span>
              <span className="text-sm text-ink-2">
                {plan.coins.length} coins, <Amount sats={plan.coins.reduce((a, c) => a + c.value, 0)} />. Spent one by one at {BUSY_RATE} sat/vB:{" "}
                {groupSats(plan.apart)} sats. Joined now: {groupSats(plan.fee)} sats, then {groupSats(plan.later)} sats to spend the one coin.{" "}
                <b className="font-semibold text-ink">Saves {groupSats(plan.saving)} sats.</b>
              </span>
            </div>
            <Button size="sm" disabled={busy} onClick={() => join(plan)} className="justify-self-start">
              Join these {plan.coins.length} coins
            </Button>
          </li>
        ))}
      </ul>
      {busy && <p className="m-0 text-sm text-ink-3">Finish or discard the send in progress first.</p>}
    </Panel>
  );
}

export function Coins() {
  const snapshot = useWalletSnapshot();
  const [draft, store] = useSendDraft();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const histogram = useFeeHistogram();
  if (!snapshot) return <Opening title="Coins" />;
  const sources = sourcesOf(snapshot);
  const rate = histogram && rateOf(draft?.fee ?? { preset: "threeBlocks" }, histogram);
  const low = histogram && feeTargets(histogram).sixBlocks === MIN_FEE_RATE;
  const { coins, balance } = snapshot;
  const toggle = (coin: WalletCoin) => {
    const next = new Set(picked);
    if (!next.delete(outpoint(coin))) next.add(outpoint(coin));
    setPicked(next);
  };
  const sending = coins.filter((c) => sendable(c) && picked.has(outpoint(c)));
  const send = () => {
    store((d) => ({ ...(d ?? blankDraft()), picked: sending.map(outpoint), built: null }));
    navigate("/send");
  };
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
      {low && <Join snapshot={snapshot} sources={sources} rate={rateOf({ preset: "sixBlocks" }, histogram)} />}
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
          {rate !== null && (
            <p className="m-0 px-4 pb-3 text-xs text-ink-3">
              Costs to spend are at {rateText(rate)} sat/vB, {draft ? "the fee rate of your send in progress" : "the rate to confirm within 30 minutes"}.
            </p>
          )}
          <div className="hidden grid-cols-[140px_84px_minmax(0,1fr)_auto] gap-x-3 border-t border-rule px-4 py-2 text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase @min-[720px]:grid">
            <span className="text-right">Value</span>
            <span className="text-right">Age</span>
            <span>Label</span>
          </div>
          <ul className="m-0 list-none border-t border-rule-2 p-0">
            {sources.map((s) => (
              <Group key={s.id} source={s} snapshot={snapshot} picking={{ picked, toggle }} rate={rate} />
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
      {sending.length > 0 && (
        <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-[2] flex flex-wrap items-center justify-between gap-3 rounded-panel border border-rule-2 bg-sheet p-3 pl-4 shadow-float @min-[720px]/app:bottom-4">
          <span className="text-sm">
            <b className="font-semibold">{sending.length} coin{sending.length === 1 ? "" : "s"}</b>, <Amount sats={sum(sending)} />
          </span>
          <span className="flex gap-2">
            <Button size="sm" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
            <Button size="sm" variant="primary" onClick={send}>
              Send these
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
