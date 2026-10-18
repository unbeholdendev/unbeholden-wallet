import { hex } from "@scure/base";
import { sha256, type BTC_NETWORK } from "@scure/btc-signer/utils.js";

export type Network = "mainnet" | "signet" | "regtest";

export const NETWORKS: Record<Network, BTC_NETWORK> = {
  mainnet: { bech32: "bc", pubKeyHash: 0x00, scriptHash: 0x05, wif: 0x80 },
  signet: { bech32: "tb", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef },
  regtest: { bech32: "bcrt", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef },
};

// Genesis block hashes, as Bitcoin Core asserts them:
// https://github.com/bitcoin/bitcoin/blob/master/src/kernel/chainparams.cpp
const GENESIS: Record<string, Network> = {
  "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f": "mainnet",
  "00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6": "signet",
  "0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206": "regtest",
};

/** The network whose genesis block header this is, null for one this app does not know. */
export function genesisNetwork(header: Uint8Array): Network | null {
  return GENESIS[hex.encode(sha256(sha256(header)).reverse())] ?? null;
}
