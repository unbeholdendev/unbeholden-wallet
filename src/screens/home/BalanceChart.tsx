import { useState } from "react";
import { Amount } from "../../app/amount";
import { txWhen } from "../../core/history";
import type { WalletSnapshot } from "../../core/wallet";
import { dateText } from "../../ui/format";

/** The balance after each transaction, oldest first, as a step line under the balance. Hover or arrow keys read out each step. */
export function BalanceChart({ snapshot }: { snapshot: WalletSnapshot }) {
  const [shown, setShown] = useState<number | null>(null);
  const now = Date.now() / 1000;
  const txs = [...snapshot.transactions].map((t) => ({ at: txWhen(t) ?? now, net: t.net })).sort((a, b) => a.at - b.at);
  if (txs.length < 2) return null;
  let balance = 0;
  const points = txs.map((t) => ({ at: t.at, balance: (balance += t.net) }));
  const start = points[0]!.at;
  const top = Math.max(...points.map((p) => p.balance), 1);
  const x = (at: number) => ((at - start) / Math.max(now - start, 1)) * 320;
  const y = (b: number) => 60 - (Math.max(b, 0) / top) * 56;
  const line = `M0 ${y(points[0]!.balance)} ${points
    .slice(1)
    .map((p) => `H${x(p.at)} V${y(p.balance)}`)
    .join(" ")} H320`;
  const last = points.length - 1;
  const point = shown === null ? null : points[Math.min(shown, last)]!;
  const keys: Record<string, (i: number) => number> = {
    ArrowLeft: (i) => Math.max(i - 1, 0),
    ArrowRight: (i) => Math.min(i + 1, last),
    Home: () => 0,
    End: () => last,
  };
  return (
    <figure className="m-0 grid gap-1">
      <svg
        viewBox="0 0 320 60"
        preserveAspectRatio="none"
        className="h-14 w-full touch-pan-y"
        role="img"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the chart takes focus so arrow keys can scrub it.
        tabIndex={0}
        aria-label={`Balance over time, from ${dateText(start)} to now`}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const at = start + ((e.clientX - box.left) / box.width) * (now - start);
          setShown(
            Math.max(
              points.findLastIndex((p) => p.at <= at),
              0,
            ),
          );
        }}
        onPointerLeave={() => setShown(null)}
        onFocus={() => setShown(last)}
        onBlur={() => setShown(null)}
        onKeyDown={(e) => {
          const step = keys[e.key];
          if (!step) return;
          e.preventDefault();
          setShown(step(shown ?? last));
        }}
      >
        <path d={`${line} V60 H0 Z`} className="fill-carbon-tint" />
        <path d={line} vectorEffect="non-scaling-stroke" className="fill-none stroke-carbon stroke-[1.5]" />
        {point && (
          <line
            x1={x(point.at)}
            x2={x(point.at)}
            y1="0"
            y2="60"
            vectorEffect="non-scaling-stroke"
            className="stroke-ink-3"
          />
        )}
      </svg>
      <figcaption aria-live="polite" className="flex justify-between text-xs text-ink-3">
        {point ? (
          <span>
            {dateText(point.at)}: <Amount sats={point.balance} />
          </span>
        ) : (
          <>
            <span>{dateText(start)}</span>
            <span>Now</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
