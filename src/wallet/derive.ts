import { HDKey } from "@scure/bip32";
import { multisig, p2tr, p2wpkh, type P2Ret } from "@scure/btc-signer/payment.js";
import { childPath, HARDENED, type Descriptor } from "./descriptor";
import { BIP32_VERSIONS } from "./extended-key";
import { NETWORKS, type Network } from "./network";

const chains = new Map<string, HDKey>();

/** The public keys a descriptor derives for one chain and address index, in the order its keys are written. */
export function derivePublicKeys(
  descriptor: Descriptor,
  network: Network,
  chain: number,
  index: number,
): Uint8Array[] {
  const multipath = descriptor.keys[0]!.path.find((step) => Array.isArray(step));
  if (multipath) {
    if (!Number.isInteger(chain) || chain < 0 || chain >= multipath.length) {
      throw new Error(`This descriptor has no chain ${chain}`);
    }
  } else if (chain !== 0) {
    throw new Error(
      `This descriptor covers a single chain, so not chain ${chain}`,
    );
  }
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) {
    throw new Error(`${index} is not an address index`);
  }

  return descriptor.keys.map((key) => {
    const steps = childPath(key, chain, index).slice(0, -1);
    const id = `${network} ${key.key}/${steps.join("/")}`;
    let node = chains.get(id);
    if (!node) {
      // Version bytes differ per network, so this also rejects a key belonging to
      // a different one.
      node = HDKey.fromExtendedKey(key.key, BIP32_VERSIONS[network]);
      for (const step of steps) node = node.deriveChild(step);
      chains.set(id, node);
    }
    return node.deriveChild(index).publicKey!;
  });
}

/** The output a descriptor derives for one chain and address index, with its public keys and a multisig's witness script. */
export function derivePayment(descriptor: Descriptor, network: Network, chain: number, index: number) {
  const keys = derivePublicKeys(descriptor, network, chain, index);
  const params = NETWORKS[network];
  const { multi } = descriptor;
  const payment: P2Ret = multi
    ? multisig(multi.threshold, keys, multi.sorted, true, params)
    : descriptor.scriptType === "wpkh"
      ? p2wpkh(keys[0]!, params)
      : p2tr(keys[0]!.slice(1), undefined, params);
  return { ...payment, keys };
}

/** The address a descriptor derives for one chain and address index. */
export function deriveAddress(
  descriptor: Descriptor,
  network: Network,
  chain: number,
  index: number,
): string {
  return derivePayment(descriptor, network, chain, index).address!;
}
