import { hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import { genesisNetwork } from "./network";

// Time, nonce and bits passed to CreateGenesisBlock, and the merkle root all of them share:
// https://github.com/bitcoin/bitcoin/blob/master/src/kernel/chainparams.cpp
const MERKLE_ROOT = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";

function header(time: number, nonce: number, bits: number): Uint8Array {
  const bytes = new Uint8Array(80);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  bytes.set(hex.decode(MERKLE_ROOT).reverse(), 36);
  view.setUint32(68, time, true);
  view.setUint32(72, bits, true);
  view.setUint32(76, nonce, true);
  return bytes;
}

describe("genesisNetwork", () => {
  it.each([
    ["mainnet", header(1231006505, 2083236893, 0x1d00ffff)],
    ["signet", header(1598918400, 52613770, 0x1e0377ae)],
    ["regtest", header(1296688602, 2, 0x207fffff)],
  ])("names %s from its genesis header", (network, genesis) => {
    expect(genesisNetwork(genesis)).toBe(network);
  });

  it("knows no other chain, testnet3 included", () => {
    expect(genesisNetwork(header(1296688602, 414098458, 0x1d00ffff))).toBeNull();
  });
});
