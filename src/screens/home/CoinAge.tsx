import { Amount } from "../../app/amount";
import type { WalletSnapshot } from "../../core/wallet";
import { Panel } from "../../ui/kit";

const DAY = 86_400;
const ages = [
  { name: "Under a month", days: 30, fill: "fill-carbon/20", swatch: "bg-carbon/20" },
  { name: "1 to 6 months", days: 182, fill: "fill-carbon/40", swatch: "bg-carbon/40" },
  { name: "6 to 12 months", days: 365, fill: "fill-carbon/60", swatch: "bg-carbon/60" },
  { name: "1 to 2 years", days: 730, fill: "fill-carbon/80", swatch: "bg-carbon/80" },
  { name: "Over 2 years", days: Infinity, fill: "fill-carbon", swatch: "bg-carbon" },
];

/** What the coins hold, by how long ago they came in; unconfirmed ones count as new. */
export function CoinAge({ snapshot }: { snapshot: WalletSnapshot }) {
  const when = new Map(snapshot.transactions.map((t) => [t.txid, t.time]));
  const now = snapshot.tip?.time ?? Date.now() / 1000;
  const held = ages.map((a) => ({ ...a, sats: 0 }));
  for (const c of snapshot.coins) {
    const days = (now - (when.get(c.txid) ?? now)) / DAY;
    held.find((a) => days < a.days)!.sats += c.value;
  }
  const total = held.reduce((a, b) => a + b.sats, 0);
  if (!total) return null;
  const shown = held.filter((a) => a.sats);
  let at = 0;
  return (
    <Panel title="Coin age">
      <svg
        viewBox="0 0 1000 14"
        preserveAspectRatio="none"
        className="h-3.5 w-full"
        role="img"
        aria-label={shown.map((a) => `${a.name}, ${Math.round((a.sats / total) * 100)}%`).join("; ")}
      >
        {shown.map((a) => {
          const w = (a.sats / total) * 1000;
          const rect = <rect key={a.name} x={at} width={w} height="14" className={a.fill} />;
          at += w;
          return rect;
        })}
      </svg>
      <ul className="m-0 grid list-none gap-2 p-0">
        {shown.map((a) => (
          <li key={a.name} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-ink-2">
              <span aria-hidden className={`size-2.5 rounded-sm ${a.swatch}`} />
              {a.name}
            </span>
            <span className="flex-none text-ink-2">
              <Amount sats={a.sats} /> · {Math.round((a.sats / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
