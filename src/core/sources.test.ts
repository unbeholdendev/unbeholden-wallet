import { describe, expect, it } from "vitest";
import { sourcesOf } from "./sources";
import type { WalletCoin } from "./wallet";

const ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

function coin(n: number, value: number, height: number | null, more: Partial<WalletCoin> = {}): WalletCoin {
  return {
    txid: n.toString(16).padStart(64, "0"),
    vout: 0,
    value,
    script: "",
    address: ADDRESS,
    chain: 0,
    index: n,
    height,
    status: height === null ? "foreign-unconfirmed" : "confirmed",
    frozen: false,
    label: null,
    kyc: false,
    ...more,
  };
}

const outpoint = (c: WalletCoin) => `${c.txid}:${c.vout}`;

describe("sourcesOf", () => {
  it("groups linked coins, oldest source first, and names each by its label or first address", () => {
    const a = coin(1, 10_000, 120);
    const b = coin(2, 50_000, 130, { label: "Payroll" });
    const lone = coin(3, 7_000, 110, { chain: 1 });
    const pending = coin(4, 1_000, null);
    const snapshot = {
      coins: [a, b, lone, pending],
      groups: new Map([
        [outpoint(a), "g"],
        [outpoint(b), "g"],
      ]),
      transactions: [],
      addresses: { receive: [], change: [] },
    };
    const sources = sourcesOf(snapshot);
    expect(sources.map((s) => [s.id, s.name, s.label, s.firstSeen, s.total])).toEqual([
      [outpoint(lone), "Change at bc1qw508…f3t4", null, 110, 7_000],
      ["g", "Payroll", "Payroll", 120, 60_000],
      [outpoint(pending), "Received at bc1qw508…f3t4", null, null, 1_000],
    ]);
    expect(sources[1]!.coins).toEqual([b, a]);
  });

  it("takes a source's KYC marks from its transactions' outputs", () => {
    const a = coin(1, 10_000, 120);
    const transactions = [{ txid: a.txid, label: "Exchange", outputs: [{ vout: 0, kyc: true }] }];
    const [source] = sourcesOf({
      coins: [a],
      groups: new Map(),
      transactions: transactions as never,
      addresses: { receive: [], change: [] },
    });
    expect(source).toMatchObject({ name: "Exchange", kyc: [{ txid: a.txid, vout: 0 }] });
  });
});
