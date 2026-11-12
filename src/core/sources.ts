import { outpoint } from "../wallet/coin";
import type { WalletCoin, WalletSnapshot } from "./wallet";

/** Coins the chain already shows to have one owner, as the coin list groups them. */
export type Source = {
  id: string;
  name: string;
  /** What the user called it, when they did. */
  label: string | null;
  /** Its coins, held or since spent, that came from someone who knows who the user is. */
  kyc: { txid: string; vout: number }[];
  /** The block its oldest coin is in, null while unconfirmed. */
  firstSeen: number | null;
  coins: WalletCoin[];
  total: number;
};

const shortAddress = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;
const sum = (coins: WalletCoin[]) => coins.reduce((a, c) => a + c.value, 0);

/** The wallet's coins grouped by source, in the order the wallet first saw each. */
export function sourcesOf(snapshot: Pick<WalletSnapshot, "coins" | "groups" | "transactions" | "addresses">): Source[] {
  const byGroup = new Map<string, WalletCoin[]>();
  for (const coin of snapshot.coins) {
    const id = snapshot.groups.get(outpoint(coin)) ?? outpoint(coin);
    byGroup.set(id, [...(byGroup.get(id) ?? []), coin]);
  }
  const txLabel = new Map(snapshot.transactions.map((t) => [t.txid, t.label]));
  const marked = snapshot.transactions.flatMap((t) =>
    t.outputs.filter((o) => o.kyc).map((o) => ({ txid: t.txid, vout: o.vout })),
  );
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
      firstSeen: oldest.height,
      coins,
      total: sum(coins),
    };
  });
}
