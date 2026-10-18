import { hex } from "@scure/base";
import { Address, NETWORK, OutScript } from "@scure/btc-signer";
import { describe, expect, it } from "vitest";
import { deriveAddress } from "../wallet/derive";
import { descriptorFromExtendedKey } from "../wallet/descriptor";
import { BIP84_ZPUB } from "../wallet/vectors";
import { planBump } from "./bump";
import type { AddressInfo, WalletCoin, WalletTx } from "./wallet";

const descriptor = descriptorFromExtendedKey(BIP84_ZPUB, "mainnet");
const wallet = { scriptType: "wpkh" as const, network: "mainnet" as const, nextChange: { chain: 1, index: 5 } };
// A P2WPKH address from the BIP173 examples.
// https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki
const PAYEE = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const script = (address: string) => hex.encode(OutScript.encode(Address(NETWORK).decode(address)));

function mine(chain: number, index: number): AddressInfo {
  const address = deriveAddress(descriptor, "mainnet", chain, index);
  return { address, chain, index, path: "", used: true, txCount: 1, reused: false, label: null };
}

function walletTx(inputValue: number, change: number, fee = 282): WalletTx {
  const own = mine(0, 0);
  const back = mine(1, 0);
  return {
    txid: "aa".repeat(32),
    height: null,
    confirmations: 0,
    time: null,
    seenAt: 0,
    net: -(50_000 + fee),
    fee,
    vsize: 141,
    inputs: [{ txid: "bb".repeat(32), vout: 0, value: inputValue, address: own.address, mine: own }],
    outputs: [
      { vout: 0, script: script(PAYEE), value: 50_000, address: PAYEE, mine: null, label: null },
      { vout: 1, script: script(back.address), value: change, address: back.address, mine: back, label: null },
    ],
    label: null,
  };
}

function coin(txid: string, vout: number, value: number, at: AddressInfo, status: WalletCoin["status"]): WalletCoin {
  return { txid, vout, value, script: script(at.address), address: at.address, chain: at.chain, index: at.index, height: status === "confirmed" ? 100 : null, status, frozen: false, label: null };
}

describe("fee bump", () => {
  it("takes the extra fee from change and keeps inputs and payment", () => {
    const tx = walletTx(100_000, 49_718);
    const plan = planBump(tx, [coin(tx.txid, 1, 49_718, mine(1, 0), "own-change")], 10, wallet);
    expect(plan.problem).toBeNull();
    expect(plan.coins.map((c) => c.txid)).toEqual(["bb".repeat(32)]);
    expect(plan.recipients).toEqual([{ address: PAYEE, value: 50_000 }]);
    expect(plan.spend.fee).toBe(1_410);
    expect(plan.change).toEqual({ chain: 1, index: 0, value: 100_000 - 50_000 - 1_410 });
    expect(plan.oldFeeRate).toBe(2);
  });

  it("adds a confirmed coin when change cannot absorb the increase", () => {
    const tx = walletTx(52_000, 1_718);
    const extra = coin("cc".repeat(32), 0, 30_000, mine(0, 3), "confirmed");
    const unconfirmed = coin("dd".repeat(32), 0, 90_000, mine(0, 4), "own-change");
    const plan = planBump(tx, [coin(tx.txid, 1, 1_718, mine(1, 0), "own-change"), unconfirmed, extra], 20, wallet);
    expect(plan.problem).toBeNull();
    expect(plan.coins.map((c) => c.txid)).toEqual(["bb".repeat(32), "cc".repeat(32)]);
    expect(plan.spend.fee).toBeGreaterThanOrEqual(plan.oldFee + plan.spend.vsize);
    expect(plan.change?.value).toBe(82_000 - 50_000 - plan.spend.fee);
  });

  it("refuses a rate a node would not accept as a replacement", () => {
    const tx = walletTx(100_000, 49_718);
    const plan = planBump(tx, [coin(tx.txid, 1, 49_718, mine(1, 0), "own-change")], 2, wallet);
    expect(plan.problem).toEqual({ kind: "below-minimum", minFeeRate: 3 });
  });

  it("refuses a transaction it did not sign every input of", () => {
    const tx = walletTx(100_000, 49_718);
    tx.inputs.push({ txid: "ee".repeat(32), vout: 1, value: 10_000, address: PAYEE, mine: null });
    expect(planBump(tx, [], 10, wallet).problem).toEqual({ kind: "not-ours" });
  });

  it("refuses when a later transaction already spends its change", () => {
    expect(planBump(walletTx(100_000, 49_718), [], 10, wallet).problem).toEqual({ kind: "has-children" });
  });

  it("refuses a payment it cannot recreate", () => {
    const tx = walletTx(100_000, 49_718);
    tx.outputs.push({ vout: 2, script: "6a00", value: 0, address: null, mine: null, label: null });
    const plan = planBump(tx, [coin(tx.txid, 1, 49_718, mine(1, 0), "own-change")], 10, wallet);
    expect(plan.problem).toEqual({ kind: "unsupported-output" });
  });

  it("refuses a confirmed transaction", () => {
    const tx = { ...walletTx(100_000, 49_718), height: 100 };
    expect(planBump(tx, [], 10, wallet).problem).toEqual({ kind: "confirmed" });
  });

  it("sends new change to the address it is given, as a single-chain wallet's receive one", () => {
    const tx = walletTx(50_282, 0);
    const noChange = { ...tx, outputs: tx.outputs.slice(0, 1) };
    const extra = coin("cc".repeat(32), 0, 100_000, mine(0, 3), "confirmed");
    const plan = planBump(noChange, [extra], 10, { ...wallet, nextChange: { chain: 0, index: 7 } });
    expect(plan.problem).toBeNull();
    expect(plan.change).toMatchObject({ chain: 0, index: 7 });
  });
});
