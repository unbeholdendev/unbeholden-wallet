import type { WalletCoin, WalletSnapshot } from "../core/wallet";
import { outpoint } from "../wallet/coin";

/** Coins the chain already shows to have one owner, as the coin list and the map draw them. */
export type Source = {
  id: string;
  /** 1 to 6 for `src-1` to `src-6`, 0 for `src-none`. */
  tone: number;
  /** A seventh source and on reuse a tone with a dashed edge. */
  dashed: boolean;
  seed: number;
  name: string;
  /** Short enough to sit inside a territory on the map. */
  short: string;
  note: string;
  coins: WalletCoin[];
  total: number;
};

// Tailwind only ships classes it finds written out whole.
export const FILL = ["fill-src-none", "fill-src-1", "fill-src-2", "fill-src-3", "fill-src-4", "fill-src-5", "fill-src-6"];
export const EDGE = ["stroke-src-none-edge", "stroke-src-1-edge", "stroke-src-2-edge", "stroke-src-3-edge", "stroke-src-4-edge", "stroke-src-5-edge", "stroke-src-6-edge"];
export const INK = ["fill-src-none-edge", "fill-src-1-edge", "fill-src-2-edge", "fill-src-3-edge", "fill-src-4-edge", "fill-src-5-edge", "fill-src-6-edge"];
export const TINT = [
  "bg-[color-mix(in_srgb,var(--src-none)_55%,var(--sheet))]",
  "bg-[color-mix(in_srgb,var(--src-1)_55%,var(--sheet))]",
  "bg-[color-mix(in_srgb,var(--src-2)_55%,var(--sheet))]",
  "bg-[color-mix(in_srgb,var(--src-3)_55%,var(--sheet))]",
  "bg-[color-mix(in_srgb,var(--src-4)_55%,var(--sheet))]",
  "bg-[color-mix(in_srgb,var(--src-5)_55%,var(--sheet))]",
  "bg-[color-mix(in_srgb,var(--src-6)_55%,var(--sheet))]",
];

/** A closed, slightly irregular territory around a centre, the same for the same seed. */
export function blob(cx: number, cy: number, rx: number, ry: number, seed: number, n = 9): string {
  let x = seed * 7919 + 17;
  const r = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 0.82 + r() * 0.3;
    return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k] as const;
  });
  const at = (i: number) => pts[(i + n) % n]!;
  let d = `M${at(0)[0].toFixed(1)} ${at(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0]!.toFixed(1)} ${c1[1]!.toFixed(1)} ${c2[0]!.toFixed(1)} ${c2[1]!.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

export function SourceSwatch({ source, className = "h-[18px] w-7" }: { source: Source; className?: string }) {
  return (
    <svg viewBox="0 0 28 18" aria-hidden="true" className={`block flex-none ${className}`}>
      <path
        d={blob(14, 9, 12.5, 7.5, source.seed)}
        className={`${FILL[source.tone]} ${EDGE[source.tone]} stroke-[1.2] ${source.dashed ? "[stroke-dasharray:3_2]" : ""}`}
      />
    </svg>
  );
}

const shortAddress = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;
const sum = (coins: WalletCoin[]) => coins.reduce((a, c) => a + c.value, 0);

/** The wallet's coins grouped by source, in the order the wallet first saw each. */
export function sourcesOf(snapshot: WalletSnapshot): Source[] {
  const byGroup = new Map<string, WalletCoin[]>();
  for (const coin of snapshot.coins) {
    const id = snapshot.groups.get(outpoint(coin)) ?? outpoint(coin);
    byGroup.set(id, [...(byGroup.get(id) ?? []), coin]);
  }
  const txLabel = new Map(snapshot.transactions.map((t) => [t.txid, t.label]));
  const addressLabel = new Map(
    [...snapshot.addresses.receive, ...snapshot.addresses.change].map((a) => [a.address, a.label]),
  );
  const first = (coins: WalletCoin[]) => Math.min(...coins.map((c) => c.height ?? Infinity));
  const groups = [...byGroup].sort(([a, x], [b, y]) => first(x) - first(y) || (a < b ? -1 : 1));
  let shown = 0;
  return groups.map(([id, coins]) => {
    coins.sort((a, b) => b.value - a.value);
    const label = coins.map((c) => c.label ?? addressLabel.get(c.address) ?? txLabel.get(c.txid)).find(Boolean);
    const oldest = coins.reduce((a, b) => ((b.height ?? Infinity) < (a.height ?? Infinity) ? b : a));
    const frozen = coins.every((c) => c.frozen);
    const tone = frozen ? 0 : (shown % 6) + 1;
    const dashed = !frozen && shown >= 6;
    if (!frozen) shown++;
    let seed = 0;
    for (const ch of id) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
    const kind = oldest.chain === 1 ? "Change at" : "Received at";
    return {
      id,
      tone,
      dashed,
      seed,
      name: label ?? `${kind} ${shortAddress(oldest.address)}`,
      short: label ? (label.length > 16 ? `${label.slice(0, 15)}…` : label) : `…${oldest.address.slice(-4)}`,
      note: [
        oldest.height === null ? "Not yet confirmed" : `First seen in block ${oldest.height.toLocaleString("en-GB")}`,
        coins.length > 1 ? "already linked on-chain" : "",
      ]
        .filter(Boolean)
        .join(", "),
      coins,
      total: sum(coins),
    };
  });
}
