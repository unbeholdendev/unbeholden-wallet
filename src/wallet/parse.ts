import { hex } from "@scure/base";
import { Address, OutScript } from "@scure/btc-signer";
import { NETWORKS, type Network } from "./network";

const NAMES: Record<Network, string> = {
  mainnet: "mainnet",
  signet: "testnet or signet",
  regtest: "regtest",
  testnet3: "testnet or signet",
  testnet4: "testnet or signet",
};

export const NOT_AN_ADDRESS = "This isn't a Bitcoin address.";

/** The output script and canonical spelling of an address on the wallet's network, or why there are none. */
export function checkAddress(text: string, network: Network): { script: string; address: string } | { error: string } {
  const address = text.trim();
  try {
    const decoded = Address(NETWORKS[network]).decode(address);
    return { script: hex.encode(OutScript.encode(decoded)), address: Address(NETWORKS[network]).encode(decoded) };
  } catch {}
  for (const other of Object.keys(NETWORKS) as Network[]) {
    try {
      if (other !== network && Address(NETWORKS[other]).decode(address))
        return { error: `This is a ${NAMES[other]} address, but this wallet is on ${network}.` };
    } catch {}
  }
  if (/^(bc|tb|bcrt)1/i.test(address))
    return { error: "This address has a mistake in it: its checksum doesn't match. Check every character." };
  return { error: NOT_AN_ADDRESS };
}

// 21 million BTC, well inside exact integer range.
const MAX_SATS = 21e14;

/** Sats from a BTC amount as typed, spaces allowed; null when it is not one. */
export function parseBtc(text: string): number | null {
  const m = /^(\d*)(?:\.(\d{0,8}))?$/.exec(text.replace(/[\s ]/g, ""));
  if (!m || (!m[1] && !m[2])) return null;
  const sats = Number(m[1] || 0) * 1e8 + Number((m[2] ?? "").padEnd(8, "0"));
  return sats <= MAX_SATS ? sats : null;
}

/** Sats from an amount as typed: BTC, or whole sats with a `sats` suffix. */
export function parseAmount(text: string): number | null {
  const m = /^(\d[\d\s]*)sats?$/i.exec(text.trim());
  if (!m) return parseBtc(text);
  const sats = Number(m[1]!.replace(/\s/g, ""));
  return sats <= MAX_SATS ? sats : null;
}

export const btcText = (sats: number) => (sats / 1e8).toFixed(8).replace(/\.?0+$/, "");

/** An address, or a BIP21 `bitcoin:` URI with its amount and label. */
// https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki
export function parseUri(text: string): { address: string; amount?: string; label?: string } {
  const m = /^bitcoin:([^?]*)(?:\?(.*))?$/i.exec(text.trim());
  if (!m) return { address: text.trim() };
  const query = new URLSearchParams(m[2] ?? "");
  // A required parameter this wallet does not know voids the URI, so it is left whole to fail as an address.
  if ([...query.keys()].some((k) => k.startsWith("req-"))) return { address: text.trim() };
  const amount = query.get("amount");
  return {
    address: m[1]!,
    ...(amount && parseBtc(amount) !== null && { amount }),
    ...((query.get("label") ?? query.get("message")) && { label: (query.get("label") ?? query.get("message"))! }),
  };
}
