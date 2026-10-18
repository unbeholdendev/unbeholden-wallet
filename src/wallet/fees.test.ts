import { describe, expect, it } from "vitest";
import { feeTargets, mempoolDepth, mempoolPosition } from "./fees";

// The protocol's own example result.
// https://electrum-protocol.readthedocs.io/en/latest/protocol-methods.html#mempool-get-fee-histogram
const histogram = (
  [
    [59.5, 30324], [40.1, 34305], [35.0, 38459], [29.3, 41270], [27.0, 45167],
    [24.3, 53512], [22.9, 53488], [21.8, 70279], [20.0, 65328], [18.2, 72180],
    [18.1, 5254], [18.0, 191579], [16.5, 103640], [15.7, 106715],
    [15.1, 141776], [14.0, 183261], [13.5, 166496], [11.8, 166050],
    [11.1, 242436], [9.2, 184043], [7.1, 202137], [5.2, 222011],
    [4.8, 344788], [4.6, 17101], [4.5, 1696864], [4.1, 598001],
    [4.0, 32688687], [3.9, 505192], [3.8, 38417], [3.7, 2944970],
    [3.3, 693364], [3.2, 726373], [3.1, 308878], [3.0, 11884957],
    [2.6, 996967], [2.3, 822802], [2.2, 9075547], [2.1, 12149801],
    [2.0, 16387874], [1.4, 873120], [1.3, 3493364], [1.1, 2302460],
    [1.0, 23204633],
  ] as const
).map(([feeRate, vsize]) => ({ feeRate, vsize }));

describe("feeTargets", () => {
  it("pays above the bucket where each block boundary falls", () => {
    // The 15.1 bucket takes the mempool from 911,500 vB to 1,053,276; 4.5 from
    // 2,781,599 to 4,478,463; 4.0 from 5,076,464 to 37,765,151.
    expect(feeTargets(histogram)).toEqual({
      nextBlock: 15.7,
      threeBlocks: 4.6,
      sixBlocks: 4.1,
    });
  });

  it("falls back to the relay minimum when the mempool would clear", () => {
    const expected = { nextBlock: 1, threeBlocks: 1, sixBlocks: 1 };
    expect(feeTargets([])).toEqual(expected);
    expect(feeTargets([{ feeRate: 5, vsize: 2000 }, { feeRate: 1, vsize: 90_000 }])).toEqual(
      expected,
    );
  });

  it("never goes above the most the wallet accepts", () => {
    expect(feeTargets([{ feeRate: 50_000, vsize: 2_000_000 }]).nextBlock).toBe(10_000);
  });

  it("never goes below the relay minimum", () => {
    expect(feeTargets([{ feeRate: 0.5, vsize: 2_000_000 }]).nextBlock).toBe(1);
  });
});

describe("mempoolPosition", () => {
  it("counts what pays more as ahead", () => {
    expect(mempoolPosition(histogram, 15.7)).toEqual({ vsizeAhead: 911_500, blocks: 1 });
    expect(mempoolPosition(histogram, 10)).toEqual({ vsizeAhead: 1_995_562, blocks: 2 });
    expect(mempoolPosition(histogram, 100)).toEqual({ vsizeAhead: 0, blocks: 1 });
  });

  it("puts any rate first in an empty mempool", () => {
    expect(mempoolPosition([], 1)).toEqual({ vsizeAhead: 0, blocks: 1 });
  });
});

describe("mempoolDepth", () => {
  it("accumulates vsize from the top rate down", () => {
    expect(mempoolDepth(histogram).slice(0, 3)).toEqual([
      { feeRate: 59.5, depth: 30324 },
      { feeRate: 40.1, depth: 64629 },
      { feeRate: 35.0, depth: 103088 },
    ]);
    expect(mempoolDepth([])).toEqual([]);
  });
});
