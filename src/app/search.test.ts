import { hex } from "@scure/base";
import { Transaction } from "@scure/btc-signer";
import { describe, expect, it } from "vitest";
import { parseSearch } from "./Search";

// Examples from BIP173: https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki#examples
const MAINNET_P2WPKH = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const TESTNET_P2WPKH = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";

const raw = () => {
  const tx = new Transaction({ allowUnknownOutputs: true, disableScriptCheck: true });
  tx.addInput({ txid: "11".repeat(32), index: 0 });
  tx.addOutput({ script: hex.decode("6a0100"), amount: 0n });
  return hex.encode(tx.unsignedTx);
};

describe("a search", () => {
  it("opens a transaction ID, however it is cased", () => {
    expect(parseSearch(` ${"AB".repeat(32)} `, "mainnet")).toEqual({ route: `/tx/${"ab".repeat(32)}` });
  });

  it("opens a block by its height, however it is spaced", () => {
    expect(parseSearch(" 153 500 ", "mainnet")).toEqual({ route: "/block/153500" });
    expect(parseSearch("0", "mainnet")).toEqual({ route: "/block/0" });
  });

  it("sends a raw transaction to be broadcast, however it is cased", () => {
    expect(parseSearch(` ${raw().toUpperCase()} `, "mainnet")).toEqual({ route: `/broadcast/${raw()}` });
  });

  it("knows an address, whose view is not here yet", () => {
    expect(parseSearch(MAINNET_P2WPKH, "mainnet")).toEqual({ error: expect.stringMatching(/address.*isn't here yet/i) });
    expect(parseSearch(`bitcoin:${MAINNET_P2WPKH}?amount=0.1`, "mainnet")).toEqual({ error: expect.stringMatching(/address.*isn't here yet/i) });
  });

  it("refuses an address on another network, naming it", () => {
    expect(parseSearch(TESTNET_P2WPKH, "mainnet")).toEqual({ error: "This is a testnet or signet address, but this wallet is on mainnet." });
  });

  it("says plainly what it takes when the input is none of them", () => {
    for (const text of ["hello", "12ab", "bc1q"]) {
      expect(parseSearch(text, "mainnet")).toEqual({ error: expect.any(String) });
    }
    expect(parseSearch("hello", "mainnet")).toEqual({
      error: "Search takes a transaction ID, an address, a block height or a raw transaction in hex.",
    });
  });
});
