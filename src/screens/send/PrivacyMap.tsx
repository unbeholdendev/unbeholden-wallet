import { useId } from "react";
import type { WalletCoin } from "../../core/wallet";
import { outpoint } from "../../wallet/coin";
import { blob, EDGE, FILL, INK, type Source } from "../../ui/sources";

const W = 360;
const ROW = 74;
const BAND = 48;
const MAX_SHOWN = 12;
const MAX_DOTS = 6;

/**
 * One territory per source, the selection drawn as routes from each chosen
 * coin to this transaction. Sources the selection does not touch fade.
 */
export function PrivacyMap({ sources, selected }: { sources: Source[]; selected: Set<string> }) {
  const id = useId().replace(/\W/g, "");
  const linked = new Set(sources.filter((s) => s.coins.some((c) => selected.has(outpoint(c)))).map((s) => s.id));
  const shown = (sources.length > MAX_SHOWN
    ? sources.filter((s, i) => linked.has(s.id) || i < MAX_SHOWN - linked.size)
    : sources
  ).slice(0, MAX_SHOWN);
  const n = shown.length;
  const cols = n <= 3 ? Math.max(n, 1) : n <= 6 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const above = Math.max(1, Math.ceil(rows / 2));
  const height = rows * ROW + BAND + 8;
  const tx = { x: W / 2, y: above * ROW + BAND / 2 + 4 };

  const places = shown.map((source, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const cell = W / cols;
    const cx = (W - inRow * cell) / 2 + (i % cols) * cell + cell / 2;
    const cy = row * ROW + ROW / 2 + 4 + (row >= above ? BAND : 0);
    const coins = [...source.coins].sort((a, b) => Number(selected.has(outpoint(b))) - Number(selected.has(outpoint(a))));
    const dots = coins.slice(0, MAX_DOTS).map((coin: WalletCoin, k, all) => ({
      coin,
      x: cx + (k - (all.length - 1) / 2) * Math.min(14, (cell * 0.7) / all.length),
      y: cy + 8,
    }));
    return { source, cx, cy, rx: Math.min(cell * 0.44, 66), ry: 29, dots, more: coins.length - dots.length };
  });

  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Map of your coin sources. Selected coins are joined by routes to this transaction." className="block h-auto w-full">
      {places.map(({ source, cx, cy, rx, ry }) => (
        <g key={source.id} className={`transition-opacity ${linked.size && !linked.has(source.id) ? "opacity-[0.38]" : ""}`}>
          <path d={blob(cx, cy, rx, ry, source.seed)} className={`${FILL[source.tone]} ${EDGE[source.tone]} stroke-[1.4] ${source.dashed ? "[stroke-dasharray:4_3]" : ""}`} />
          <text x={cx} y={cy - ry * 0.4} textAnchor="middle" className={`${INK[source.tone]} text-[9px] font-semibold tracking-[0.06em] uppercase`}>
            {source.short}
          </text>
        </g>
      ))}
      {places.flatMap(({ dots, cx }) =>
        dots
          .filter(({ coin }) => selected.has(outpoint(coin)))
          .map(({ coin, x, y }) => {
            const d = `M${x} ${y}Q${(x + tx.x) / 2 + (cx < tx.x ? -12 : 12)} ${(y + tx.y) / 2} ${tx.x} ${tx.y}`;
            const mask = `${id}${outpoint(coin).replace(/\W/g, "")}`;
            return (
              <g key={outpoint(coin)}>
                <mask id={mask} maskUnits="userSpaceOnUse">
                  <path d={d} pathLength={200} className="animate-route-draw fill-none stroke-white stroke-[6] [stroke-dasharray:200]" />
                </mask>
                <path d={d} mask={`url(#${mask})`} className="fill-none stroke-route stroke-2 [stroke-dasharray:5_4] [stroke-linecap:round]" />
              </g>
            );
          }),
      )}
      {places.map(({ source, dots, more, cx, cy }) => (
        <g key={source.id}>
          {dots.map(({ coin, x, y }) => {
            const on = selected.has(outpoint(coin));
            return (
              <circle
                key={outpoint(coin)}
                cx={x}
                cy={y}
                r={on ? 5 : 4.5}
                className={`stroke-[1.5] ${on ? "fill-route stroke-sheet" : coin.frozen ? "fill-sheet stroke-ink-3 [stroke-dasharray:2_1.5]" : "fill-sheet stroke-ink-2"}`}
              />
            );
          })}
          {more > 0 && (
            <text x={cx} y={cy + 24} textAnchor="middle" className="fill-ink-2 text-[9px]">
              and {more} more
            </text>
          )}
        </g>
      ))}
      <g transform={`translate(${tx.x} ${tx.y})`}>
        <path d="M0 -9L8 6H-8Z" className="fill-sheet stroke-ink stroke-[1.6]" />
        <circle r={2} cy={1.5} className="fill-ink" />
      </g>
      <text x={tx.x + 13} y={tx.y + 3} className="fill-ink text-[10px] font-semibold">
        This transaction
      </text>
      {sources.length > shown.length && (
        <text x={W - 4} y={height - 2} textAnchor="end" className="fill-ink-3 text-[9px]">
          {sources.length - shown.length} more sources not drawn
        </text>
      )}
    </svg>
  );
}
