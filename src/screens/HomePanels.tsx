import { useEffect, useState } from "react";
import { useWallet } from "../app/session";
import { useVault } from "../app/vault";
import { txWhen } from "../core/view";
import type { WalletSnapshot } from "../core/wallet";
import { Amount, groupSats } from "../ui/amount";
import { dateText } from "../ui/format";
import { linkClass, Panel } from "../ui/kit";
import { SourceTag, sourcesOf } from "../ui/sources";
import { BLOCK_VSIZE, feeTargets } from "../wallet/fees";
import { received, type PaymentRequest } from "./Receive";
import { eta, rateText, useFeeHistogram } from "./send/fees";

/** The balance after each transaction, oldest first, as a step line under the balance. */
export function BalanceChart({ snapshot }: { snapshot: WalletSnapshot }) {
  const now = Date.now() / 1000;
  const txs = [...snapshot.transactions].map((t) => ({ at: txWhen(t) ?? now, net: t.net })).sort((a, b) => a.at - b.at);
  if (txs.length < 2) return null;
  let balance = 0;
  const points = txs.map((t) => ({ at: t.at, balance: (balance += t.net) }));
  const start = points[0]!.at;
  const top = Math.max(...points.map((p) => p.balance), 1);
  const x = (at: number) => ((at - start) / Math.max(now - start, 1)) * 320;
  const y = (b: number) => 60 - (Math.max(b, 0) / top) * 56;
  const line = `M0 ${y(points[0]!.balance)} ${points.slice(1).map((p) => `H${x(p.at)} V${y(p.balance)}`).join(" ")} H320`;
  return (
    <figure className="m-0 grid gap-1">
      <svg viewBox="0 0 320 60" preserveAspectRatio="none" className="h-14 w-full" role="img" aria-label={`Balance over time, from ${dateText(start)} to now`}>
        <path d={`${line} V60 H0 Z`} className="fill-carbon-tint" />
        <path d={line} vectorEffect="non-scaling-stroke" className="fill-none stroke-carbon stroke-[1.5]" />
      </svg>
      <figcaption className="flex justify-between text-xs text-ink-3">
        <span>{dateText(start)}</span>
        <span>Now</span>
      </figcaption>
    </figure>
  );
}

/** What is still moving: unconfirmed payments, a send not yet out, and payment requests not yet paid. */
export function Pending({ snapshot, waiting }: { snapshot: WalletSnapshot; waiting: "sign" | "broadcast" | null }) {
  const { vault } = useVault();
  const { record } = useWallet();
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  useEffect(() => {
    vault.get<PaymentRequest[]>(`requests/${record.id}`).then((saved) => setRequests(saved ?? []), () => {});
  }, [vault, record.id]);
  const unconfirmed = snapshot.transactions.filter((t) => t.height === null);
  const incoming = unconfirmed.reduce((a, t) => a + Math.max(t.net, 0), 0);
  const outgoing = unconfirmed.reduce((a, t) => a + Math.min(t.net, 0), 0);
  const open = requests.filter((r) => {
    const { confirmed, unconfirmed: coming } = received(snapshot, r.address);
    return !(confirmed + coming) || (r.sats !== null && confirmed + coming < r.sats);
  });
  if (!waiting && !unconfirmed.length && !open.length) return null;
  const row = "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-rule pt-3 text-sm first:border-0 first:pt-0";
  return (
    <Panel title="Pending">
      <ul className="m-0 grid list-none gap-3 p-0">
        {waiting && (
          <li className={row}>
            <span>{waiting === "broadcast" ? "A signed transaction is waiting to be broadcast." : "A transaction you built is waiting to be signed."}</span>
            <a className={linkClass} href="#/send">Resume it</a>
          </li>
        )}
        {unconfirmed.length > 0 && (
          <li className={row}>
            <span>
              {unconfirmed.length === 1 ? "1 payment" : `${unconfirmed.length} payments`} not yet confirmed
            </span>
            <span className="flex gap-3">
              {incoming > 0 && <Amount sats={incoming} signed />}
              {outgoing < 0 && <Amount sats={outgoing} />}
            </span>
          </li>
        )}
        {open.length > 0 && (
          <li className={row}>
            <span>{open.length === 1 ? "1 payment request" : `${open.length} payment requests`} not yet paid</span>
            <a className={linkClass} href="#/receive">See them</a>
          </li>
        )}
      </ul>
    </Panel>
  );
}

/** The wallet's coins by source, largest first: a bar sized by value, and the biggest few by name. */
export function Sources({ snapshot }: { snapshot: WalletSnapshot }) {
  const sources = sourcesOf(snapshot).sort((a, b) => b.total - a.total);
  const total = sources.reduce((a, s) => a + s.total, 0);
  if (!total) return null;
  const gap = sources.length > 1 ? 4 : 0;
  const width = 1000 - gap * (sources.length - 1);
  let at = 0;
  const shown = sources.slice(0, 3);
  return (
    <Panel title="Where it came from" aside={sources.length === 1 ? "1 source" : `${sources.length} sources`}>
      <svg viewBox="0 0 1000 14" preserveAspectRatio="none" className="h-3.5 w-full" role="img" aria-label={sources.map((s) => `${s.name}, ${Math.round((s.total / total) * 100)}%`).join("; ")}>
        {sources.map((s) => {
          const w = (s.total / total) * width;
          const rect = <rect key={s.id} x={at} width={Math.max(w, 2)} height="14" rx="2" className="fill-manila" />;
          at += w + gap;
          return rect;
        })}
      </svg>
      <ul className="m-0 grid list-none gap-2 p-0">
        {shown.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              <SourceTag source={s} />
            </span>
            <span className="flex-none text-ink-2">
              <Amount sats={s.total} /> · {Math.round((s.total / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
      <a className={`${linkClass} justify-self-start text-sm`} href="#/coins">
        {sources.length > shown.length ? `All ${sources.length} sources` : "See the coins"}
      </a>
    </Panel>
  );
}

/** What the node's mempool says sending costs right now. */
export function Network() {
  const histogram = useFeeHistogram();
  if (!histogram) return null;
  const targets = feeTargets(histogram);
  const vsize = histogram.reduce((a, b) => a + b.vsize, 0);
  const blocks = Math.ceil(vsize / BLOCK_VSIZE);
  return (
    <Panel title="Network" aside="From your node">
      {vsize ? (
        <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-ink-2">Next block</dt>
          <dd className="m-0 text-right tabular-nums">{rateText(targets.nextBlock)} sat/vB</dd>
          <dt className="text-ink-2">Within an hour</dt>
          <dd className="m-0 text-right tabular-nums">{rateText(targets.sixBlocks)} sat/vB</dd>
          <dt className="text-ink-2">Waiting in the mempool</dt>
          <dd className="m-0 text-right tabular-nums">
            {groupSats(blocks)} block{blocks === 1 ? "" : "s"}, {eta(blocks)}
          </dd>
        </dl>
      ) : (
        <p className="m-0 text-sm text-ink-2">The mempool is empty. Any fee from 1 sat/vB gets into the next block.</p>
      )}
    </Panel>
  );
}
