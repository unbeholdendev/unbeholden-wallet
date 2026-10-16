import type { FeeBucket } from "../backend/backend";

// 4,000,000 weight units at four to the vbyte.
// https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki
export const BLOCK_VSIZE = 1_000_000;

// Core now relays from 0.1 sat/vB, but nodes on older versions still drop
// anything under 1, so below that a transaction may never reach a miner.
// https://github.com/bitcoin/bitcoin/blob/master/src/policy/policy.h
export const MIN_FEE_RATE = 1;

/** sat/vB to confirm within one, three and six blocks, about an hour. */
export type FeeTargets = { nextBlock: number; threeBlocks: number; sixBlocks: number };

/**
 * Electrum's histogram runs highest rate first, each bucket holding the vsize
 * paying from its rate up to the previous bucket's.
 * https://electrum-protocol.readthedocs.io/en/latest/protocol-methods.html#mempool-get-fee-histogram
 */
const upperRate = (histogram: FeeBucket[], i: number) =>
  histogram[Math.max(i - 1, 0)]!.feeRate;

/** For a chart: per bucket, the vsize paying at least its rate. */
export function mempoolDepth(
  histogram: FeeBucket[],
): { feeRate: number; depth: number }[] {
  let depth = 0;
  return histogram.map(({ feeRate, vsize }) => ({ feeRate, depth: (depth += vsize) }));
}

/** How much of the mempool would sit ahead of a transaction paying `feeRate`. */
export function mempoolPosition(
  histogram: FeeBucket[],
  feeRate: number,
): { vsizeAhead: number; blocks: number } {
  // A bucket straddling the rate counts as wholly ahead, so this errs late.
  const vsizeAhead = histogram
    .filter((_, i) => upperRate(histogram, i) > feeRate)
    .reduce((total, b) => total + b.vsize, 0);
  return { vsizeAhead, blocks: Math.floor(vsizeAhead / BLOCK_VSIZE) + 1 };
}

function rateWithin(histogram: FeeBucket[], blocks: number): number {
  let depth = 0;
  for (let i = 0; i < histogram.length; i++) {
    depth += histogram[i]!.vsize;
    if (depth >= blocks * BLOCK_VSIZE) {
      return Math.max(upperRate(histogram, i), MIN_FEE_RATE);
    }
  }
  return MIN_FEE_RATE;
}

export function feeTargets(histogram: FeeBucket[]): FeeTargets {
  return {
    nextBlock: rateWithin(histogram, 1),
    threeBlocks: rateWithin(histogram, 3),
    sixBlocks: rateWithin(histogram, 6),
  };
}
