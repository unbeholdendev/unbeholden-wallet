import type { PsbtReview } from "../wallet/psbt";

type Addresses = { receive: { address: string }[]; change: { address: string }[] };

/** Marks the outputs paying one of `addresses` as this wallet's, and those on the change chain as change. */
export function claimOutputs(review: PsbtReview, addresses: Addresses | undefined): PsbtReview {
  // A PSBT signed elsewhere need not say which outputs are this wallet's, so its known addresses say too.
  const known = new Set([...(addresses?.receive ?? []), ...(addresses?.change ?? [])].map((a) => a.address));
  const change = new Set(addresses?.change.map((a) => a.address));
  const outputs = review.outputs.map((o) =>
    o.address && known.has(o.address) ? { ...o, mine: true, change: change.has(o.address) } : o,
  );
  return { ...review, outputs };
}

/** The outputs that are not change, what leaves the wallet through them, and what comes back as change. */
export function tally(review: PsbtReview) {
  const payments = review.outputs.filter((o) => !o.change);
  const leaving = payments.filter((o) => !o.mine).reduce((a, o) => a + o.value, 0);
  const change = review.outputs.filter((o) => o.change).reduce((a, o) => a + o.value, 0);
  return { payments, leaving, change };
}

/** `warnings`, plus one when the fee is over a tenth of what leaves the wallet. */
export function signNotices(review: PsbtReview, warnings: string[]): string[] {
  const { leaving } = tally(review);
  return review.fee > leaving / 10 && leaving > 0
    ? [
        ...warnings,
        `The fee is ${Math.round((review.fee / leaving) * 100)}% of what you're sending. Make sure that's what you meant.`,
      ]
    : warnings;
}
