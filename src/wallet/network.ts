import type { BTC_NETWORK } from "@scure/btc-signer/utils.js";

export type Network = "mainnet" | "signet" | "regtest";

export const NETWORKS: Record<Network, BTC_NETWORK> = {
  mainnet: { bech32: "bc", pubKeyHash: 0x00, scriptHash: 0x05, wif: 0x80 },
  signet: { bech32: "tb", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef },
  regtest: { bech32: "bcrt", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef },
};
