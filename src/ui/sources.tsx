import type { WalletCoin, WalletSnapshot } from "../core/wallet";
import { outpoint } from "../wallet/coin";
import { groupSats } from "./amount";

/** Coins the chain already shows to have one owner, as the coin list groups them. */
export type Source = {
  id: string;
  name: string;
  /** What the user called it, when they did. */
  label: string | null;
  /** Its coins, held or since spent, that came from someone who knows who the user is. */
  kyc: { txid: string; vout: number }[];
  note: string;
  coins: WalletCoin[];
  total: number;
};

/** A manila luggage tag with the source's name: carbon once any of its coins are picked, grey when all are frozen. */
export function SourceTag({ source, large = false, on = false }: { source: Source; large?: boolean; on?: boolean }) {
  const muted = !on && source.coins.every((c) => c.frozen);
  return (
    <span
      className={`relative inline-flex max-w-full flex-none items-center font-bold tracking-[0.03em] [clip-path:polygon(7px_0,100%_0,100%_100%,7px_100%,0_50%)] ${large ? "h-[26px] min-w-10 pr-2 pl-[15px] text-[14px] [mask:radial-gradient(circle_at_9px_50%,transparent_2px,#000_2.5px)]" : "h-[22px] min-w-[34px] pr-[7px] pl-[13px] text-xs [mask:radial-gradient(circle_at_8px_50%,transparent_2px,#000_2.5px)]"} ${on ? "bg-carbon text-carbon-ink" : muted ? "bg-sunk text-ink-3" : "bg-manila text-manila-ink"}`}
    >
      <span className="truncate">{source.name}</span>
    </span>
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
  const marked = snapshot.transactions.flatMap((t) => t.outputs.filter((o) => o.kyc).map((o) => ({ txid: t.txid, vout: o.vout })));
  const addressLabel = new Map(
    [...snapshot.addresses.receive, ...snapshot.addresses.change].map((a) => [a.address, a.label]),
  );
  const first = (coins: WalletCoin[]) => Math.min(...coins.map((c) => c.height ?? Infinity));
  const groups = [...byGroup].sort(([a, x], [b, y]) => first(x) - first(y) || (a < b ? -1 : 1));
  return groups.map(([id, coins]) => {
    coins.sort((a, b) => b.value - a.value);
    const label = coins.map((c) => c.label ?? addressLabel.get(c.address) ?? txLabel.get(c.txid)).find(Boolean);
    const oldest = coins.reduce((a, b) => ((b.height ?? Infinity) < (a.height ?? Infinity) ? b : a));
    const kind = oldest.chain === 1 ? "Change at" : "Received at";
    return {
      id,
      name: label ?? `${kind} ${shortAddress(oldest.address)}`,
      label: label ?? null,
      kyc: marked.filter((m) => (snapshot.groups.get(outpoint(m)) ?? outpoint(m)) === id),
      note: [
        oldest.height === null ? "Not yet confirmed" : `First seen in block ${groupSats(oldest.height)}`,
        coins.length > 1 ? "already linked on-chain" : "",
      ]
        .filter(Boolean)
        .join(", "),
      coins,
      total: sum(coins),
    };
  });
}
