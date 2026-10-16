import { outpoint, type Coin } from "./coin";
import type { Payment, Spend } from "./select";

/** A transaction in the wallet's history, as much of it as linking needs. */
export type HistoryTx = {
  txid: string;
  inputs: { txid: string; vout: number }[];
  /** Scripts hex, in output order. */
  outputs: { script: string; value: number }[];
};

/**
 * Groups the wallet's outputs into what the chain already shows to have one
 * owner: inputs spent together, our outputs of one transaction, and outputs
 * paid to the same script.
 *
 * @returns outpoint to group id, for every output paying one of `ownScripts`.
 */
export function linkCoins(
  history: HistoryTx[],
  ownScripts: Set<string>,
): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (p === undefined || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const own = new Map<string, string>();
  for (const tx of history) {
    tx.outputs.forEach((o, vout) => {
      if (ownScripts.has(o.script)) own.set(`${tx.txid}:${vout}`, o.script);
    });
  }
  for (const tx of history) {
    const mine = [
      ...tx.inputs.map(outpoint).filter((p) => own.has(p)),
      ...tx.outputs.flatMap((_, vout) => {
        const p = `${tx.txid}:${vout}`;
        return own.has(p) ? [p] : [];
      }),
    ];
    for (const p of mine) union(p, mine[0]!);
  }
  for (const [p, script] of own) union(p, `script:${script}`);

  return new Map([...own.keys()].map((p) => [p, find(p)]));
}

export type PrivacyWarning = {
  kind:
    | "links-sources"
    | "kyc"
    | "address-reuse"
    | "change-address-type"
    | "round-payment";
  message: string;
};

export type PrivacyReport = {
  /** The selected coins, one list per group not yet linked to the others. */
  sources: Coin[][];
  warnings: PrivacyWarning[];
};

export type SourceInfo = {
  label?: (coin: Coin) => string | undefined;
  /** True for a coin that came from an exchange that knows the user. */
  kyc?: (coin: Coin) => boolean;
};

const btc = (sats: number) =>
  `${(sats / 1e8).toFixed(8).replace(/\.?0+$/, "")} BTC`;

const list = (names: string[]) =>
  names.length > 4
    ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`
    : names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
      : names[0]!;

// A payment in whole ten-thousands of sats reads as round in BTC.
const isRound = (sats: number) => sats % 10_000 === 0;

/** What spending `spend.coins` reveals, in words for the send screen. */
export function assessPrivacy(
  spend: Spend,
  payment: Payment,
  groups: Map<string, string>,
  info: SourceInfo = {},
): PrivacyReport {
  const bySource = new Map<string, Coin[]>();
  for (const coin of spend.coins) {
    const id = groups.get(outpoint(coin)) ?? outpoint(coin);
    bySource.set(id, [...(bySource.get(id) ?? []), coin]);
  }
  const sources = [...bySource.values()];
  const name = (coins: Coin[]) => {
    const label = coins.map((c) => info.label?.(c)).find(Boolean);
    if (label) return label;
    const c = coins.reduce((a, b) => (b.value > a.value ? b : a));
    return c.height === null
      ? `${btc(c.value)} not yet confirmed`
      : `${btc(c.value)} received in block ${c.height.toLocaleString("en-GB")}`;
  };
  const warnings: PrivacyWarning[] = [];

  if (sources.length > 1) {
    warnings.push({
      kind: "links-sources",
      message: `This spends coins from ${sources.length} separate sources, permanently linking them: ${list(sources.map(name))}. Anyone looking at the blockchain will be able to tell they have the same owner.`,
    });
    const kyc = sources.filter((s) => s.some((c) => info.kyc?.(c)));
    if (kyc.length > 0) {
      warnings.push({
        kind: "kyc",
        message: `${list(kyc.map(name))} came from ${kyc.length > 1 ? "exchanges that know" : "an exchange that knows"} who you are. Spending ${kyc.length > 1 ? "them" : "it"} with your other coins lets the exchange see those are yours too.`,
      });
    }
  }

  const byScript = new Map<string, Coin[]>();
  for (const c of spend.coins) byScript.set(c.script, [...(byScript.get(c.script) ?? []), c]);
  for (const coins of byScript.values()) {
    if (coins.length < 2) continue;
    warnings.push({
      kind: "address-reuse",
      message: `${coins.length} of these coins were paid to the same address, ${coins[0]!.address}. Reusing an address shows everyone that the payments went to the same person.`,
    });
  }

  if (spend.change > 0 && payment.recipients.length > 0) {
    const changeKind = payment.scriptType === "wpkh" ? "0014" : "5120";
    if (payment.recipients.every((r) => !r.script.startsWith(changeKind))) {
      warnings.push({
        kind: "change-address-type",
        message:
          "The payment goes to a different type of address from your change, which makes it easy to tell which output is your change.",
      });
    }
    if (spend.amounts.every(isRound) && !isRound(spend.change)) {
      warnings.push({
        kind: "round-payment",
        message:
          "The payment is a round amount and your change is not, which makes it easy to tell which output is your change.",
      });
    }
  }

  return { sources, warnings };
}
