import { hex, utf8 } from "@scure/base";
import { describe, expect, it } from "vitest";
import type { Coin } from "./coin";
import { assessPrivacy, linkCoins, type HistoryTx } from "./privacy";
import { spend, type Payment } from "./select";

const wpkh = (name: string) => "0014" + hex.encode(utf8.decode(name.padEnd(20)));
const txid = (name: string) => name.padEnd(64, "0");
const foreign = { txid: txid("ff"), vout: 0 };

// a and b pay us; e spends both and keeps change; c and d reuse one address;
// f is a lone payment.
const history: HistoryTx[] = [
  { txid: txid("a"), inputs: [foreign], outputs: [{ script: wpkh("A"), value: 40_000 }] },
  { txid: txid("b"), inputs: [foreign], outputs: [{ script: wpkh("B"), value: 60_000 }] },
  { txid: txid("c"), inputs: [foreign], outputs: [{ script: wpkh("C"), value: 1_250_000 }] },
  { txid: txid("d"), inputs: [foreign], outputs: [{ script: wpkh("C"), value: 30_000 }] },
  {
    txid: txid("e"),
    inputs: [
      { txid: txid("a"), vout: 0 },
      { txid: txid("b"), vout: 0 },
    ],
    outputs: [
      { script: wpkh("someone"), value: 50_000 },
      { script: wpkh("E"), value: 48_000 },
    ],
  },
  { txid: txid("f"), inputs: [foreign], outputs: [{ script: wpkh("F"), value: 70_000 }] },
];
const own = new Set(["A", "B", "C", "E", "F"].map(wpkh));
const groups = linkCoins(history, own);

function coin(tx: string, vout: number, value: number, script: string): Coin {
  return {
    txid: txid(tx),
    vout,
    value,
    script,
    address: `address-${tx}`,
    chain: 0,
    index: 0,
    height: 840_000,
    status: "confirmed",
    frozen: false,
  };
}
const c = coin("c", 0, 1_250_000, wpkh("C"));
const d = coin("d", 0, 30_000, wpkh("C"));
const e = coin("e", 1, 48_000, wpkh("E"));
const f = coin("f", 0, 70_000, wpkh("F"));

const payment = (value: number, script = wpkh("payee")): Payment => ({
  recipients: [{ script, value }],
  feeRate: 1,
  scriptType: "wpkh",
});
const assess = (coins: Coin[], p = payment(10_000), info = {}) =>
  assessPrivacy(spend(coins, p), p, groups, info);
const kinds = (coins: Coin[], p?: Payment, info = {}) =>
  assess(coins, p, info).warnings.map((w) => w.kind);

describe("linkCoins", () => {
  it("links change to every coin its transaction spent", () => {
    const id = groups.get(`${txid("e")}:1`);
    expect(groups.get(`${txid("a")}:0`)).toBe(id);
    expect(groups.get(`${txid("b")}:0`)).toBe(id);
    expect(groups.get(`${txid("f")}:0`)).not.toBe(id);
  });

  it("links payments to the same address", () => {
    expect(groups.get(`${txid("c")}:0`)).toBe(groups.get(`${txid("d")}:0`));
  });
});

describe("assessPrivacy", () => {
  it("says which separate sources a selection would link", () => {
    const report = assess([e, f, c], payment(1_000_000), {
      label: (coin: Coin) => (coin === f ? "Rent refund" : undefined),
    });
    expect(report.sources).toEqual([[e], [f], [c]]);
    expect(report.warnings[0]).toEqual({
      kind: "links-sources",
      message:
        "This spends coins from 3 separate sources, permanently linking them: 0.00048 BTC received in block 840,000, Rent refund and 0.0125 BTC received in block 840,000. Anyone looking at the blockchain will be able to tell they have the same owner.",
    });
  });

  it("reports no new link within one source", () => {
    expect(kinds([c, d])).not.toContain("links-sources");
    expect(assess([c, d]).sources).toEqual([[c, d]]);
  });

  it("flags address reuse among the selected coins", () => {
    expect(assess([c, d]).warnings).toContainEqual({
      kind: "address-reuse",
      message:
        "2 of these coins were paid to the same address, address-c. Reusing an address shows everyone that the payments went to the same person.",
    });
  });

  it("warns when an exchange that knows the user would learn about other coins", () => {
    const info = { label: () => "Exchange withdrawal", kyc: (coin: Coin) => coin === f };
    expect(assess([e, f], payment(10_000), info).warnings).toContainEqual({
      kind: "kyc",
      message:
        "Exchange withdrawal came from an exchange that knows who you are. Spending it with your other coins lets the exchange see those are yours too.",
    });
    expect(kinds([f], payment(10_000), info)).not.toContain("kyc");
  });

  it("names the output an observer would take for the change, and why", () => {
    const taproot = "5120" + "11".repeat(32);
    expect(assess([f], payment(10_000, taproot)).change).toMatch(
      /^Anyone looking at the blockchain would most likely take the 0\.\d+ BTC output for your change: it is the only output of the same address type as the coins spent, and it is not a round amount and the payment is\.$/,
    );
    expect(assess([f], payment(12_345)).change).toMatch(
      /^Neither the address types nor the amounts single out the 0\.\d+ BTC output as your change\.$/,
    );
  });

  it("says there is nothing to guess when there is no change", () => {
    const p: Payment = { ...payment(0), recipients: [{ script: wpkh("payee"), value: "max" }] };
    expect(assess([f], p).change).toBe(
      "There is no change, so no output here can be picked out as yours.",
    );
    expect(assess([], payment(10_000)).change).toBeNull();
  });
});
