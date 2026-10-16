import { describe, expect, it } from "vitest";
import type { Coin, CoinStatus } from "./coin";
import { selectCoins, spend, type Payment } from "./select";

const wpkh = (n: number) => "0014" + n.toString(16).padStart(40, "0");
const tr = (n: number) => "5120" + n.toString(16).padStart(64, "0");

let next = 0;
function coin(
  value: number,
  more: Partial<Coin> = {},
  status: CoinStatus = "confirmed",
): Coin {
  next++;
  return {
    txid: next.toString(16).padStart(64, "0"),
    vout: 0,
    value,
    script: wpkh(next),
    address: `addr${next}`,
    chain: 0,
    index: next,
    height: 800_000,
    status,
    frozen: false,
    ...more,
  };
}

const pay = (value: number | "max", feeRate = 10): Payment => ({
  recipients: [{ script: wpkh(999), value }],
  feeRate,
  scriptType: "wpkh",
});

const values = (coins: Coin[]) => coins.map((c) => c.value).sort((a, b) => a - b);

// Sizes from the calculator's own checks against mainnet transactions:
// 1-in 2-out P2WPKH is 140.5 vB, 2-in 1-out is 177.5 vB; P2TR inputs are
// 57.5 vB and outputs 43 vB.
// https://bitcoinops.org/en/tools/calc-size/
describe("spend", () => {
  it("works out fee and change for one wpkh input paying one output", () => {
    const result = spend([coin(100_000)], pay(50_000));
    expect(result).toMatchObject({
      vsize: 141,
      fee: 1410,
      change: 48_590,
      amounts: [50_000],
      total: 51_410,
      problem: null,
    });
  });

  it("sends everything to a max recipient", () => {
    const result = spend([coin(60_000), coin(40_000)], pay("max"));
    expect(result).toMatchObject({
      vsize: 178,
      fee: 1780,
      change: 0,
      amounts: [98_220],
      problem: null,
    });
  });

  it("sizes a taproot spend", () => {
    const result = spend([coin(100_000, { script: tr(1) })], {
      recipients: [{ script: tr(2), value: 50_000 }],
      feeRate: 1,
      scriptType: "tr",
    });
    expect(result.vsize).toBe(154);
  });

  it("drops change that would cost more to spend than it holds", () => {
    // 590 sats of change would take 680 sats to spend at 10 sat/vB.
    const result = spend([coin(100_000)], pay(98_000));
    expect(result).toMatchObject({ change: 0, fee: 2000, vsize: 110, problem: null });
  });

  it("says how much is missing", () => {
    expect(spend([coin(10_000)], pay(10_000)).problem).toEqual({
      kind: "insufficient",
      missing: 1100,
    });
  });

  it("refuses a dust payment", () => {
    expect(spend([coin(10_000)], pay(200)).problem).toEqual({
      kind: "dust",
      recipient: 0,
    });
  });

  it("needs coins", () => {
    expect(spend([], pay(10_000)).problem).toEqual({ kind: "no-coins" });
  });
});

describe("selectCoins", () => {
  it("finds a changeless solution where one exists", () => {
    const coins = [20_000, 30_000, 50_000, 70_000, 200_000].map((v) => coin(v));
    // At 2 sat/vB, 30k and 50k pay 79,642 with 358 sats of fee and no change.
    const result = selectCoins(coins, pay(79_642, 2), "seed");
    expect(values(result.coins)).toEqual([30_000, 50_000]);
    expect(result).toMatchObject({ change: 0, fee: 358, problem: null });
  });

  it("falls back to a random draw with change, the same for the same seed", () => {
    const coins = [300_000, 400_000, 500_000, 600_000, 700_000].map((v) => coin(v));
    const first = selectCoins(coins, pay(250_000), "seed");
    expect(first.change).toBeGreaterThan(0);
    expect(first.problem).toBeNull();
    expect(selectCoins([...coins].reverse(), pay(250_000), "seed").coins).toEqual(
      first.coins,
    );
    const draws = new Set(
      ["a", "b", "c", "d", "e", "f"].map((seed) =>
        values(selectCoins(coins, pay(250_000), seed).coins).join(),
      ),
    );
    expect(draws.size).toBeGreaterThan(1);
  });

  it("never picks frozen coins or coins with unconfirmed parents", () => {
    const frozen = coin(50_000, { frozen: true });
    const parents = coin(50_000, {}, "unconfirmed-parents");
    const result = selectCoins([frozen, parents, coin(500_000)], pay(48_000), "seed");
    expect(result.coins).not.toContain(frozen);
    expect(result.coins).not.toContain(parents);
  });

  it("leaves unconfirmed payments from others out unless allowed", () => {
    const foreign = coin(50_000, {}, "foreign-unconfirmed");
    const change = coin(30_000, {}, "own-change");
    expect(selectCoins([foreign], pay(10_000), "seed").problem).toEqual({
      kind: "no-coins",
    });
    expect(selectCoins([foreign, change], pay(10_000), "seed").coins).toEqual([change]);
    expect(selectCoins([foreign], pay(10_000), "seed", true).coins).toEqual([foreign]);
  });

  it("sweeps every eligible coin to a max recipient", () => {
    const coins = [coin(60_000), coin(40_000), coin(10_000, { frozen: true })];
    const result = selectCoins(coins, pay("max"), "seed");
    expect(values(result.coins)).toEqual([40_000, 60_000]);
    expect(result.amounts).toEqual([98_220]);
  });

  it("reports a shortfall across everything it could spend", () => {
    const result = selectCoins([coin(5_000), coin(5_000)], pay(10_000), "seed");
    expect(result.problem).toMatchObject({ kind: "insufficient" });
  });
});
