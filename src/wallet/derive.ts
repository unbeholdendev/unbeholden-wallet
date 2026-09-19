import { HDKey } from "@scure/bip32";
import { p2tr, p2wpkh } from "@scure/btc-signer/payment.js";
import type { Descriptor } from "./descriptor";
import { BIP32_VERSIONS } from "./extended-key";
import { NETWORKS, type Network } from "./network";

/** The public key a descriptor derives for one chain and address index. */
export function derivePublicKey(
  descriptor: Descriptor,
  network: Network,
  chain: number,
  index: number,
): Uint8Array {
  const multipath = descriptor.path.find((step) => Array.isArray(step));
  if (multipath) {
    if (!Number.isInteger(chain) || chain < 0 || chain >= multipath.length) {
      throw new Error(`This descriptor has no chain ${chain}`);
    }
  } else if (chain !== 0) {
    throw new Error(
      `This descriptor covers a single chain, so not chain ${chain}`,
    );
  }
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
    throw new Error(`${index} is not an address index`);
  }

  // Version bytes differ per network, so this also rejects a key belonging to
  // a different one.
  let node = HDKey.fromExtendedKey(descriptor.key, BIP32_VERSIONS[network]);
  for (const step of descriptor.path) {
    node = node.deriveChild(
      step === "*" ? index : typeof step === "number" ? step : step[chain]!,
    );
  }
  return node.publicKey!;
}

/** The address a descriptor derives for one chain and address index. */
export function deriveAddress(
  descriptor: Descriptor,
  network: Network,
  chain: number,
  index: number,
): string {
  const publicKey = derivePublicKey(descriptor, network, chain, index);
  const params = NETWORKS[network];
  const payment =
    descriptor.scriptType === "wpkh"
      ? p2wpkh(publicKey, params)
      : p2tr(publicKey.slice(1), undefined, params);
  return payment.address!;
}
